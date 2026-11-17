import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentCycleDir, loadState } from "../src/append";
import { approve, decide, followup, followups, reconcile, specs, startCoordinator } from "../src/agents";
import { main } from "../src/main";
import { spawnNode } from "../src/spawn";
import { status } from "../src/status";
import { add, hcCalls, setup } from "./helpers";

const quiet = async <T>(fn: () => T | Promise<T>): Promise<T> => {
  const log = console.log, err = console.error;
  console.log = console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = err; }
};

describe("coordinators", () => {
  test("start outside the node model and outlive their parent", async () => {
    const env = setup({ cap: 1 });
    const c = startCoordinator(env.run);
    expect([c.role, c.id]).toEqual(["grill-coord", "grill-coord-1"]);
    const run = hcCalls(env).find((x) => x[0] === "run")!;
    expect(run).toContain("--outlive-parent");
    const prompt = require("node:fs").readFileSync(run[run.indexOf("--append-system-prompt-file") + 1], "utf8");
    expect(prompt).toContain("You are _coordinator.");
    // not counted in the cap: a node can still start
    add(env.run, "node_add", "a");
    expect(spawnNode(env.run, "fact-finder", "a", "x").status).toBe("started");
    expect(status(env.run).coordinators).toEqual([{ role: "grill-coord", id: "grill-coord-1" }]);
    expect(status(env.run).coordinator).toEqual({ id: "grill-coord-1", terminal: c.terminal });
  });

  test("the phase picks the coordinator, and the gate has none", async () => {
    const env = setup();
    expect(() => startCoordinator(env.run, "exec-coord")).toThrow(/does not run phase grill/);
    add(env.run, "phase_done");
    add(env.run, "phase_done");
    expect(() => startCoordinator(env.run)).toThrow(/at the gate use forge approve/);
  });

  test("approve opens exec and starts exec-coord", async () => {
    const env = setup();
    add(env.run, "phase_done");
    add(env.run, "phase_done");
    const c = approve(env.run);
    expect(c.role).toBe("exec-coord");
    expect(loadState(env.run).state.phase).toBe("exec");
  });
});

describe("follow-ups", () => {
  test("with no live coordinator a classifier starts", async () => {
    const env = setup();
    const r = followup(env.run, "QA: login fails after refresh", "qa");
    expect(r).toEqual({ id: "1-1", classifier: "classifier-1" });
    expect(followups(env.run)).toEqual([{ id: "1-1", source: "qa", text: "QA: login fails after refresh", handled: false }]);
  });

  test("a live coordinator gets it with hc send", async () => {
    const env = setup();
    const c = startCoordinator(env.run);
    const r = followup(env.run, "also support refunds");
    expect(r).toEqual({ id: "1-1", sentTo: "grill-coord-1" });
    const send = hcCalls(env).find((x) => x[0] === "send")!;
    expect(send[1]).toBe(c.terminal);
    expect(send[2]).toContain("forge followup 1-1 (user): also support refunds");
  });

  test("a coordinator whose phase ended does not get it: a classifier starts", async () => {
    const env = setup();
    startCoordinator(env.run); // grill-coord, still live in the fake hc
    add(env.run, "phase_done"); // grill → verify: grill-coord's phase is over
    const r = followup(env.run, "late input");
    expect(r).toEqual({ id: "1-1", classifier: "classifier-1" });
  });

  test("status says why the cycle exists", async () => {
    const env = setup();
    followup(env.run, "QA: crash on refresh", "qa");
    add(env.run, "cycle_open", undefined, { start: "grill", slug: "qa crash", reason: "a QA bug", followup: "1-1" });
    expect(status(env.run).cycleOpen).toEqual({ start: "grill", slug: "qa-crash", reason: "a QA bug", followup: { id: "1-1", source: "qa", text: "QA: crash on refresh" } });
  });

  test("an event with data.followup marks it handled", async () => {
    const env = setup();
    followup(env.run, "x");
    add(env.run, "cycle_open", undefined, { start: "grill", slug: "x", followup: "1-1" });
    expect(followups(env.run)[0].handled).toBe(true);
  });
});

describe("reconcile", () => {
  test("a running node whose agent is gone fails with agent lost", async () => {
    const env = setup();
    add(env.run, "node_add", "a");
    const s = spawnNode(env.run, "fact-finder", "a", "x");
    appendFileSync(env.log + ".dead", s.terminal + "\n");
    expect(reconcile(env.run).lost).toEqual(["a"]);
    const n = loadState(env.run).state.nodes.get("a")!;
    expect([n.status, n.lastSig]).toEqual(["failed", "agent lost"]);
  });

  test("closes other coordinators, not the caller", async () => {
    const env = setup();
    startCoordinator(env.run);
    const r = reconcile(env.run, "grill-coord-2");
    expect(r.closed).toEqual(["001-initial/grill-coord-1"]);
    expect(reconcile(env.run, "grill-coord-1").closed).toEqual([]);
  });
});

test("node_done through the CLI closes the agent's terminal", async () => {
  const env = setup();
  process.env.FORGE_RUN = env.run.dir;
  add(env.run, "node_add", "a");
  spawnNode(env.run, "fact-finder", "a", "x");
  expect(await quiet(() => main(["append", "node_done", "--node", "a"]))).toBe(0);
  expect(hcCalls(env).map((c) => c[0])).toContain("kill");
});

test("the coordinator that ends the run is closed after a delay", async () => {
  const env = setup();
  process.env.FORGE_RUN = env.run.dir;
  startCoordinator(env.run);
  add(env.run, "phase_done");
  add(env.run, "phase_done");
  approve(env.run); // exec-coord-1
  Object.assign(process.env, { FORGE_NODE: "exec-coord-1", FORGE_CLOSE_DELAY_S: "0" });
  expect(await quiet(() => main(["append", "phase_done"]))).toBe(0);
  delete process.env.FORGE_NODE;
  for (let i = 0; i < 40 && !hcCalls(env).some((c) => c[0] === "kill"); i++) await Bun.sleep(100);
  expect(hcCalls(env).filter((c) => c[0] === "kill")).toHaveLength(1);
});

test("specs: draft, gate copy, and the approved one", async () => {
  const env = setup();
  const dir = currentCycleDir(env.run);
  mkdirSync(join(dir, "grill"), { recursive: true });
  mkdirSync(join(dir, "gate"), { recursive: true });
  writeFileSync(join(dir, "grill", "SPEC.draft.md"), "d");
  writeFileSync(join(dir, "gate", "SPEC.md"), "g");
  expect(specs(env.run)).toEqual({ draft: join(dir, "grill/SPEC.draft.md"), gate: join(dir, "gate/SPEC.md"), approved: null, plan: null });
  add(env.run, "phase_done");
  add(env.run, "phase_done");
  add(env.run, "approved");
  expect(specs(env.run).approved).toBe(join(dir, "gate/SPEC.md"));
  mkdirSync(join(dir, "exec"), { recursive: true });
  writeFileSync(join(dir, "exec", "plan.md"), "p");
  expect(specs(env.run).plan).toBe(join(dir, "exec/plan.md"));
});

test("retry, skip, and approve are the user's: an agent shell (FORGE_NODE) is refused", async () => {
  const env = setup();
  process.env.FORGE_NODE = "grill-coord-1";
  try {
    expect(await main(["append", "approved", "--run", env.run.dir])).toBe(1);
    expect(await main(["retry", "a", "--run", env.run.dir])).toBe(1);
    expect(await main(["approve", "--run", env.run.dir])).toBe(1);
  } finally {
    delete process.env.FORGE_NODE;
  }
});

test("decide: retry tells the live coordinator, or starts one with the note", () => {
  const env = setup();
  add(env.run, "node_add", "a");
  for (const s of ["E1", "E2", "E3", "E4"]) {
    add(env.run, "node_start", "a");
    add(env.run, "node_fail", "a", { sig: s });
  }
  const r = decide(env.run, "a", "retry");
  expect(r).toMatchObject({ node: "a", how: "retry", coordinator: "grill-coord-1" });
  startCoordinator(env.run);
  add(env.run, "node_start", "a");
  for (const s of ["E1", "E2", "E3"]) {
    add(env.run, "node_fail", "a", { sig: s });
    add(env.run, "node_start", "a");
  }
  add(env.run, "node_fail", "a", { sig: "E4" });
  const s = decide(env.run, "a", "skip");
  expect(s.how).toBe("skip");
  expect(s.sentTo ?? s.coordinator).toBeTruthy();
  expect(hcCalls(env).some((c) => c[0] === "send" && /skipped a/.test(c.slice(1).join(" ")))).toBe(s.sentTo !== undefined);
});

test("a coordinator outlives its starter and types no note into it; a node stays under its coordinator", () => {
  const env = setup();
  startCoordinator(env.run);
  const coordRun = hcCalls(env).find((c) => c[0] === "run" && c.includes("f-local-task-1-grillc-g1"))!;
  const flags = coordRun.slice(0, coordRun.indexOf("claude"));
  expect(flags).toEqual(expect.arrayContaining(["--outlive-parent", "--no-notify"]));
  expect(flags).not.toContain("--parent");
  add(env.run, "node_add", "a", { role: "fact-finder" });
  spawnNode(env.run, "fact-finder", "a", "find it");
  const nodeRun = hcCalls(env).filter((c) => c[0] === "run").pop()!;
  expect(nodeRun.slice(0, nodeRun.indexOf("claude"))).not.toContain("--no-notify");
});
