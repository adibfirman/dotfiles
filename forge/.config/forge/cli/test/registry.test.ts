import { expect, test } from "bun:test";
import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { entries, registerExisting, runs, titleOf } from "../src/registry";
import { setup } from "./helpers";

test("init registers the run with its title and current branch", () => {
  const env = setup();
  spawnSync("git", ["remote", "add", "origin", "git@github.com:acme/shop.git"], { cwd: env.repo });
  const [e] = entries();
  expect(e).toMatchObject({ ticket: env.run.ticket, dir: env.run.dir, worktree: env.repo, branch: "main", title: "Build the thing." });
  expect(runs()[0].head).toMatchObject({ cycle: 1, phase: "grill" });
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

test("titleOf skips front matter and heading marks", () => {
  expect(titleOf("---\nticket: none\n---\n\n# Refunds\n\nAdd refunds.")).toBe("Refunds");
});
