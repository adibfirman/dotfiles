/**
 * Vendored from phl28/hunk-gh-review@d141596 (MIT). Local changes:
 * 1. `gh pr view` without -R when GH_PR_NUMBER is unset (gh rejects -R with no selector).
 * 2. Threads come from one GraphQL query: outdated and file-level hidden, resolved shown (open first).
 * 3. Replies post through GraphQL `addPullRequestReviewThreadReply`.
 * 4. `X` (gh-review.resolve) resolves/unresolves the selected thread.
 * 5. `R` is dropped as a global key (hunk 0.23 built-in); threads mode handles `R` itself.
 * 6. Threads mode `G`/`T` match shifted keys. 7. Deleted notes are not submitted.
 * 8. Submit uses only this session's notes; after posting it drops just the submitted ones.
 *
 * gh-review — GitHub PR reviews from inside hunk.
 *
 * Two features:
 *
 * 1. Submit (`S`, command `gh-review.submit`): post every note in the current
 *    review as inline comments on the PR under review, then submit as
 *    Comment / Approve / Request changes. Notes are optional — matching the
 *    GitHub UI, Approve and Request changes submit with no content at all;
 *    a Comment review without notes requires a top-level body.
 *
 * 2. PR threads pane (`T`, command `gh-review.threads`): fetches the PR's
 *    review threads and docks them in a right-hand pane — click a thread to
 *    jump the review stream to its line. In the threads mode (entered with
 *    `T`) `R` replies to the selected thread (`gh-review.reply` has no global
 *    key) and `X` (`gh-review.resolve`) resolves or unresolves it; threads
 *    refetch after replies, resolves and submits.
 *
 * The target PR is never typed by hand — it is the PR of the diff being
 * reviewed: launchers that pipe a PR diff in (`gh pr diff 42 | hunk patch -`)
 * set GH_PR_NUMBER (and GH_PR_REPO, since gh's upstream>origin remote
 * priority can otherwise resolve the wrong repo in fork-style clones), and
 * working-tree reviews fall back to the checked-out branch's open PR. A
 * set-but-empty GH_PR_NUMBER means the launcher already determined there is
 * no open PR. If there is nowhere to post notes (GitHub reviews attach to
 * PRs, not branches), submit fails with a clear message instead of guessing.
 *
 * Notes come only from this session's note_created/note_edited events (minus
 * note_changed removals and emptied notes); posted notes are not re-queued.
 * Other hunk sessions are never read or cleared.
 * GitHub calls go through `gh`, so auth is whatever `gh auth status` says.
 *
 * Bonus: hunk's built-in `e` key (open file in editor) hard-errors with
 * "$EDITOR is not set." when the variable is missing, so this extension sets
 * $EDITOR for the session — config `editor` first, else $EDITOR/$VISUAL,
 * git's editor, then a PATH default.
 */
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { matchesKey } from "hunkdiff/extension";
import type {
  ExtensionCommandContext,
  ExtensionPaneProps,
  HunkExtensionAPI,
} from "hunkdiff/extension";
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ------------------------------------------------------------------ */
/* Editor resolution for the built-in `e` key                          */
/* ------------------------------------------------------------------ */

/**
 * Fallback editors, checked in order on PATH when nothing was configured.
 * Terminal editors come first — they run anywhere, including over SSH and
 * in headless sessions; GUI editors follow since they need a desktop.
 * Within each group the most common names lead. This is a last resort for
 * users who configured nothing — anyone with $EDITOR/$VISUAL/git's editor
 * or the `editor` config key is never affected. Ordering is best-effort,
 * not a recommendation: users who care set one of the options above and
 * skip this list entirely.
 */
const DEFAULT_EDITOR_CANDIDATES = [
  "editor", // platform convention (Debian alternatives, macOS /usr/bin/editor)
  "vim", "nvim", "vi", // near-universal terminal editors
  "nano", "micro", "emacs", // other common terminal editors
  "hx", // helix
  "code", // VS Code — the near-universal GUI editor
  "zed", "subl", "idea", // common GUI editors (Zed, Sublime, IntelliJ)
  "cursor", "devin-desktop", // agent-focused IDEs (Cursor IDE CLI, Devin Desktop IDE)
];

/** Resolve an editor command string ("/usr/bin/editor -w" keeps its args). */
async function resolveEditor(cwd: string): Promise<string | null> {
  // 1. An explicit $EDITOR is never overridden.
  const explicit = process.env.EDITOR?.trim();
  if (explicit) return explicit;
  // 2. Honour $VISUAL, then git's editor (env var, then config).
  const visual = process.env.VISUAL?.trim();
  if (visual) return visual;
  const gitEditor = process.env.GIT_EDITOR?.trim();
  if (gitEditor) return gitEditor;
  try {
    const configured = (await mustRun("git", ["config", "--get", "core.editor"], { cwd })).trim();
    if (configured) return configured;
  } catch {
    // No git config / not a repo — fall through to the defaults.
  }
  // 3. First editor on PATH — terminal editors first (they run anywhere,
  //    including over SSH), then common GUI editors. See the list's docs.
  for (const candidate of DEFAULT_EDITOR_CANDIDATES) {
    if (await hasOnPath(candidate)) return candidate;
  }
  return null;
}

function hasOnPath(program: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", program]);
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

/**
 * Hunk's built-in `e` key opens the selected file via $EDITOR and hard-errors
 * with "$EDITOR is not set." when the variable is absent. Set it once here so
 * the key keeps working in shells that never exported it. Order: config
 * `editor`, then $EDITOR, $VISUAL, git's editor, then a PATH default.
 */
async function ensureEditorEnv(cwd: string, configured: string | null, log: (message: string) => void): Promise<void> {
  if (process.env.EDITOR?.trim()) return; // explicit $EDITOR wins, always
  const editor: Promise<string | null> = configured ? Promise.resolve(configured) : resolveEditor(cwd);
  const resolved = await editor;
  if (resolved) {
    process.env.EDITOR = resolved;
    log(`resolved EDITOR="${resolved}" for the e key (set one explicitly to override)`);
  } else if (configured === null) {
    log("could not resolve an editor for the e key — set $EDITOR or [extension.gh-review] editor");
  }
}

type Note = {
  filePath: string;
  side: "old" | "new";
  line: number;
  body: string;
};

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; input?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (opts.input !== undefined) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

async function mustRun(cmd: string, args: string[], opts: { cwd?: string; input?: string } = {}): Promise<string> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) {
    throw new Error((r.stderr || r.stdout).trim() || `${cmd} exited ${r.code}`);
  }
  return r.stdout;
}

/* ------------------------------------------------------------------ */
/* PR target resolution                                                */
/* ------------------------------------------------------------------ */

type TargetPr = { number: string; title: string };

/** gh's default repo (respecting its remote priority); null when unresolvable. */
async function ghDefaultRepo(cwd: string): Promise<string | null> {
  try {
    return (await mustRun("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { cwd })).trim();
  } catch {
    return null;
  }
}

/** Interactive variant for the submit flow — notifies on failure. */
async function resolveRepo(ctx: ExtensionCommandContext): Promise<string | null> {
  const repo = process.env.GH_PR_REPO?.trim() || (await ghDefaultRepo(ctx.cwd));
  if (!repo) {
    ctx.notify("gh-review: not a GitHub repo or gh failed", "error");
    return null;
  }
  if (!splitRepo(repo)) {
    ctx.notify(`gh-review: invalid repo "${repo}", expected owner/name`, "error");
    return null;
  }
  return repo;
}

async function ghPrJson(args: string[], cwd: string, repo?: string): Promise<TargetPr> {
  const rflag = repo ? ["-R", repo] : [];
  const out = await mustRun("gh", [...args, "--json", "number,title", "--jq", '"\\(.number)\\t\\(.title)"', ...rflag], { cwd });
  const [number, ...rest] = out.trim().split("\t");
  return { number, title: rest.join("\t") };
}

/**
 * Non-interactive target for the threads pane: env first, then the
 * checked-out branch's open PR; null when there is no sensible target.
 */
async function resolveTargetQuiet(cwd: string): Promise<{ repo: string; pr: string } | null> {
  const envPr = process.env.GH_PR_NUMBER?.trim();
  const envRepo = process.env.GH_PR_REPO?.trim();
  const repo = envRepo || (await ghDefaultRepo(cwd));
  if (!repo) return null;
  if (envPr !== undefined) {
    return /^\d+$/.test(envPr) ? { repo, pr: envPr } : null;
  }
  try {
    // No -R here: gh rejects it when there is no PR selector.
    const pr = (await mustRun("gh", ["pr", "view", "--json", "number", "--jq", ".number"], { cwd })).trim();
    return { repo, pr };
  } catch {
    return null;
  }
}

/**
 * Interactive target for submit. GH_PR_NUMBER (set by launchers that pipe a
 * PR diff into hunk) wins; set-but-empty means the launcher already determined
 * there is no open PR for this review, so we must NOT fall back to the
 * checked-out branch's PR (that would target the wrong PR). Unset means a
 * plain hunk session, where the checked-out branch's open PR is the sensible
 * target. Returns null — after notifying — when there is no PR to attach
 * notes to, since GitHub reviews cannot be left on a bare branch.
 */
async function resolveTargetPr(ctx: ExtensionCommandContext, repo: string): Promise<TargetPr | null> {
  const raw = process.env.GH_PR_NUMBER;
  if (raw !== undefined) {
    const envPr = raw.trim();
    if (/^\d+$/.test(envPr)) {
      try {
        return await ghPrJson(["pr", "view", envPr], ctx.cwd, repo);
      } catch (e) {
        ctx.notify(`gh-review: PR #${envPr} not found in ${repo}: ${(e as Error).message.split("\n")[0]}`, "error");
        return null;
      }
    }
    if (envPr === "") {
      ctx.notify(
        "gh-review: no open PR for this review — notes can't be submitted to a bare branch. Open a PR first (gh pr create).",
        "warning",
      );
      return null;
    }
    ctx.notify(`gh-review: GH_PR_NUMBER="${raw}" is not a PR number`, "error");
    return null;
  }
  try {
    return await ghPrJson(["pr", "view"], ctx.cwd); // no -R: see resolveTargetQuiet
  } catch {
    ctx.notify(
      "gh-review: no open PR for the checked-out branch — notes can only be submitted to a PR. Open one first (gh pr create).",
      "warning",
    );
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* PR threads store                                                    */
/* ------------------------------------------------------------------ */

type GhComment = {
  id: string;
  body: string;
  user: { login: string } | null;
};

type Thread = {
  /** GraphQL node id; the reply and resolve mutations take it. */
  id: string;
  path: string;
  line: number;
  side: "RIGHT" | "LEFT";
  resolved: boolean;
  canResolve: boolean;
  canUnresolve: boolean;
  root: GhComment;
  replies: GhComment[];
};

type ThreadsState = {
  phase: "idle" | "loading" | "no-pr" | "error" | "ready";
  message?: string;
  repo?: string;
  pr?: TargetPr;
  threads: Thread[];
  /** Threads hidden because they are outdated or have no current line (file-level). */
  skippedOutdated: number;
  /** Thread id last clicked or key-navigated to; the reply and resolve commands target it. */
  activeThreadId: string | null;
  /** True while the `threads` keyboard mode owns j/k navigation. */
  modeActive: boolean;
};

let snapshot: ThreadsState = { phase: "idle", threads: [], skippedOutdated: 0, activeThreadId: null, modeActive: false };
const listeners = new Set<() => void>();

function setThreadsState(update: Partial<ThreadsState>) {
  snapshot = { ...snapshot, ...update };
  for (const listener of listeners) listener();
}

function useThreadsSnapshot(): ThreadsState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

/** Run one GraphQL document through gh. Numbers go as Int (-F), everything else as String (-f). */
async function ghGraphql<T = unknown>(query: string, variables: Record<string, string | number>, cwd: string): Promise<T> {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [name, value] of Object.entries(variables)) {
    args.push(typeof value === "number" ? "-F" : "-f", `${name}=${value}`);
  }
  return JSON.parse(await mustRun("gh", args, { cwd })) as T;
}

/** `owner/name` split into its parts; null when the value has no `/`. */
function splitRepo(repo: string): [owner: string, name: string] | null {
  const [owner, name] = repo.split("/");
  return owner && name ? [owner, name] : null;
}

type ReviewCommentNode = {
  fullDatabaseId: string;
  author: { login: string } | null;
  body: string;
};

/** One `reviewThreads` node from THREADS_QUERY. */
type ReviewThreadNode = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  diffSide: "RIGHT" | "LEFT";
  viewerCanResolve: boolean;
  viewerCanUnresolve: boolean;
  comments: { nodes: ReviewCommentNode[] } | null;
};

type ThreadsResponse = {
  data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: ReviewThreadNode[] } } } };
};

const THREADS_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line diffSide viewerCanResolve viewerCanUnresolve
          comments(first: 100) { nodes { fullDatabaseId author { login } body } }
        }
      }
    }
  }
}`;

function toComment(c: ReviewCommentNode): GhComment {
  return { id: c.fullDatabaseId, body: c.body, user: c.author };
}

/**
 * Turn GraphQL review threads into pane threads. Outdated threads and threads
 * without a current line are hidden (counted). Open threads come first,
 * resolved ones after; GitHub's order holds inside each group.
 */
function toThreads(nodes: ReviewThreadNode[]): { threads: Thread[]; skippedOutdated: number } {
  const open: Thread[] = [];
  const resolved: Thread[] = [];
  let skippedOutdated = 0;
  for (const node of nodes) {
    const [first, ...rest] = node.comments?.nodes ?? [];
    if (node.isOutdated || typeof node.line !== "number" || !first) {
      skippedOutdated++;
      continue;
    }
    const thread: Thread = {
      id: node.id,
      path: node.path,
      line: node.line,
      side: node.diffSide,
      resolved: node.isResolved,
      canResolve: node.viewerCanResolve,
      canUnresolve: node.viewerCanUnresolve,
      root: toComment(first),
      replies: rest.map(toComment),
    };
    (thread.resolved ? resolved : open).push(thread);
  }
  return { threads: [...open, ...resolved], skippedOutdated };
}

/** Move the active thread. No-op unless threads are loaded; clamps at the ends. */
function moveActiveThread(delta: 1 | -1 | "first" | "last") {
  if (snapshot.phase !== "ready" || snapshot.threads.length === 0) return;
  const ids = snapshot.threads.map((t) => t.id);
  const cur = snapshot.activeThreadId == null ? -1 : ids.indexOf(snapshot.activeThreadId);
  let next: number;
  if (delta === "first") next = 0;
  else if (delta === "last") next = ids.length - 1;
  else next = Math.min(ids.length - 1, Math.max(0, (cur < 0 ? (delta === 1 ? -1 : ids.length) : cur) + delta));
  setThreadsState({ activeThreadId: ids[next] });
}

/**
 * Load the PR's threads into the store. `selectIndex` keeps the selection at
 * that list position (clamped) instead of on the same thread; resolve uses it
 * so the next open thread takes the slot rather than the view jumping to the
 * resolved group.
 */
async function fetchThreads(cwd: string, notify?: ExtensionCommandContext["notify"], selectIndex?: number): Promise<void> {
  setThreadsState({ phase: "loading" });
  const target = await resolveTargetQuiet(cwd);
  if (!target) {
    setThreadsState({ phase: "no-pr", threads: [], skippedOutdated: 0, activeThreadId: null });
    return;
  }
  const parts = splitRepo(target.repo);
  if (!parts) {
    const message = `gh-review: invalid repo "${target.repo}", expected owner/name`;
    notify?.(message, "error");
    setThreadsState({ phase: "error", message, threads: [], activeThreadId: null });
    return;
  }
  try {
    const [owner, name] = parts;
    const [result, pr] = await Promise.all([
      ghGraphql<ThreadsResponse>(THREADS_QUERY, { owner, name, number: Number(target.pr) }, cwd),
      ghPrJson(["pr", "view", target.pr], cwd, target.repo).catch(() => ({ number: target.pr, title: "" })),
    ]);
    const nodes = result.data?.repository?.pullRequest?.reviewThreads?.nodes;
    if (!Array.isArray(nodes)) throw new Error(`PR #${target.pr} not found in ${target.repo}`);
    const { threads, skippedOutdated } = toThreads(nodes);
    // By default keep the selection on its thread (reply, refresh, reload) while it still exists.
    const activeThreadId =
      selectIndex !== undefined
        ? (threads[Math.min(selectIndex, threads.length - 1)]?.id ?? null)
        : threads.some((t) => t.id === snapshot.activeThreadId)
          ? snapshot.activeThreadId
          : null;
    setThreadsState({ phase: "ready", repo: target.repo, pr, threads, skippedOutdated, activeThreadId });
    if (threads.length > 0) {
      notify?.(`PR #${pr.number}: ${threads.length} review thread${threads.length === 1 ? "" : "s"} — press T`);
    }
  } catch (e) {
    setThreadsState({ phase: "error", message: (e as Error).message.split("\n")[0], threads: [], activeThreadId: null });
  }
}

/** The thread the reply and resolve commands act on; undefined when none is selected. */
function activeThread(): Thread | undefined {
  return snapshot.threads.find((t) => t.id === snapshot.activeThreadId);
}

/* ------------------------------------------------------------------ */
/* Threads pane component                                              */
/* ------------------------------------------------------------------ */

function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    let cur = "";
    for (const w of words) {
      if (!cur) cur = w;
      else if (`${cur} ${w}`.length <= width) cur += ` ${w}`;
      else {
        out.push(cur);
        cur = w;
      }
    }
    out.push(cur);
  }
  return out.length > 0 ? out : [""];
}

function CommentRows({
  comment,
  indent,
  width,
  theme,
  maxLines,
}: {
  comment: GhComment;
  indent: string;
  width: number;
  theme: ExtensionPaneProps["theme"];
  maxLines: number;
}): ReactNode {
  const author = `@${comment.user?.login ?? "ghost"}`;
  const bodyWidth = Math.max(width - indent.length - 1, 10);
  const lines = wrapText(comment.body, bodyWidth);
  const clipped = lines.length > maxLines;
  return (
    <>
      <text content={`${indent}${author}`} style={{ fg: theme.accent, bg: theme.panel }} />
      {(clipped ? [...lines.slice(0, maxLines), "…"] : lines).map((line, i) => (
        <text key={i} content={`${indent}${line}`} style={{ fg: theme.muted, bg: theme.panel }} />
      ))}
    </>
  );
}

function PrThreadsPane({ files, width, theme, actions }: ExtensionPaneProps): ReactNode {
  const state = useThreadsSnapshot();
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  const reveal = (thread: Thread) => {
    const file = files.find((f) => f.path === thread.path);
    if (file) actions.revealLine(file.id, thread.side === "LEFT" ? "old" : "new", thread.line);
  };
  const navigateTo = (thread: Thread) => {
    setThreadsState({ activeThreadId: thread.id });
    reveal(thread);
  };

  // Keep the active thread visible, and while the threads keyboard mode owns
  // input, follow it in the review stream too (that is the mode's whole job:
  // modes cannot navigate directly, they only receive keys).
  useEffect(() => {
    if (state.phase !== "ready" || state.activeThreadId == null) return;
    scrollRef.current?.scrollChildIntoView(`thread-${state.activeThreadId}`);
    if (!state.modeActive) return;
    const thread = state.threads.find((t) => t.id === state.activeThreadId);
    if (thread) reveal(thread);
  }, [state.activeThreadId, state.modeActive, state.phase]);

  let body: ReactNode;
  switch (state.phase) {
    case "idle":
    case "loading":
      body = <text content=" Loading PR threads…" style={{ fg: theme.muted, bg: theme.panel }} />;
      break;
    case "no-pr":
      body = (
        <text
          content=" No open PR for this review — threads unavailable"
          style={{ fg: theme.muted, bg: theme.panel }}
        />
      );
      break;
    case "error":
      body = (
        <text content={` Error loading threads: ${state.message}`} style={{ fg: theme.badgeRemoved, bg: theme.panel }} />
      );
      break;
    case "ready":
      body = (
        <>
          <text
            content={` PR #${state.pr!.number} · ${state.threads.length} thread${state.threads.length === 1 ? "" : "s"}${
              state.skippedOutdated > 0 ? ` (${state.skippedOutdated} hidden)` : ""
            }`}
            style={{ fg: theme.muted, bg: theme.panel }}
          />
          {state.threads.map((thread) => {
            const active = thread.id === state.activeThreadId;
            const rowBg = active ? theme.selectedHunk : theme.panel;
            return (
              <box key={thread.id} id={`thread-${thread.id}`} style={{ flexDirection: "column", backgroundColor: rowBg }}>
                <text
                  content={` ${thread.resolved ? "[resolved] " : ""}${thread.path}:${thread.line}`}
                  style={{ fg: theme.text, bg: rowBg }}
                  onMouseDown={() => navigateTo(thread)}
                />
                <box onMouseDown={() => navigateTo(thread)}>
                  <CommentRows comment={thread.root} indent="  " width={width} theme={theme} maxLines={4} />
                </box>
                {thread.replies.map((reply) => (
                  <box key={reply.id} onMouseDown={() => navigateTo(thread)}>
                    <CommentRows comment={reply} indent="   ↳ " width={width} theme={theme} maxLines={2} />
                  </box>
                ))}
                <text content="" style={{ bg: rowBg }} />
              </box>
            );
          })}
          {state.threads.length === 0 ? (
            <text content=" No review threads yet" style={{ fg: theme.muted, bg: theme.panel }} />
          ) : null}
        </>
      );
      break;
  }

  return (
    <scrollbox
      ref={scrollRef}
      width="100%"
      height="100%"
      focused={false}
      scrollY={true}
      rootOptions={{ backgroundColor: theme.panel }}
      wrapperOptions={{ backgroundColor: theme.panel }}
      viewportOptions={{ backgroundColor: theme.panel }}
      contentOptions={{ backgroundColor: theme.panel }}
      verticalScrollbarOptions={{ visible: false }}
      horizontalScrollbarOptions={{ visible: false }}
    >
      <box style={{ width: "100%", flexDirection: "column", backgroundColor: theme.panel }}>
        <text content=" PR threads" style={{ fg: theme.accent, bg: theme.panel }} />
        {state.modeActive ? (
          <text content=" j/k move · X resolve · R reply · enter/esc back" style={{ fg: theme.accentMuted, bg: theme.panel }} />
        ) : null}
        {body}
      </box>
    </scrollbox>
  );
}

/* ------------------------------------------------------------------ */
/* Submit flow                                                         */
/* ------------------------------------------------------------------ */

type NoteTrackInput = { id: string; draft: boolean; filePath: string; side: "old" | "new"; line: number; body: string };

/** Queue or update a note. Posted notes are ignored; an emptied note leaves the queue. */
function trackNote(collected: Map<string, Note>, submitted: Set<string>, note: NoteTrackInput) {
  if (note.draft || submitted.has(note.id)) return;
  if (note.body.trim()) {
    collected.set(note.id, { filePath: note.filePath, side: note.side, line: note.line, body: note.body });
  } else {
    collected.delete(note.id);
  }
}

/** After a post, drop only the notes that were sent. A note edited meanwhile stays queued. */
function forgetSubmitted(collected: Map<string, Note>, submitted: Set<string>, sent: [string, Note][]) {
  for (const [id, note] of sent) {
    if (collected.get(id) !== note) continue;
    collected.delete(id);
    submitted.add(id);
  }
}

async function submitReview(
  ctx: ExtensionCommandContext,
  collected: Map<string, Note>,
  submitted: Set<string>,
): Promise<void> {
  // 1. Gather notes from this session's own events only (never other sessions).
  // Notes are optional: approvals and body-only reviews need none.
  const sent = [...collected.entries()];
  const notes = sent.map(([, note]) => note);

  // 2. Resolve repo + the PR this review belongs to. The number is never
  // typed by hand: notes can only sensibly land on the PR whose diff is
  // loaded (comment line positions must match that PR's head diff).
  const nameWithOwner = await resolveRepo(ctx);
  if (!nameWithOwner) return; // resolveRepo already explained why

  const pr = await resolveTargetPr(ctx, nameWithOwner);
  if (!pr) return; // resolveTargetPr already explained why

  const noteCount = notes.length;
  const ok = await ctx.dialogs.confirm({
    title:
      noteCount > 0
        ? `Submit ${noteCount} note${noteCount === 1 ? "" : "s"} to PR #${pr.number}?`
        : `Submit a review with no inline notes to PR #${pr.number}?`,
    body: pr.title,
    confirmLabel: "submit",
  });
  if (!ok) return;
  const prNumber = pr.number;

  const choice = await ctx.dialogs.select({
    title: `Review type for PR #${prNumber}`,
    options: ["Comment", "Approve", "Request changes"],
  });
  if (choice === null) return;
  const event = { Comment: "COMMENT", Approve: "APPROVE", "Request changes": "REQUEST_CHANGES" }[choice]!;

  // Matching the GitHub UI: only Comment requires content. Approve and
  // Request changes submit fine with no notes and no body. (The REST docs
  // nominally require a body field for REQUEST_CHANGES, so an empty string
  // is sent rather than omitting it.)
  const needsBody = noteCount === 0 && event === "COMMENT";
  const bodyInput = await ctx.dialogs.input({
    title: needsBody ? "Review body (required — no inline notes)" : "Review body (optional — escape to skip)",
    placeholder: "Top-level review comment",
  });
  if (bodyInput === null && needsBody) return; // escape cancels a required field
  const body = (bodyInput ?? "").trim();
  if (needsBody && !body) {
    ctx.notify("gh-review: a top-level body is required when a Comment review has no inline notes", "warning");
    return;
  }

  // 3. Post one atomic review: comments + event in a single call.
  const payload = {
    event,
    ...(body ? { body } : event === "REQUEST_CHANGES" ? { body: "" } : {}),
    ...(noteCount > 0
      ? {
          comments: notes.map((n) => ({
            path: n.filePath,
            line: n.line,
            side: n.side === "old" ? "LEFT" : "RIGHT",
            body: n.body,
          })),
        }
      : {}),
  };
  const tmp = join(tmpdir(), `hunk-gh-review-${Date.now()}.json`);
  try {
    writeFileSync(tmp, JSON.stringify(payload));
    await mustRun("gh", ["api", `repos/${nameWithOwner}/pulls/${prNumber}/reviews`, "--method", "POST", "--input", tmp], {
      cwd: ctx.cwd,
    });
  } catch (e) {
    ctx.notify(`gh-review: GitHub rejected the review: ${(e as Error).message.split("\n")[0]}`, "error");
    return;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {}
  }

  // 4. Forget the submitted notes so a second press doesn't double-post.
  // They stay visible in the hunk UI; notes added or edited during submit stay queued.
  forgetSubmitted(collected, submitted, sent);

  ctx.notify(
    noteCount > 0
      ? `gh-review: review posted (${noteCount} comment${noteCount === 1 ? "" : "s"}) on PR #${prNumber}`
      : `gh-review: review posted on PR #${prNumber}`,
  );
  void fetchThreads(ctx.cwd); // the new review's comments belong in the pane
}

/* ------------------------------------------------------------------ */
/* Thread actions                                                      */
/* ------------------------------------------------------------------ */

type ThreadActionContext = Pick<ExtensionCommandContext, "cwd" | "notify" | "dialogs" | "panes">;

/** Bus event the threads keyboard mode emits for `R`: a mode has no dialogs, bus handlers do. */
const REPLY_EVENT = "gh-review:reply";

/** The selected thread, or null after telling the user why there is none. */
function requireActiveThread(ctx: ThreadActionContext): Thread | null {
  if (snapshot.phase !== "ready") {
    ctx.notify("gh-review: no PR threads loaded for this review", "warning");
    return null;
  }
  const thread = activeThread();
  if (!thread) {
    ctx.panes.open("threads");
    ctx.notify("gh-review: click a thread in the PR threads pane first", "warning");
    return null;
  }
  return thread;
}

async function replyToActiveThread(ctx: ThreadActionContext): Promise<void> {
  const thread = requireActiveThread(ctx);
  if (!thread) return;
  const author = thread.root.user?.login ?? "thread";
  const body = await ctx.dialogs.input({
    title: `Reply to @${author} (${thread.path}:${thread.line})`,
    placeholder: "Reply…",
  });
  if (body === null || !body.trim()) return;
  try {
    await ghGraphql(
      `mutation($threadId: ID!, $body: String!) {
        addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) { comment { id } }
      }`,
      { threadId: thread.id, body: body.trim() },
      ctx.cwd,
    );
  } catch (e) {
    ctx.notify(`gh-review: reply failed: ${(e as Error).message.split("\n")[0]}`, "error");
    return;
  }
  ctx.notify(`Replied to @${author}'s thread`);
  await fetchThreads(ctx.cwd);
}

/** Resolve the selected thread, or unresolve it when it is already resolved. */
async function toggleResolveActiveThread(ctx: ThreadActionContext): Promise<void> {
  const thread = requireActiveThread(ctx);
  if (!thread) return;
  const index = snapshot.threads.indexOf(thread); // refetch keeps this list position selected
  const resolving = !thread.resolved;
  if (!(resolving ? thread.canResolve : thread.canUnresolve)) {
    ctx.notify(`gh-review: you can't ${resolving ? "resolve" : "unresolve"} this thread`, "warning");
    return;
  }
  const mutation = resolving ? "resolveReviewThread" : "unresolveReviewThread";
  try {
    await ghGraphql(
      `mutation($threadId: ID!) { ${mutation}(input: { threadId: $threadId }) { thread { id } } }`,
      { threadId: thread.id },
      ctx.cwd,
    );
  } catch (e) {
    ctx.notify(`gh-review: ${resolving ? "resolve" : "unresolve"} failed: ${(e as Error).message.split("\n")[0]}`, "error");
    return;
  }
  ctx.notify(resolving ? "Thread resolved" : "Thread unresolved");
  await fetchThreads(ctx.cwd, undefined, index);
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

export default function (hunk: HunkExtensionAPI) {
  // The e key needs $EDITOR; resolve it once, before any review starts.
  const configuredEditor =
    typeof hunk.config.editor === "string" && hunk.config.editor.trim() ? hunk.config.editor.trim() : null;
  void ensureEditorEnv(process.cwd(), configuredEditor, (m) => hunk.log(m));

  // This session's own notes, live from lifecycle events (no source field exists on ExtensionReviewNote).
  const collected = new Map<string, Note>();
  const submitted = new Set<string>(); // posted ids: later edits in hunk must not re-queue them
  const track = (note: NoteTrackInput) => trackNote(collected, submitted, note);
  hunk.on("note_created", ({ note }) => track(note));
  hunk.on("note_edited", ({ note }) => track(note));
  // A deleted note must not be submitted. Snapshot ids match the ids above (both are the ReviewStore note id).
  hunk.on("note_changed", ({ kind, note }) => {
    if (kind === "removed") collected.delete(note.id);
  });

  // Fetch threads once the review content is known (and on reloads).
  hunk.on("changeset_loaded", (_payload, ctx) => void fetchThreads(ctx.cwd, (m, level) => ctx.notify(m, level)));
  hunk.on("session_reload", (_payload, ctx) => void fetchThreads(ctx.cwd, (m, level) => ctx.notify(m, level)));

  // Placement is configurable because Hunk omits panes that don't fit:
  // a side pane needs (terminal width - minReviewWidth - divider) >= its min
  // columns, which fails on narrow terminals; a bottom pane only needs rows.
  const placementRaw = typeof hunk.config.placement === "string" ? hunk.config.placement : "right";
  const placement = (["left", "right", "top", "bottom"] as const).includes(placementRaw as "left")
    ? (placementRaw as "left" | "right" | "top" | "bottom")
    : "right";
  hunk.registerPane(
    placement === "top" || placement === "bottom"
      ? {
          id: "threads",
          title: "PR threads",
          placement,
          height: { preferred: 12, min: 5 },
          component: PrThreadsPane,
        }
      : {
          id: "threads",
          title: "PR threads",
          placement,
          width: { preferred: 44, min: 22 },
          component: PrThreadsPane,
        },
  );

  hunk.registerCommand({ id: "submit", title: "Submit notes as GitHub PR review", key: "S" }, (ctx) =>
    submitReview(ctx, collected, submitted),
  );

  // Keyboard mode: while active, j/k walk the thread list and the review
  // stream follows (the pane's follow effect calls revealLine — modes receive
  // keys but deliberately cannot navigate). Unhandled keys pass through, so
  // X (resolve), c (note), etc. keep working; esc exits host-side. R (reply) is
  // handled here, because hunk's built-in R would otherwise take it.
  hunk.registerKeyboardMode({
    id: "threads",
    title: "PR threads",
    onKey: (key) => {
      // Shifted letters arrive as a lowercase name plus shift, so test them first.
      if (matchesKey("G", key)) {
        moveActiveThread("last");
        return "handled";
      }
      if (matchesKey("T", key)) return "exit";
      if (matchesKey("R", key)) {
        hunk.events.emit(REPLY_EVENT, {});
        return "handled";
      }
      switch (key.name) {
        case "j":
        case "down":
          moveActiveThread(1);
          return "handled";
        case "k":
        case "up":
          moveActiveThread(-1);
          return "handled";
        case "g":
          moveActiveThread("first");
          return "handled";
        case "q":
        case "return":
        case "enter":
          return "exit";
        default:
          return "pass";
      }
    },
    onEnter: () => setThreadsState({ modeActive: true }),
    onExit: () => setThreadsState({ modeActive: false }),
  });

  hunk.registerCommand({ id: "threads", title: "PR threads pane + keyboard mode", key: "T" }, (ctx) => {
    const willOpen = !ctx.panes.isOpen("threads");
    ctx.panes.toggle("threads");
    if (!willOpen) {
      if (ctx.keyboardModes.isActive("threads")) ctx.keyboardModes.exitMode();
      return;
    }
    if (snapshot.phase === "ready" && snapshot.threads.length > 0) {
      if (snapshot.activeThreadId == null) setThreadsState({ activeThreadId: snapshot.threads[0].id });
      ctx.keyboardModes.enterMode("threads");
    } else if (snapshot.phase === "ready") {
      ctx.notify("gh-review: no review threads on this PR");
    } else {
      ctx.notify("gh-review: threads unavailable for this review", "warning");
    }
  });

  hunk.registerCommand({ id: "refresh-threads", title: "Refresh PR threads" }, async (ctx) => {
    await fetchThreads(ctx.cwd);
    ctx.notify(snapshot.phase === "ready" ? "PR threads refreshed" : "PR threads unavailable for this review", snapshot.phase === "ready" ? "info" : "warning");
  });

  // No default key: hunk 0.23's built-in R would refuse it. The threads mode handles R itself.
  hunk.registerCommand({ id: "reply", title: "Reply to selected PR thread" }, replyToActiveThread);
  hunk.events.on(REPLY_EVENT, (_payload, ctx) => replyToActiveThread(ctx));

  hunk.registerCommand({ id: "resolve", title: "Resolve/unresolve PR thread", key: "X" }, toggleResolveActiveThread);
}
