import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertClean, followup, followups, grillMode, phaseCoord, startCoordinator } from "../src/agents";
import { entries, rename, runs } from "../src/registry";
import { CHAT_DENY, chatArgs, openChat } from "../src/chat";
import { projectChecks, projectGrill, setModels, setRunDefault, settings } from "../src/config";
import { setRunOptions } from "../src/init";
import { main } from "../src/main";
import { runMeta, runOptions } from "../src/repos";
import { status } from "../src/status";
import { add, hcCalls, setup, toExec } from "./helpers";

const quiet = async <T>(fn: () => T | Promise<T>): Promise<T> => {
  const log = console.log, err = console.error;
  console.log = console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = err; }
};

test("fable is a model", () => {
  const env = setup();
  setModels(env.repo, ["unit=fable"]);
  expect(settings(env.repo).models.unit).toEqual({ value: "fable", from: "project" });
  expect(() => setModels(env.repo, ["unit=gpt"])).toThrow("fable, opus, sonnet, haiku, or default");
});

test("grill and checks: repo defaults are auto and light; the dialog's pick is kept", () => {
  const env = setup();
  expect([projectGrill(env.repo), projectChecks(env.repo)]).toEqual(["auto", "light"]);
  expect(settings(env.repo).checks).toEqual({ value: "light", from: "default" });
  setRunDefault(env.repo, "grill", "me");
  setRunDefault(env.repo, "checks", "off");
  expect(settings(env.repo).grill).toEqual({ value: "me", from: "project" });
  expect(settings(env.repo).checks).toEqual({ value: "off", from: "project" });
  expect(() => setRunDefault(env.repo, "checks", "some")).toThrow("full, light, off");
});

test("a run made before the options grills with agents and runs full checks; init flags set them", () => {
  const env = setup();
  expect(runOptions(env.run)).toEqual({ grill: "auto", checks: "full" });
  setRunOptions(env.run, "me", "light");
  expect(runOptions(env.run)).toEqual({ grill: "me", checks: "light" });
  expect(status(env.run)).toMatchObject({ grill: "me", checks: "light", chat: null });
  expect(() => setRunOptions(env.run, "me", "most")).toThrow("--checks must be");
  expect(() => setRunOptions(env.run, "you", "off")).toThrow("--grill must be");
});

test("forge init takes --grill and --checks, else the repo's defaults", async () => {
  const env = setup();
  const ctx = join(env.root, "two.md");
  writeFileSync(ctx, "---\nticket: none\n---\nAnother thing.\n");
  setRunDefault(env.repo, "checks", "off");
  const cwd = process.cwd();
  process.chdir(env.repo);
  try {
    expect(await quiet(() => main(["init", ctx, "--grill", "me"]))).toBe(0);
  } finally {
    process.chdir(cwd);
  }
  const meta = JSON.parse(readFileSync(join(env.repo, ".forge", "tickets", "local-two", "run.json"), "utf8"));
  expect([meta.grill, meta.checks]).toEqual(["me", "off"]);
});

test("with me: the grill coordinator is grill-me-coord; other phases keep theirs", () => {
  const env = setup();
  writeFileSync(join(env.home, "roles", "grill-me-coord.md"), "You are grill-me-coord.\n");
  expect(phaseCoord(env.run, "grill")).toBe("grill-coord");
  setRunOptions(env.run, "me", "light");
  expect(phaseCoord(env.run, "grill")).toBe("grill-me-coord");
  expect(phaseCoord(env.run, "exec")).toBe("exec-coord");
  const c = startCoordinator(env.run);
  expect(c.role).toBe("grill-me-coord");
  expect(() => startCoordinator(env.run, "grill-coord")).toThrow("does not run phase grill");
});

test("chat: the user's own claude with the run brief, only forge internals blocked, one session resumed", () => {
  const env = setup();
  const claudeDir = join(env.root, "claude-home");
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
  writeFileSync(join(env.home, "roles", "_chat.md"), "You are the chat.\n");
  try {
    const a = chatArgs(env.run);
    expect(a.args[0]).toBe("--session-id");
    expect(a.args).not.toContain("--setting-sources");
    expect(a.args).not.toContain("--strict-mcp-config");
    expect(CHAT_DENY).toEqual(["Bash(forge append:*)", "Bash(forge spawn:*)", "Bash(forge coord:*)", "Bash(forge reconcile:*)"]);
    const brief = readFileSync(a.args[a.args.indexOf("--append-system-prompt-file") + 1], "utf8");
    expect(brief).toContain("You are the chat.");
    expect(brief).toContain(`Run folder: ${env.run.dir}`);
    const settingsFile = a.args[a.args.indexOf("--settings") + 1];
    expect(JSON.parse(readFileSync(settingsFile, "utf8")).env.FORGE_RUN).toBe(env.run.dir);
    expect(a.cwd).toBe(env.run.worktree);
    expect(chatArgs(env.run).session).toBe(a.session);
    mkdirSync(join(claudeDir, "projects", "some-folder"), { recursive: true });
    writeFileSync(join(claudeDir, "projects", "some-folder", `${a.session}.jsonl`), "{}\n");
    expect(chatArgs(env.run).args.slice(0, 2)).toEqual(["--resume", a.session]);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

test("chat --open: its own labeled terminal, kept in run.json, reused while live; --message is its next prompt", () => {
  const env = setup();
  const first = openChat(env.run, "PR #3: read inbox/pr-3.md");
  expect(first.reused).toBe(false);
  const run = hcCalls(env).filter((c) => c[0] === "run").pop()!;
  const flags = run.slice(0, run.indexOf("claude"));
  expect(flags).toEqual(expect.arrayContaining(["--label", "forge=local-task/chat", "--outlive-parent", "--no-notify"]));
  expect(flags).not.toContain("--parent");
  expect(run[run.length - 1]).toBe("PR #3: read inbox/pr-3.md");
  expect(runMeta(env.run).chat).toEqual({ session: first.session, terminal: first.terminal });
  expect(openChat(env.run, "again")).toEqual({ ...first, reused: true });
  expect(hcCalls(env).some((c) => c[0] === "send" && c[1] === first.terminal && c[2] === "again")).toBe(true);
  // Ended: a new terminal, the same conversation.
  appendFileSync(env.log + ".dead", `${first.terminal}\n`);
  const again = openChat(env.run);
  expect([again.reused, again.session]).toEqual([false, first.session]);
});

test("followup: refused while the worktree has changes not committed (not for a coordinator's own)", async () => {
  const env = setup();
  writeFileSync(join(env.repo, "edit.txt"), "by hand\n");
  expect(() => assertClean(env.run)).toThrow(/commit or stash first.*edit\.txt/);
  expect(await quiet(() => main(["followup", "fix it", "--run", env.run.dir]))).toBe(1);
  expect(followups(env.run)).toEqual([]);
  process.env.FORGE_NODE = "exec-coord-1";
  try {
    expect(() => assertClean(env.run)).not.toThrow();
  } finally {
    delete process.env.FORGE_NODE;
  }
});

test("followup --grill: the cycle it opens grills that way; without it the run's mode applies", () => {
  const env = setup();
  writeFileSync(join(env.home, "roles", "grill-me-coord.md"), "You are grill-me-coord.\n");
  expect(() => followup(env.run, "x", "user", "you")).toThrow("--grill must be auto or me");
  const r = followup(env.run, "redo the design with me", "user", "me");
  add(env.run, "cycle_open", undefined, { start: "grill", slug: "redo", reason: "follow-up", followup: r.id });
  expect(grillMode(env.run)).toBe("me");
  expect(phaseCoord(env.run, "grill")).toBe("grill-me-coord");
  const r2 = followup(env.run, "small thing", "user");
  add(env.run, "cycle_open", undefined, { start: "grill", slug: "small", reason: "follow-up", followup: r2.id });
  expect(grillMode(env.run)).toBe("auto");
});

test("rename and progress: the list shows the new title, blocked nodes, and committed waves", () => {
  const env = setup();
  expect(rename(env.run.dir, "  New   name ")).toEqual({ dir: env.run.dir, title: "New name" });
  expect(entries().find((e) => e.dir === env.run.dir)!.title).toBe("New name");
  expect(() => rename(env.run.dir, " ")).toThrow("empty");
  toExec(env.run);
  add(env.run, "node_add", "commit-w1", { role: "commit", wave: 199 });
  add(env.run, "node_start", "commit-w1");
  add(env.run, "node_done", "commit-w1");
  const f = runs().find((x) => x.dir === env.run.dir)!;
  expect(f.progress.committed).toEqual([1]);
  expect(f.blocked).toEqual([]);
});

test("remove: deletes the ticket worktree forge made, keeps its branch; skips one with changes not committed", () => {
  const env = setup();
  const { spawnSync } = require("node:child_process");
  const { updateMeta } = require("../src/repos");
  const wt = join(env.root, "wt-abc");
  spawnSync("git", ["worktree", "add", "-q", "-b", "feat/ABC-1", wt], { cwd: env.repo });
  updateMeta(env.run, { branch: "feat/ABC-1", worktree: wt });
  writeFileSync(join(wt, "half.txt"), "not committed\n");
  const { removeRun } = require("../src/agents");
  const r1 = removeRun(env.run);
  expect(r1.worktrees.removed).toEqual([]);
  expect(r1.worktrees.skipped.map((s: any) => s.path)).toEqual([wt]);
  spawnSync("git", ["clean", "-qf"], { cwd: wt });
  const r2 = removeRun(env.run);
  expect(r2.worktrees.removed).toEqual([wt]);
  expect(spawnSync("git", ["branch", "--list", "feat/ABC-1"], { cwd: env.repo, encoding: "utf8" }).stdout).toContain("feat/ABC-1");
  expect(require("node:fs").existsSync(env.run.dir)).toBe(true);
});
