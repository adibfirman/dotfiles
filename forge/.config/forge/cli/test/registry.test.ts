import { expect, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { entries, registerExisting, runs, titleOf } from "../src/registry";
import { init } from "../src/init";
import { removeRun, restoreRun, startCoordinator } from "../src/agents";
import { loadState } from "../src/append";
import { main } from "../src/main";
import { hcCalls, setup } from "./helpers";

test("init registers the run with its title and current branch", () => {
  const env = setup();
  spawnSync("git", ["remote", "add", "origin", "git@github.com:acme/shop.git"], { cwd: env.repo });
  const [e] = entries();
  expect(e).toMatchObject({ ticket: env.run.ticket, dir: env.run.dir, worktree: env.repo, branch: "main", title: "Build the thing." });
  expect(runs()[0].head).toMatchObject({ cycle: 1, phase: "grill" });
  expect(runs()[0].coordinator).toBeNull();
  startCoordinator(env.run);
  expect(runs()[0].coordinator).toEqual({ id: "grill-coord-1", terminal: "t-f-local-task-1-grillc-g1" });
});

test("repo comes from the origin remote", () => {
  const env = setup();
  rmSync(process.env.FORGE_REGISTRY!);
  spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/shop.git"], { cwd: env.repo });
  registerExisting(env.run);
  expect(entries()[0].repo).toBe("acme/shop");
});

test("a run whose folder is gone drops out, and a broken line is skipped", () => {
  const env = setup();
  appendFileSync(process.env.FORGE_REGISTRY!, "{broken\n" + JSON.stringify({ ticket: "X-1", dir: join(env.root, "gone"), created: "2030-01-01" }) + "\n");
  expect(entries().map((e) => e.ticket)).toEqual([env.run.ticket]);
});

test("register twice keeps one entry", () => {
  const env = setup();
  registerExisting(env.run);
  expect(entries()).toHaveLength(1);
});

test("init --here uses this checkout and its branch, with the ticket as the run name", () => {
  const env = setup();
  spawnSync("git", ["checkout", "-q", "-b", "feat/ABC-9"], { cwd: env.repo });
  const ctx = join(env.root, "here.md");
  writeFileSync(ctx, "---\nticket: ABC-9\n---\n# Retry payments\n");
  const run = init(ctx, env.repo, 4, true);
  expect([run.ticket, run.worktree]).toEqual(["ABC-9", env.repo]);
  expect(entries().find((e) => e.ticket === "ABC-9")).toMatchObject({ branch: "feat/ABC-9", title: "Retry payments" });
});

test("init --space saves the space in run.json, and runs() shows it (null without it)", async () => {
  const env = setup();
  const ctx = join(env.root, "space.md");
  writeFileSync(ctx, "---\nticket: ABC-7\n---\n# Space pick\n");
  process.chdir(env.repo);
  expect(await main(["init", ctx, "--here", "--space", "work"])).toBe(0);
  expect(runs().find((r) => r.ticket === "ABC-7")?.space).toBe("work");
  expect(runs().find((r) => r.ticket === env.run.ticket)?.space).toBeNull();
});

test("titleOf skips front matter and heading marks", () => {
  expect(titleOf("---\nticket: none\n---\n\n# Refunds\n\nAdd refunds.")).toBe("Refunds");
});

test("removeRun: ends live agents, takes the run off the list, keeps its forge folder; purge deletes it", () => {
  const env = setup();
  startCoordinator(env.run);
  const r = removeRun(env.run);
  expect(r.killed).toEqual(["t-f-local-task-1-grillc-g1"]);
  expect(hcCalls(env).some((c) => c[0] === "kill" && c[1] === "t-f-local-task-1-grillc-g1")).toBe(true);
  expect(entries()).toHaveLength(0);
  expect(existsSync(env.run.dir)).toBe(true);
  // A ticket-less run works in the main checkout: no worktree of its own to remove.
  expect(r.worktrees).toEqual({ removed: [], skipped: [] });
  expect(existsSync(env.repo)).toBe(true);
  expect(removeRun(env.run, true).kept).toBe(false);
  expect(existsSync(env.run.dir)).toBe(false);
});

test("runs --removed lists a removed run; restore lists it again in the given space, once", () => {
  const env = setup();
  removeRun(env.run);
  expect(runs()).toEqual([]);
  expect(runs({ removed: true })).toMatchObject([{ dir: env.run.dir, removed: true }]);
  expect(restoreRun(env.run, "work")).toMatchObject({ restored: env.run.dir, worktrees: [], space: "work" });
  expect(runs()).toMatchObject([{ dir: env.run.dir, space: "work" }]);
  expect(runs({ removed: true }).some((r) => r.removed)).toBe(false);
  expect(() => restoreRun(env.run)).toThrow("listed already");
});

test("hasSpec: false until a cycle has a grill draft", () => {
  const env = setup();
  expect(runs()[0].hasSpec).toBe(false);
  const { cycleDir } = loadState(env.run);
  mkdirSync(join(cycleDir, "grill"), { recursive: true });
  writeFileSync(join(cycleDir, "grill", "SPEC.draft.md"), "d");
  expect(runs()[0].hasSpec).toBe(true);
});

test("restore makes the ticket worktree again on the kept branch, without --base, so its commits stay", () => {
  const env = setup();
  const g = (...a: string[]) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: env.repo, encoding: "utf8" }).stdout.trim();
  // A fake herdr: logs its args, then makes the worktree with git (on the branch, or a new branch from --base).
  const herdr = join(env.root, "herdr");
  writeFileSync(herdr, `#!/bin/sh\necho "$@" >> "${env.root}/herdr.log"\nwhile [ $# -gt 0 ]; do case "$1" in --cwd) C=$2; shift;; --branch) B=$2; shift;; --base) S=$2; shift;; esac; shift; done\nD="${env.root}/wt-$(echo "$B" | tr / -)"\ngit -C "$C" worktree add -q "$D" "$B" 2>/dev/null || git -C "$C" worktree add -q -b "$B" "$D" "$S"\n`);
  chmodSync(herdr, 0o755);
  process.env.FORGE_HERDR = herdr;
  try {
    const ctx = join(env.root, "t.md");
    writeFileSync(ctx, "---\nticket: ABC-3\n---\n# Ticket run\n");
    const run = init(ctx, env.repo);
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "work"], { cwd: run.worktree });
    const head = g("rev-parse", "feat/ABC-3");
    removeRun(run);
    expect(existsSync(run.worktree)).toBe(false);
    const r = restoreRun(run);
    expect(r.worktrees).toHaveLength(1);
    expect(existsSync(r.worktrees[0])).toBe(true);
    expect(g("rev-parse", "feat/ABC-3")).toBe(head);
    const calls = readFileSync(join(env.root, "herdr.log"), "utf8").trim().split("\n");
    expect(calls[0]).toContain("--base");
    expect(calls[calls.length - 1]).not.toContain("--base");
  } finally {
    delete process.env.FORGE_HERDR;
  }
});
