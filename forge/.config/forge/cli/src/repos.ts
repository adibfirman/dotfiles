import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Refused, withLock, type Run } from "./append";

// Workspace mode: the run lives at a root that is not a git repo but holds repos (like ~/work with one folder per repo).
// Each repo the run touches gets its own worktree at <root>/worktrees/<ticket>/<repo>. The user's own
// checkouts are never touched: forge fetches the base and works in the worktree only.

export interface RepoEntry { name: string; path: string; base: string; worktree: string; branch: string | null; remote: string | null; added: string }

function git(cwd: string, args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: process.env });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

export const isRepo = (dir: string) => existsSync(dir) && git(dir, ["rev-parse", "--git-dir"]).ok;

/** Direct child folders of root that are git repos (the workspace's repos). */
export function childRepos(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "worktrees" && existsSync(join(root, d.name, ".git")))
    .map((d) => d.name)
    .sort();
}

/** The repo's default branch from origin/HEAD (develop or main), else main. */
export function defaultBase(path: string): string {
  const r = git(path, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  return r.ok ? r.out.replace(/^origin\//, "") : "main";
}

function remoteOf(path: string): string | null {
  const url = git(path, ["remote", "get-url", "origin"]);
  const m = url.ok && /[:/]([^/:]+\/[^/]+?)(\.git)?$/.exec(url.out);
  return m ? m[1] : null;
}

function meta(run: Run): any {
  return JSON.parse(readFileSync(join(run.dir, "run.json"), "utf8"));
}

function saveMeta(run: Run, m: any) {
  writeFileSync(join(run.dir, "run.json"), JSON.stringify(m, null, 2) + "\n");
}

export const isWorkspace = (run: Run) => meta(run).mode === "workspace";
export const listRepos = (run: Run): RepoEntry[] => meta(run).repos ?? [];

/** A repo's worktree for a node, or null when the run is not a workspace or the repo is unknown. */
export function repoWorktree(run: Run, name: string | undefined): string | null {
  if (!name) return null;
  return listRepos(run).find((r) => r.name === name)?.worktree ?? null;
}

function fetchBase(path: string, base: string) {
  const r = git(path, ["fetch", "origin", base]);
  if (!r.ok) throw new Refused(`git fetch origin ${base} failed in ${path}: ${r.err.slice(0, 200)}`);
}

/**
 * Add repos to a workspace run: "name" or "name@base". Each one: fetch origin/<base>, then a detached
 * worktree at origin/<base> for grill to read. All are checked before any worktree is made.
 */
export function addRepos(run: Run, specs: string[]): RepoEntry[] {
  return withLock(run, () => {
    const m = meta(run);
    if (m.mode !== "workspace") throw new Refused("forge repo works in a workspace run only (a root folder that holds repos)");
    const have: RepoEntry[] = m.repos ?? [];
    const todo = specs.map((s) => {
      const [name, override] = s.split("@");
      const path = join(m.main, name);
      if (!/^[A-Za-z0-9._-]+$/.test(name) || !isRepo(path)) throw new Refused(`${name} is not a git repo in ${m.main}`);
      return { name, path, base: override || defaultBase(path) };
    }).filter((t) => !have.some((h) => h.name === t.name));
    for (const t of todo) fetchBase(t.path, t.base); // all fetches first: one failure adds none
    const added: RepoEntry[] = [];
    for (const t of todo) {
      const worktree = join(m.main, "worktrees", m.ticket, t.name);
      if (!existsSync(worktree)) {
        const r = git(t.path, ["worktree", "add", "--detach", worktree, `origin/${t.base}`]);
        if (!r.ok) throw new Refused(`git worktree add failed for ${t.name}: ${r.err.slice(0, 200)}`);
      }
      added.push({ name: t.name, path: t.path, base: t.base, worktree, branch: null, remote: remoteOf(t.path), added: new Date().toISOString() });
    }
    m.repos = [...have, ...added];
    saveMeta(run, m);
    return added;
  });
}

/** At exec start: fetch each base again, then put each worktree on <type>/<ticket> from the newest origin/<base>. */
export function branchRepos(run: Run): RepoEntry[] {
  return withLock(run, () => {
    const m = meta(run);
    if (m.mode !== "workspace") throw new Refused("forge repo branch works in a workspace run only");
    const branch = `${m.type ?? "feat"}/${m.ticket}`;
    for (const r of m.repos as RepoEntry[]) {
      if (r.branch) continue;
      fetchBase(r.path, r.base);
      const exists = git(r.path, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
      const sw = exists ? git(r.worktree, ["switch", branch]) : git(r.worktree, ["switch", "-c", branch, `origin/${r.base}`]);
      if (!sw.ok) throw new Refused(`git switch failed in ${r.worktree}: ${sw.err.slice(0, 200)}`);
      r.branch = branch;
    }
    saveMeta(run, m);
    return m.repos;
  });
}

/** Repos with their current HEAD (the base of the next wave). */
export function reposWithHead(run: Run) {
  return listRepos(run).map((r) => ({ ...r, head: git(r.worktree, ["rev-parse", "HEAD"]).out || null }));
}
