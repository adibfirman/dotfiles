import { describe, expect, test } from "bun:test";
import { loadState } from "../src/append";
import { main } from "../src/main";
import { allowedFor, drainQueue, spawnNode, terminalName } from "../src/spawn";
import { status } from "../src/status";
import { add, hcCalls, setup, toExec } from "./helpers";

describe("spawn", () => {
  test("starts the node in hc and records node_start", async () => {
    const env = setup();
    process.env.HC_TERMINAL_ID = "t1";
    add(env.run, "node_add", "facts-auth");
    const r = spawnNode(env.run, "fact-finder", "facts-auth", "Find where tokens are refreshed.");
    expect(r.status).toBe("started");
    const [call] = hcCalls(env);
    expect(call.slice(0, 3)).toEqual(["run", "--bg", "--json"]);
    expect(call[call.indexOf("--cwd") + 1]).toBe(env.repo);
    expect(call[call.indexOf("--label") + 1]).toBe(`forge=${env.run.ticket}/1/facts-auth`);
    expect(call).not.toContain("--outlive-parent");
    expect(call[call.indexOf("--label") + 2]).toBe("claude");
    const settings = JSON.parse(require("node:fs").readFileSync(call[call.indexOf("--settings") + 1], "utf8"));
    expect(settings.env).toMatchObject({ FORGE_RUN: env.run.dir, FORGE_NODE: "facts-auth-g0" });
    expect(settings.env.PATH.split(":")).toEqual(expect.arrayContaining((process.env.PATH ?? "").split(":").filter(Boolean)));
    const prompt = require("node:fs").readFileSync(call[call.indexOf("--append-system-prompt-file") + 1], "utf8");
    expect(prompt).toBe("You are _common.\n\n---\n\nYou are fact-finder.\n");
    expect(settings.permissions.deny).toContain("Bash(git push:*)");
    expect(settings.attribution).toEqual({ commit: "", pr: "" });
    expect(settings.claudeMdExcludes).toContain(require("node:path").join(require("node:os").homedir(), ".claude", "**"));
    const task = call[call.length - 1];
    expect(task.startsWith("Find where tokens are refreshed.")).toBe(true);
    expect(task).toContain("hc send t1");
    expect(loadState(env.run).state.nodes.get("facts-auth")!.status).toBe("running");
  });

  test("a coordinator role cannot be spawned as a node", async () => {
    const env = setup();
    add(env.run, "node_add", "coord");
    expect(() => spawnNode(env.run, "grill-coord", "coord", "BOOT")).toThrow(/use forge coord/);
  });

  test("queues at the cap and starts the queued node when a slot frees", async () => {
    const env = setup({ cap: 1 });
    add(env.run, "node_add", "a");
    add(env.run, "node_add", "b");
    expect(spawnNode(env.run, "fact-finder", "a", "task a").status).toBe("started");
    const q = spawnNode(env.run, "fact-finder", "b", "task b");
    expect(q).toMatchObject({ status: "queued", reason: "cap reached: 1 agents running" });
    expect(status(env.run).queue).toEqual([{ node: "b", role: "fact-finder" }]);
    add(env.run, "node_done", "a");
    const started = drainQueue(env.run);
    expect(started.map((s) => [s.node, s.status])).toEqual([["b", "started"]]);
    expect(status(env.run).queue).toEqual([]);
    expect(hcCalls(env).filter((c) => c[0] === "run")).toHaveLength(2);
  });

  test("a later wave waits in the queue", async () => {
    const env = setup();
    toExec(env.run);
    add(env.run, "node_add", "u1", { wave: 1, files: ["a"] });
    add(env.run, "node_add", "u2", { wave: 2, files: ["a"] });
    expect(spawnNode(env.run, "unit", "u2", "task 2").status).toBe("queued");
    spawnNode(env.run, "unit", "u1", "task 1");
    add(env.run, "node_done", "u1");
    expect(drainQueue(env.run).map((s) => s.node)).toEqual(["u2"]);
  });

  test("other blocks are refusals, not queue entries", async () => {
    const env = setup();
    add(env.run, "node_add", "a");
    add(env.run, "pause");
    expect(() => spawnNode(env.run, "fact-finder", "a", "x")).toThrow(/paused/);
    expect(() => spawnNode(env.run, "fact-finder", "zzz", "x")).toThrow(/unknown node zzz/);
  });

  test("an unsent first message: read the screen, then send once", async () => {
    const env = setup();
    process.env.FAKE_HC_MODE = "unsent";
    add(env.run, "node_add", "a");
    const r = spawnNode(env.run, "fact-finder", "a", "Find the retry logic in payments.");
    expect(r.recovered).toBe(true);
    const calls = hcCalls(env).map((c) => c[0]);
    expect(calls).toContain("run");
    expect(calls.slice(-2)).toEqual(["read", "send"]);
    expect(calls).not.toContain("keys");
  });

  test("the trust dialog is answered with yes, once", async () => {
    const env = setup();
    process.env.FAKE_HC_MODE = "trust";
    add(env.run, "node_add", "a");
    expect(spawnNode(env.run, "fact-finder", "a", "x").trusted).toBe(true);
    expect(hcCalls(env).find((c) => c[0] === "keys")).toEqual(["keys", "t-f-local-task-1-a-g0", "down", "enter"]);
  });

  test("no trust dialog, no keys", async () => {
    const env = setup();
    add(env.run, "node_add", "a");
    expect(spawnNode(env.run, "fact-finder", "a", "x").trusted).toBe(false);
    expect(hcCalls(env).map((c) => c[0])).toEqual(["run", "read"]);
  });

  const addDir = (path: string) => `Adding a new directory:\n\n${path}\n\nThis session hasn't worked here before. Is this a directory you created or one you trust?\n\n❯ No, exit\n  Yes, add it`;

  test("an --add-dir folder forge passed gets yes", async () => {
    const env = setup();
    add(env.run, "node_add", "a");
    process.env.FAKE_HC_SCREENS = JSON.stringify([addDir(env.run.dir)]);
    const r = spawnNode(env.run, "fact-finder", "a", "x");
    expect(r.stuck).toBe(false);
    expect(hcCalls(env).filter((c) => c[0] === "keys")).toEqual([["keys", "t-f-local-task-1-a-g0", "down", "enter"]]);
  });

  test("an --add-dir folder forge did not pass gets no answer, and the node fails", async () => {
    const env = setup();
    add(env.run, "node_add", "a");
    process.env.FAKE_HC_SCREENS = JSON.stringify([addDir("/somewhere/else")]);
    const r = spawnNode(env.run, "fact-finder", "a", "x");
    expect(r.stuck).toBe(true);
    expect(hcCalls(env).map((c) => c[0])).not.toContain("keys");
    expect(loadState(env.run).state.nodes.get("a")?.status).toBe("failed");
  });

  test("the folder trust dialog, then an --add-dir dialog: both get yes", async () => {
    const env = setup();
    add(env.run, "node_add", "a");
    process.env.FAKE_HC_SCREENS = JSON.stringify([" ❯ No, exit\n   Yes, I trust this folder", addDir(env.run.dir)]);
    const r = spawnNode(env.run, "fact-finder", "a", "x");
    expect(r).toMatchObject({ trusted: true, stuck: false });
    expect(hcCalls(env).filter((c) => c[0] === "keys")).toHaveLength(2);
  });

  test("a retry ends the old terminal before it reuses the name", async () => {
    const env = setup();
    add(env.run, "node_add", "a");
    spawnNode(env.run, "fact-finder", "a", "x");
    add(env.run, "node_fail", "a", { sig: "E1" });
    spawnNode(env.run, "fact-finder", "a", "x");
    const calls = hcCalls(env).map((c) => c[0]);
    expect(calls.filter((c) => c === "run")).toHaveLength(2);
    expect(calls.indexOf("kill")).toBeGreaterThan(calls.indexOf("run"));
    expect(calls.lastIndexOf("run")).toBeGreaterThan(calls.indexOf("kill"));
  });

  test("a failed hc run records node_fail", async () => {
    const env = setup();
    process.env.FAKE_HC_MODE = "fail";
    add(env.run, "node_add", "a");
    expect(() => spawnNode(env.run, "fact-finder", "a", "x")).toThrow(/hc run failed/);
    const n = loadState(env.run).state.nodes.get("a")!;
    expect([n.status, n.lastSig]).toEqual(["failed", "spawn: hc run failed"]);
  });

  test("terminal names fit hc's 32 characters", async () => {
    expect(terminalName("ABC-123", 2, "facts", 0)).toBe("f-abc-123-2-facts-g0");
    const long = terminalName("ABC-12345", 12, "fact-finder-payment-retry-backoff", 3);
    expect(long.length).toBe(32);
    expect(long).toMatch(/^[a-z0-9_-]+$/);
  });
});

describe("CLI", () => {
  const quiet = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const log = console.log, err = console.error;
    console.log = console.error = () => {};
    try {
      return await fn();
    } finally {
      console.log = log;
      console.error = err;
    }
  };

  test("spawn reads the task from --task-file", async () => {
    const env = setup();
    process.env.FORGE_RUN = env.run.dir;
    add(env.run, "node_add", "a");
    const f = require("node:path").join(env.root, "task-a.md");
    require("node:fs").writeFileSync(f, "Model /\\ this `safely`; with $vars\n");
    expect(await quiet(() => main(["spawn", "fact-finder", "a", "--task-file", f]))).toBe(0);
    const run = hcCalls(env).find((c) => c[0] === "run")!;
    expect(run[run.length - 1].startsWith("Model /\\ this `safely`; with $vars")).toBe(true);
    expect(await quiet(() => main(["spawn", "fact-finder", "a", "--task-file", "/nope"]))).toBe(2);
  });

  test("exit codes: ok, refused, usage, queued", async () => {
    const env = setup({ cap: 1 });
    process.env.FORGE_RUN = env.run.dir;
    expect(await quiet(() => main(["append", "node_add", "--node", "a"]))).toBe(0);
    expect(await quiet(() => main(["append", "node_add", "--node", "b"]))).toBe(0);
    expect(await quiet(() => main(["append", "approved"]))).toBe(1);
    expect(await quiet(() => main(["append", "nope"]))).toBe(2);
    expect(await quiet(() => main(["append", "comment", "--data", "{bad"]))).toBe(2);
    expect(await quiet(() => main(["spawn", "fact-finder", "a", "task a"]))).toBe(0);
    expect(await quiet(() => main(["spawn", "fact-finder", "b", "task b"]))).toBe(3);
    expect(await quiet(() => main(["append", "node_done", "--node", "a"]))).toBe(0);
    expect(status(env.run).nodes.find((n) => n.id === "b")!.status).toBe("running");
  });

  test("status is rebuilt from events alone", async () => {
    const env = setup();
    add(env.run, "node_add", "a", { role: "asker" });
    const s = status(env.run);
    expect(s).toMatchObject({ cycle: 1, cycleDir: "001-initial", phase: "grill", approved: false, cap: 4, running: 0 });
    expect(s.nodes).toEqual([{ id: "a", phase: "grill", gen: 0, status: "pending", sameErr: 0, fails: 0, role: "asker" }]);
  });
});

test("allowedFor: anything a deny rule does not cover is allowed (bypass mode)", () => {
  const env = setup({ sources: "## exec\n- deny: kubectl delete\n## unit\n- deny: pnpm publish\n" });
  toExec(env.run);
  add(env.run, "node_add", "u1", { role: "unit", wave: 1 });
  expect(allowedFor(env.run, "u1", "pnpm   lint --fix")).toEqual({ node: "u1", command: "pnpm lint --fix", allowed: true });
  expect(allowedFor(env.run, "u1", "pnpm publish --tag x")).toMatchObject({ allowed: false, deniedBy: "Bash(pnpm publish:*)" });
  expect(allowedFor(env.run, "u1", "kubectl delete pod x")).toMatchObject({ allowed: false, deniedBy: "Bash(kubectl delete:*)" });
  expect(allowedFor(env.run, "u1", "git push origin main")).toMatchObject({ allowed: false, deniedBy: "Bash(git push:*)" });
  expect(() => allowedFor(env.run, "nope", "ls")).toThrow("unknown node");
});
