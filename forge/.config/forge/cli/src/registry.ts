import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { readLines, Refused, type Run } from "./append";

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

/** Registered runs whose folder still exists, newest first, the last line per folder winning. */
export function entries(): Entry[] {
  const byDir = new Map<string, Entry>();
  for (const l of readLines(registryFile())) {
    try {
      const e = JSON.parse(l) as Entry;
      byDir.set(e.dir, e);
    } catch {
      /* a broken line is skipped */
    }
  }
  return [...byDir.values()].filter((e) => existsSync(join(e.dir, "run.json"))).sort((a, b) => b.created.localeCompare(a.created));
}

/** The registered runs with their HEAD (cycle, phase, approved, paused). */
export function runs() {
  return entries().map((e) => {
    const head = join(e.dir, "HEAD");
    return { ...e, head: existsSync(head) ? JSON.parse(readFileSync(head, "utf8")) : null };
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
