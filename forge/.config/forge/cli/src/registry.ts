import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadState, readLines, Refused, type Run } from "./append";
import { needsOf } from "./checks";

/** Every run on this machine, one JSON line each. The prs mod lists runs from here. */
export const registryFile = () => process.env.FORGE_REGISTRY ?? join(homedir(), ".local", "state", "forge", "runs.jsonl");

export interface Entry { ticket: string; dir: string; main: string; worktree: string; branch: string | null; repo: string | null; title: string; created: string }

function git(cwd: string, args: string[]): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: process.env });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** owner/name from the origin remote (https or ssh), or null. */
export function repoOf(cwd: string): string | null {
  const url = git(cwd, ["remote", "get-url", "origin"]);
  const m = url && /[:/]([^/:]+\/[^/]+?)(\.git)?$/.exec(url);
  return m ? m[1] : null;
}

/** The first line of a context file's body, without front matter or heading marks. */
export function titleOf(contextText: string): string {
  const body = contextText.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const line = body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.replace(/^#+\s*/, "").slice(0, 120);
}

export function register(run: Run, contextText: string, branch?: string | null) {
  const file = registryFile();
  if (entries().some((e) => e.dir === run.dir)) return;
  const e: Entry = {
    ticket: run.ticket, dir: run.dir, main: run.main, worktree: run.worktree,
    branch: branch ?? git(run.worktree, ["rev-parse", "--abbrev-ref", "HEAD"]),
    repo: repoOf(run.worktree), title: titleOf(contextText), created: new Date().toISOString(),
  };
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(e) + "\n");
}

/** Take a run off the list (a later line wins, so a removed line hides it). */
export function unregister(dir: string) {
  const file = registryFile();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ dir, removed: true, created: new Date().toISOString() }) + "\n");
}

/** Registered runs whose folder still exists, newest first, the last line per folder winning. */
export function entries(): Entry[] {
  const byDir = new Map<string, Entry>();
  for (const l of readLines(registryFile())) {
    try {
      const e = JSON.parse(l) as Entry & { removed?: boolean };
      if (e.removed) byDir.delete(e.dir);
      else byDir.set(e.dir, e);
    } catch {
      /* a broken line is skipped */
    }
  }
  return [...byDir.values()].filter((e) => existsSync(join(e.dir, "run.json"))).sort((a, b) => b.created.localeCompare(a.created));
}

/** Show the run under another title (a new line for the same folder; the last line wins). */
export function rename(dir: string, title: string) {
  const cur = entries().find((e) => e.dir === dir);
  if (!cur) throw new Refused(`no listed run at ${dir}`);
  const t = title.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!t) throw new Refused("the title is empty");
  appendFileSync(registryFile(), JSON.stringify({ ...cur, title: t }) + "\n");
  return { dir, title: t };
}

/**
 * For notifications: the blocked nodes of the current cycle, the plan waves whose commit node is done
 * (commit-w<k>, or commit-w<k>-<repo> for every repo of that wave), and the plan's number of waves when known.
 */
export function progressOf(e: Entry, head: any): { blocked: string[]; committed: number[]; waves: number | null } {
  if (!head?.dir) return { blocked: [], committed: [], waves: null };
  let nodes: { id: string; status: string; blocked?: boolean }[] = [];
  try {
    nodes = [...loadState({ dir: e.dir, ticket: e.ticket, main: e.main, worktree: e.worktree }).state.nodes.values()] as any;
  } catch {
    return { blocked: [], committed: [], waves: null };
  }
  const byWave = new Map<number, boolean>();
  for (const n of nodes) {
    const m = /^commit-w(\d+)(?:-|$)/.exec(n.id);
    if (m) byWave.set(Number(m[1]), (byWave.get(Number(m[1])) ?? true) && n.status === "done");
  }
  let waves: number | null = null;
  const plan = join(e.dir, "cycles", head.dir, "exec", "plan.md");
  if (existsSync(plan)) {
    try {
      const block = /```json\s*\n([\s\S]*?)\n```/.exec(readFileSync(plan, "utf8"));
      if (block) waves = JSON.parse(block[1]).waves?.length ?? null;
    } catch {
      /* a plan being written: no total yet */
    }
  }
  return {
    blocked: nodes.filter((n) => n.blocked).map((n) => n.id),
    committed: [...byWave].filter(([, done]) => done).map(([k]) => k).sort((a, b) => a - b),
    waves,
  };
}

/** The newest coordinator of the current cycle and its terminal (from its .spawn file), or null. */
export function coordinatorOf(dir: string, head: any): { id: string; terminal: string } | null {
  if (!head?.dir) return null;
  const cycle = join(dir, "cycles", head.dir);
  const starts = readLines(join(cycle, "events.jsonl")).map((l) => JSON.parse(l)).filter((e) => e.kind === "coord_start");
  const last = starts[starts.length - 1];
  if (!last) return null;
  const spawn = join(cycle, ".spawn", `${last.data.id}.json`);
  return existsSync(spawn) ? { id: last.data.id, terminal: JSON.parse(readFileSync(spawn, "utf8")).terminal } : null;
}

/** The registered runs with their HEAD (cycle, phase, approved, paused), their newest coordinator, and, for workspaces, their repos. */
export function runs() {
  return entries().map((e) => {
    const headFile = join(e.dir, "HEAD");
    const head = existsSync(headFile) ? JSON.parse(readFileSync(headFile, "utf8")) : null;
    const meta = JSON.parse(readFileSync(join(e.dir, "run.json"), "utf8"));
    const p = progressOf(e, head);
    const repos = meta.mode === "workspace" ? (meta.repos ?? []).map((r: any) => ({ name: r.name, remote: r.remote, branch: r.branch, worktree: r.worktree })) : undefined;
    return { ...e, mode: meta.mode ?? "repo", ...(repos ? { repos } : {}), head, coordinator: coordinatorOf(e.dir, head), chat: meta.chat ?? null, blocked: p.blocked, progress: { committed: p.committed, waves: p.waves }, needs: needsOf({ dir: e.dir, ticket: e.ticket, main: e.main, worktree: e.worktree }) };
  });
}

/** Add a run made before the registry existed. Its title comes from cycle 001's context.md. */
export function registerExisting(run: Run) {
  const ctx = join(run.dir, "cycles");
  const first = existsSync(ctx) ? readdirFirst(ctx) : null;
  const text = first && existsSync(join(first, "context.md")) ? readFileSync(join(first, "context.md"), "utf8") : "";
  if (!text) throw new Refused(`no context.md in the first cycle of ${run.dir}`);
  const meta = JSON.parse(readFileSync(join(run.dir, "run.json"), "utf8"));
  register(run, text, meta.branch ?? null);
}

function readdirFirst(dir: string): string | null {
  const names = readdirSync(dir).filter((n) => /^\d{3}-/.test(n)).sort();
  return names.length ? join(dir, names[0]) : null;
}
