import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { mainCheckout, openFirstCycle, Refused, slugify, type Run } from "./append";
import { register } from "./registry";
import { childRepos } from "./repos";

const herdrBin = () => process.env.FORGE_HERDR ?? "herdr";

/** The `- item` lines under `key:` in the front matter (refs: one URL or path per line). */
export function frontMatterList(text: string, key: string): string[] {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const lines = m?.[1].split("\n") ?? [];
  const at = lines.findIndex((l) => new RegExp(`^${key}:\\s*$`).test(l.trim()));
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    const item = /^\s*-\s+(.+?)\s*$/.exec(l);
    if (!item) break;
    out.push(item[1]);
  }
  return out;
}

/** `key: value` lines between the first two `---` lines. */
export function frontMatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const out: Record<string, string> = {};
  for (const line of m?.[1].split("\n") ?? []) {
    const kv = /^([a-z_]+):\s*(.*?)\s*(#.*)?$/.exec(line.trim());
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

function git(cwd: string, args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

function worktreeFor(main: string, branch: string): string | null {
  const list = git(main, ["worktree", "list", "--porcelain"]).out.split("\n\n");
  for (const block of list) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (path && block.includes(`branch refs/heads/${branch}`)) return path;
  }
  return null;
}

function hideForge(main: string) {
  const common = git(main, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).out;
  const exclude = join(common, "info", "exclude");
  mkdirSync(join(common, "info"), { recursive: true });
  const text = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  if (!text.split("\n").includes(".forge/")) appendFileSync(exclude, (text && !text.endsWith("\n") ? "\n" : "") + ".forge/\n");
}

/**
 * Workspace mode: cwd is not a git repo but holds repos. The run lives at cwd/.forge/; repos join with
 * forge repo add (or repos: in the context), each in its own worktree.
 */
function initWorkspace(contextFile: string, fm: Record<string, string>, root: string, cap: number): Run {
  const repos = childRepos(root);
  if (!repos.length) throw new Refused(`${root} is not a git repo and holds no git repos. Run git init there, or start forge inside a repo.`);
  const ticketField = fm.ticket ?? "none";
  if (ticketField !== "none" && !/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(ticketField)) throw new Refused(`ticket "${ticketField}" is not a ticket key like INTR-123`);
  const type = fm.type ?? "feat";
  if (!["fix", "feat", "chore"].includes(type)) throw new Refused(`type must be fix, feat, or chore, not "${type}"`);
  const ticket = ticketField !== "none" ? ticketField : `local-${slugify(basename(contextFile).replace(/\.md$/, "").replace(/^\./, ""))}`;
  const dir = join(root, ".forge", "tickets", ticket);
  if (existsSync(join(dir, "run.json"))) throw new Refused(`forge run ${ticket} exists already: use forge status, or add a follow-up`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.json"), JSON.stringify({ ticket, mode: "workspace", type, branch: null, base: null, main: root, worktree: root, repos: [], created: new Date().toISOString() }, null, 2) + "\n");
  const run: Run = { dir, ticket, main: root, worktree: root };
  const { cycleDir } = openFirstCycle(run, cap);
  copyFileSync(contextFile, join(cycleDir, "context.md"));
  register(run, readFileSync(contextFile, "utf8"), null);
  return run;
}

/**
 * Start a run from context.md: worktree for the ticket, .forge/tickets/<ticket>/, cycle 001 at grill.
 * here: run in cwd's checkout as it is (no new worktree); the ticket key still names the run.
 */
export function init(contextFile: string, cwd = process.cwd(), cap = Number(process.env.FORGE_CAP ?? 4), here = false): Run {
  if (!existsSync(contextFile)) throw new Refused(`context file not found: ${contextFile}`);
  const fm = frontMatter(readFileSync(contextFile, "utf8"));
  if (!git(cwd, ["rev-parse", "--git-dir"]).ok) return initWorkspace(contextFile, fm, cwd, cap);
  const main = mainCheckout(cwd);
  const ticketField = fm.ticket ?? "none";
  let ticket: string;
  let worktree: string;
  let branch: string | null = null;

  if (here) {
    if (ticketField !== "none" && !/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(ticketField)) throw new Refused(`ticket "${ticketField}" is not a ticket key like INTR-123`);
    worktree = git(cwd, ["rev-parse", "--show-toplevel"]).out || cwd;
    branch = git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]).out || null;
    ticket = ticketField !== "none" ? ticketField : `local-${slugify(basename(contextFile).replace(/\.md$/, "").replace(/^\./, ""))}`;
  } else if (ticketField === "none") {
    ticket = `local-${slugify(basename(contextFile).replace(/\.md$/, "").replace(/^\./, ""))}`;
    worktree = cwd;
  } else {
    if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(ticketField)) throw new Refused(`ticket "${ticketField}" is not a ticket key like INTR-123`);
    const type = fm.type ?? "feat";
    if (!["fix", "feat", "chore"].includes(type)) throw new Refused(`type must be fix, feat, or chore, not "${type}"`);
    ticket = ticketField;
    branch = `${type}/${ticket}`;
    const base = fm.base ?? "main";
    let found = worktreeFor(main, branch);
    if (!found) {
      const r = spawnSync(herdrBin(), ["worktree", "create", "--cwd", main, "--branch", branch, "--base", base, "--no-focus", "--json"], { encoding: "utf8", env: process.env });
      if (r.status !== 0) throw new Refused(`herdr worktree create failed: ${(r.stderr || r.stdout || "").trim()}`);
      found = worktreeFor(main, branch);
      if (!found) throw new Refused(`herdr made no worktree for branch ${branch}`);
    }
    worktree = found;
  }

  const dir = join(main, ".forge", "tickets", ticket);
  if (existsSync(join(dir, "run.json"))) throw new Refused(`forge run ${ticket} exists already: use forge status, or add a follow-up`);
  mkdirSync(dir, { recursive: true });
  hideForge(main);
  writeFileSync(join(dir, "run.json"), JSON.stringify({ ticket, branch, base: fm.base ?? null, main, worktree, created: new Date().toISOString() }, null, 2) + "\n");
  const run: Run = { dir, ticket, main, worktree };
  const { cycleDir } = openFirstCycle(run, cap);
  copyFileSync(contextFile, join(cycleDir, "context.md"));
  // ticket: none runs on the current branch, so record it for the PR lookup.
  register(run, readFileSync(contextFile, "utf8"), branch ?? git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]).out ?? null);
  return run;
}
