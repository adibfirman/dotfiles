import { expect, test } from "bun:test";
import { appendFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { entries, registerExisting, runs, titleOf } from "../src/registry";
import { init } from "../src/init";
import { removeRun, startCoordinator } from "../src/agents";
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
