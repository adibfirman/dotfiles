// Pure PR logic for the prs mod: no herdr imports, so `node --test` can load it.
// The state rules follow herdr/.config/herdr/scripts/sync-all-pr-worktree-labels.

// CANCELLED is not a failure: a newer run often cancels the old one.
const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
const FAILED_STATES = new Set(["FAILURE", "ERROR"]);
const PENDING_STATES = new Set(["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"]);

/**
 * One check (a CheckRun or a StatusContext) as { name, status: "passed" | "failed" | "running" | "skipped", url,
 * required, seconds }. required (true or false) and seconds (its run time) come only from the detail query: null
 * otherwise.
 */
export function check(c) {
  const name = c.name ?? c.context ?? "check";
  const url = c.detailsUrl ?? c.targetUrl ?? null;
  const required = typeof c.isRequired === "boolean" ? c.isRequired : null;
  const start = Date.parse(c.startedAt ?? ""), end = Date.parse(c.completedAt ?? "");
  const seconds = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 1000)) : null;
  const as = (status) => ({ name, status, url, required, seconds });
  const conclusion = String(c.conclusion ?? "").toUpperCase();
  const state = String(c.state ?? c.status ?? "").toUpperCase();
  if (FAILED_CONCLUSIONS.has(conclusion) || FAILED_STATES.has(state)) return as("failed");
  if (conclusion === "SUCCESS" || state === "SUCCESS") return as("passed");
  if (["SKIPPED", "NEUTRAL", "CANCELLED", "STALE"].includes(conclusion)) return as("skipped");
  if (PENDING_STATES.has(state) || (!conclusion && state !== "COMPLETED")) return as("running");
  return as("passed");
}

/** All checks of a PR as one word, with counts. */
export function ciSummary(checks) {
  const n = (s) => checks.filter((c) => c.status === s).length;
  const failed = n("failed"), running = n("running"), passed = n("passed");
  const status = !checks.length ? "none" : failed ? "failed" : running ? "running" : "passed";
  return { status, failed, running, passed, total: checks.length };
}

/** A ticket key from a branch name like fix/ABC-123 or feat/ABC-123-retry. */
export function ticketOf(branch) {
  return /([A-Z][A-Z0-9]+-\d+)/.exec(branch ?? "")?.[1] ?? null;
}

/** A GraphQL pullRequest node as a flat PR object. */
export function normalize(node) {
  const contexts = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const checks = contexts.map(check);
  const reviews = node.reviews?.nodes ?? [];
  const approvals = reviews.filter((r) => r.state === "APPROVED" && r.commit?.oid === node.headRefOid);
  return {
    key: node.url,
    url: node.url,
    number: node.number,
    title: node.title,
    repo: node.repository?.nameWithOwner ?? "",
    draft: Boolean(node.isDraft),
    state: node.state ?? "OPEN",
    mergedAt: node.mergedAt ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    head: node.headRefName,
    base: node.baseRefName,
    ticket: ticketOf(node.headRefName) ?? ticketOf(node.title),
    mergeable: node.mergeable ?? "UNKNOWN",
    mergeState: node.mergeStateStatus ?? "UNKNOWN",
    reviewDecision: node.reviewDecision ?? null,
    approvedBy: approvals.map((r) => ({ login: r.author?.login ?? "someone", at: r.submittedAt })),
    unresolved: (node.reviewThreads?.nodes ?? []).filter((t) => !t.isResolved).length,
    checks,
    ci: ciSummary(checks),
    additions: node.additions ?? 0,
    deletions: node.deletions ?? 0,
    author: node.author?.login ?? null,
    labels: (node.labels?.nodes ?? []).map((l) => ({ name: l.name, color: l.color ?? null })),
    comments: node.totalCommentsCount ?? 0,
    changedFiles: node.changedFiles ?? (node.files?.nodes ?? []).length,
  };
}

/**
 * What the PR needs next, in the sync script's order. rank: lower comes first in the list.
 * kind picks the color: bad, wait, good, idle.
 */
export function prState(pr) {
  if (pr.state === "MERGED") return { label: "Merged", kind: "good", rank: 7 };
  if (pr.state === "CLOSED") return { label: "Closed", kind: "idle", rank: 8 };
  if (pr.draft) return { label: "Draft", kind: "idle", rank: 6 };
  if (pr.mergeable === "CONFLICTING") return { label: "Merge conflict", kind: "bad", rank: 0 };
  if (pr.ci.status === "failed") return { label: "CI failed", kind: "bad", rank: 1 };
  if (pr.unresolved > 0 || pr.reviewDecision === "CHANGES_REQUESTED") return { label: pr.reviewDecision === "CHANGES_REQUESTED" ? "Changes requested" : `${pr.unresolved} open threads`, kind: "bad", rank: 2 };
  if (pr.mergeState === "BLOCKED") return { label: pr.approvedBy.length ? "Blocked" : "Waiting for review", kind: "wait", rank: 3 };
  if (pr.approvedBy.length) return { label: "Ready to merge", kind: "good", rank: 4 };
  return { label: pr.ci.status === "running" ? "CI running" : "Open", kind: "idle", rank: 5 };
}

/** Most urgent first, then the most recently updated. */
export function sortPrs(prs) {
  return [...prs].sort((a, b) => prState(a).rank - prState(b).rank || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** "just now", "3m ago", "2h ago", "4d ago". */
export function ago(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * One step for a Push or Create PR the user clicked: running (the command), done (the result), or failed
 * (the first error line; the full output as `tip`). `action`: { kind, status, cmd, out, result }.
 */
export function actionStep(action, label) {
  if (action.status === "running") return { label, sub: action.cmd, status: "running" };
  if (action.status === "done") return { label, sub: action.result ?? "", status: "done" };
  const out = String(action.out ?? "").trim();
  return { label, sub: out.split("\n").find((l) => l.trim()) ?? "failed", status: "failed", tip: out };
}

/**
 * Before a PR: Push, Open draft PR, then CI, review, and merge to come. `ahead`: commits not on any remote
 * (null: unknown). `action`: the Push or Create PR the user clicked last, if any.
 */
function beforePr(opts) {
  const { ahead = null, base = "main", action = null } = opts;
  const push = action?.kind === "push" ? actionStep(action, action.status === "done" ? "Pushed" : "Push")
    : ahead === 0 ? { label: "Pushed", sub: "everything is on GitHub", status: "done" }
    : { label: "Push", sub: ahead ? `${ahead} not pushed` : "not pushed yet", status: "todo" };
  const open = action?.kind === "create" ? actionStep(action, action.status === "done" ? "Draft PR opened" : "Open draft PR")
    : { label: "Open draft PR", sub: "", status: "todo" };
  return [push, open, { label: "CI", sub: "", status: "todo" }, { label: "Review", sub: "", status: "todo" }, { label: `Merge into ${base}`, sub: "", status: "todo" }];
}

/**
 * The detail timeline: [{ label, sub, status: "done" | "running" | "failed" | "todo", tip? }].
 * pr null: the steps before a PR (opts: ahead, base, action). With a PR, a push the user clicked (or commits
 * not pushed yet) shows right after "PR opened".
 */
export function timeline(pr, now = Date.now(), opts = {}) {
  if (!pr) return beforePr(opts);
  const steps = [{ label: "PR opened", sub: ago(pr.createdAt, now), status: "done" }];
  const { ahead = null, action = null } = opts;
  if (action?.kind === "push") steps.push(actionStep(action, action.status === "done" ? "Pushed" : "Push"));
  else if (ahead) steps.push({ label: "Push", sub: `${ahead} not pushed`, status: "todo" });
  const ci = pr.ci;
  steps.push({
    label: ci.status === "failed" ? "CI failed" : ci.status === "running" ? "CI running" : ci.status === "passed" ? "CI passed" : "No CI",
    sub: ci.total ? `${ci.passed}/${ci.total} passed${ci.failed ? `, ${ci.failed} failed` : ""}` : "",
    status: ci.status === "failed" ? "failed" : ci.status === "running" ? "running" : ci.status === "passed" ? "done" : "todo",
  });
  if (pr.approvedBy.length) {
    const last = pr.approvedBy[pr.approvedBy.length - 1];
    steps.push({ label: "Approved", sub: `${last.at ? `${ago(last.at, now)} · ` : ""}${last.login}`, status: "done" });
  } else if (pr.reviewDecision === "CHANGES_REQUESTED") {
    steps.push({ label: "Changes requested", sub: pr.unresolved ? `${pr.unresolved} open threads` : "", status: "failed" });
  } else {
    steps.push({ label: "Waiting for review", sub: pr.unresolved ? `${pr.unresolved} open threads` : "", status: "todo" });
  }
  if (pr.state === "MERGED") {
    steps.push({ label: `Merged → ${pr.base}`, sub: pr.mergedAt ? ago(pr.mergedAt, now) : "", status: "done" });
    return steps;
  }
  if (pr.state === "CLOSED") {
    steps.push({ label: "Closed without merge", sub: "", status: "failed" });
    return steps;
  }
  steps.push({
    label: pr.mergeable === "CONFLICTING" ? "Merge conflict" : `Merge into ${pr.base}`,
    sub: pr.mergeable === "CONFLICTING" ? "rebase or merge the base" : pr.mergeState === "CLEAN" ? "ready" : pr.mergeState.toLowerCase(),
    status: pr.mergeable === "CONFLICTING" ? "failed" : "todo",
  });
  return steps;
}

/** A run time in seconds as "36s", "6m", or "1h 2m" ("" when unknown). */
export function duration(s) {
  if (s == null) return "";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}

/** A PR's state as a GitHub-style icon (its name in omarchy-chrome/): kind picks the color (good, bad, idle, merged). */
export function stateIcon(pr) {
  if (pr.state === "MERGED") return { icon: "git-merge", kind: "merged", label: "Merged" };
  if (pr.state === "CLOSED") return { icon: "git-pull-request-closed", kind: "bad", label: "Closed" };
  if (pr.draft) return { icon: "git-pull-request-draft", kind: "idle", label: "Draft" };
  return { icon: "git-pull-request", kind: "good", label: "Open" };
}

/** The review decision as words for the list row ("" when there is none). */
export function reviewWord(pr) {
  if (pr.reviewDecision === "APPROVED") return "Approved";
  if (pr.reviewDecision === "CHANGES_REQUESTED") return "Changes requested";
  if (pr.reviewDecision === "REVIEW_REQUIRED") return "Review required";
  return "";
}

/** Failed first, then running, passed, and skipped; the order inside each group stays. */
export function sortChecks(checks) {
  const rank = { failed: 0, running: 1, passed: 2, skipped: 3 };
  return [...checks].sort((a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4));
}

/** A check's line after its name: "Successful in 6m", "Failing after 55s", "Running", or "Skipped". */
export function checkLine(c) {
  const d = duration(c.seconds);
  if (c.status === "passed") return d ? `Successful in ${d}` : "Successful";
  if (c.status === "failed") return d ? `Failing after ${d}` : "Failing";
  if (c.status === "running") return "Running";
  return "Skipped";
}

const BODY_MAX = 12000;

/** A comment body for the view: no HTML comments (bots hide data in them), trimmed, cut at BODY_MAX characters. */
export function cleanBody(text) {
  const s = String(text ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
  return s.length > BODY_MAX ? `${s.slice(0, BODY_MAX)}\n\n… (cut: the rest is on GitHub)` : s;
}

/**
 * A comment body as parts for the view: { kind: "md", text } for plain markdown, and
 * { kind: "details", summary, open, parts } for each <details> block (GitHub draws it as a line that opens on a
 * click). parts has the same shape, so a block can hold blocks. A block that never closes runs to the end.
 */
export function bodyParts(text) {
  const s = String(text ?? "");
  const parts = [];
  const md = (t) => { if (t.trim()) parts.push({ kind: "md", text: t.trim() }); };
  const block = (inner, attrs) => {
    const sm = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(inner);
    const summary = (sm ? sm[1] : "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || "Details";
    const rest = sm ? inner.slice(0, sm.index) + inner.slice(sm.index + sm[0].length) : inner;
    parts.push({ kind: "details", summary, open: /\bopen\b/i.test(attrs), parts: bodyParts(rest) });
  };
  const tag = /<(\/?)details\b([^>]*)>/gi;
  let from = 0, depth = 0, start = 0, attrs = "", m;
  while ((m = tag.exec(s))) {
    if (!m[1]) {
      if (depth === 0) { md(s.slice(from, m.index)); start = tag.lastIndex; attrs = m[2]; }
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) { block(s.slice(start, m.index), attrs); from = tag.lastIndex; }
    }
  }
  if (depth > 0) block(s.slice(start), attrs);
  else md(s.slice(from));
  return parts;
}

/**
 * The last `keep` lines of a review comment's diff hunk as [{ n, sign, text }]. n is the line number in the new
 * file (in the old file for a removed line). sign is "+", "-", or " ".
 */
export function hunkTail(hunk, keep = 4) {
  const lines = String(hunk ?? "").split("\n");
  const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(lines[0] ?? "");
  if (!m) return [];
  let oldN = Number(m[1]), newN = Number(m[2]);
  const out = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    const sign = line[0] === "+" || line[0] === "-" ? line[0] : " ";
    out.push({ n: sign === "-" ? oldN : newN, sign, text: line.slice(1).replace(/\t/g, "  ") });
    if (sign !== "+") oldN += 1;
    if (sign !== "-") newN += 1;
  }
  return out.slice(-keep);
}

/** A thread's place in its file: "Lines 718-728", "Line 728", or "" for a thread on the whole file. */
export function lineRange(th) {
  const end = th.line ?? th.originalLine ?? null, start = th.startLine ?? th.originalStartLine ?? null;
  if (end == null) return "";
  return start != null && start !== end ? `Lines ${start}-${end}` : `Line ${end}`;
}

// A GraphQL actor as { author, bot }.
const person = (a) => ({ author: a?.login ?? "someone", bot: a?.__typename === "Bot" });

/**
 * The detail query's pullRequest node as { checks, commits, commitCount, files, fileCount, pendingReviewers,
 * comments, reviews, threads }. checks carry required and seconds. commits are [{ oid, title, at, author }],
 * oldest first. comments are [{ author, bot, at, body }]; reviews add state; threads are
 * [{ path, lines, resolved, hunk, comments }].
 */
export function detailOf(node) {
  const contexts = node.head?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  return {
    checks: contexts.map(check),
    commits: (node.commitList?.nodes ?? []).map((n) => ({
      oid: n.commit?.oid ?? "", title: n.commit?.messageHeadline ?? "", at: n.commit?.committedDate ?? null,
      author: n.commit?.author?.user?.login ?? n.commit?.author?.name ?? "someone",
    })),
    commitCount: node.commitList?.totalCount ?? (node.commitList?.nodes ?? []).length,
    files: (node.files?.nodes ?? []).map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
    fileCount: node.changedFiles ?? (node.files?.nodes ?? []).length,
    pendingReviewers: (node.reviewRequests?.nodes ?? []).map((r) => r.requestedReviewer?.login ?? r.requestedReviewer?.name ?? "someone"),
    comments: (node.comments?.nodes ?? []).map((c) => ({ ...person(c.author), at: c.createdAt ?? null, body: cleanBody(c.body) })),
    reviews: (node.reviewList?.nodes ?? []).map((r) => ({ ...person(r.author), at: r.submittedAt ?? null, state: r.state ?? "COMMENTED", body: cleanBody(r.body) })),
    threads: (node.threads?.nodes ?? []).map((th) => {
      const cs = th.comments?.nodes ?? [];
      return {
        path: th.path ?? "", lines: lineRange(th), resolved: Boolean(th.isResolved), hunk: hunkTail(cs[0]?.diffHunk),
        comments: cs.map((c) => ({ ...person(c.author), at: c.createdAt ?? null, body: cleanBody(c.body) })),
      };
    }),
  };
}

/**
 * The Overview box: { checks, comments, approvals }, each { title, sub, kind, bar }. bar is one kind per segment
 * (good, bad, wait, idle): one segment per check for Checks, one segment for the other two.
 * detail is null until the detail query returns: then the list's checks count, without required flags.
 */
export function overview(pr, detail) {
  const checks = detail?.checks ?? pr.checks;
  const n = (s) => checks.filter((c) => c.status === s).length;
  const failed = n("failed"), running = n("running"), passed = n("passed"), skipped = n("skipped"), total = checks.length;
  const reqFailed = checks.filter((c) => c.status === "failed" && c.required).length;
  const fill = (count, kind) => Array(count).fill(kind);
  const pending = detail?.pendingReviewers?.length ?? 0;
  const approved = pr.approvedBy.length;
  const changes = pr.reviewDecision === "CHANGES_REQUESTED";
  const reviewKind = changes ? "bad" : approved ? "good" : "idle";
  return {
    checks: {
      title: "Checks",
      sub: !total ? "No checks" : reqFailed ? `${reqFailed} required failing` : failed ? `${failed} failing` : running ? `${running} running` : "All passed",
      kind: failed ? "bad" : running ? "wait" : total ? "good" : "idle",
      bar: total ? [...fill(passed, "good"), ...fill(failed, "bad"), ...fill(running, "wait"), ...fill(skipped, "idle")] : ["idle"],
    },
    comments: {
      title: "Comments",
      sub: pr.unresolved ? `${pr.unresolved} unresolved` : "All resolved",
      kind: pr.unresolved ? "bad" : "good",
      bar: [pr.unresolved ? "bad" : "idle"],
    },
    approvals: {
      title: "Approvals",
      sub: changes ? "Changes requested" : approved ? `${approved} approved${pending ? `, ${pending} pending` : ""}` : pending ? `${pending} pending` : "None yet",
      kind: reviewKind,
      bar: [reviewKind],
    },
  };
}

/**
 * The Overview's activity list, newest first: [{ kind, at, ... }].
 * - "comment": author, bot, body.
 * - "review": author, bot, state, body. A review with no body shows only when it approves or asks for changes.
 * - "thread": path, lines, resolved, hunk, comments. Its time is its first comment's.
 * - "commits": commits (newest first) that follow each other with nothing between them.
 * - "opened": author. Always the last entry.
 * detail is null until the detail query returns: then only "opened".
 */
export function activity(pr, detail) {
  const d = detail ?? {};
  const time = (x) => Date.parse(x.at ?? "") || 0;
  const items = [
    ...(d.comments ?? []).map((c) => ({ kind: "comment", ...c })),
    ...(d.reviews ?? []).filter((r) => r.body || r.state === "APPROVED" || r.state === "CHANGES_REQUESTED").map((r) => ({ kind: "review", ...r })),
    ...(d.threads ?? []).filter((th) => th.comments.length).map((th) => ({ kind: "thread", at: th.comments[0].at, ...th })),
    ...(d.commits ?? []).map((c) => ({ kind: "commit", at: c.at, commit: c })),
  ].sort((a, b) => time(b) - time(a));
  const out = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (it.kind !== "commit") out.push(it);
    else if (last?.kind === "commits") last.commits.push(it.commit);
    else out.push({ kind: "commits", at: it.at, commits: [it.commit] });
  }
  out.push({ kind: "opened", at: pr.createdAt, author: pr.author ?? "someone" });
  return out;
}
