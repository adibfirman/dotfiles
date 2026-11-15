import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { appendEvent, currentCycleDir, loadState, Refused } from "../src/append";
import { add, setup, toExec } from "./helpers";

const refused = (fn: () => unknown, msg: RegExp) => expect(fn).toThrow(msg);

describe("hash chain", () => {
  test("an edited old line is refused", () => {
    const { run } = setup();
    add(run, "followup", undefined, { text: "one" });
    add(run, "node_add", "a");
    const file = join(currentCycleDir(run), "events.jsonl");
    writeFileSync(file, readFileSync(file, "utf8").replace('"one"', '"two"'));
    refused(() => add(run, "node_add", "b"), /line 3: hash chain broken/);
  });

  test("an edited last line is refused", () => {
    const { run } = setup();
    add(run, "followup", undefined, { text: "one" });
    const file = join(currentCycleDir(run), "events.jsonl");
    writeFileSync(file, readFileSync(file, "utf8").replace('"one"', '"two"'));
    refused(() => add(run, "node_add", "b"), /last line differs/);
  });

  test("a removed line is refused", () => {
    const { run } = setup();
    add(run, "node_add", "a");
    add(run, "node_add", "b");
    const file = join(currentCycleDir(run), "events.jsonl");
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    writeFileSync(file, [lines[0], lines[2]].join("\n") + "\n");
    refused(() => loadState(run), /line 2: hash chain broken/);
  });
});

describe("forward only", () => {
  test("a done node cannot start again", () => {
    const { run } = setup();
    add(run, "node_add", "a");
    add(run, "node_start", "a");
    add(run, "node_done", "a");
    refused(() => add(run, "node_start", "a"), /node a is done/);
  });

  test("a phase ends only when its nodes are done", () => {
    const { run } = setup();
    add(run, "node_add", "a");
    refused(() => add(run, "phase_done"), /not done: a/);
  });

  test("approved is valid only at the gate", () => {
    const { run } = setup();
    refused(() => add(run, "approved"), /only at the gate/);
  });

  test("the event cannot set its own cycle or phase", () => {
    const { run } = setup();
    const { event } = appendEvent(run, { kind: "node_add", node: "a", data: { phase: "exec" } as never });
    expect(event.phase).toBe("grill");
    expect(event.cycle).toBe(1);
  });
});

describe("retry and evolve", () => {
  test("retry after one error, evolve only after 2 identical errors", () => {
    const { run } = setup();
    add(run, "node_add", "a");
    add(run, "node_start", "a");
    add(run, "node_fail", "a", { sig: "E1" });
    refused(() => add(run, "node_evolve", "a"), /only after 2 identical/);
    add(run, "node_start", "a");
    add(run, "node_fail", "a", { sig: "E1" });
    refused(() => add(run, "node_start", "a"), /evolve it/);
    add(run, "node_evolve", "a");
    const n = loadState(run).state.nodes.get("a")!;
    expect([n.gen, n.status, n.sameErr]).toEqual([1, "pending", 0]);
  });

  test("a different error resets the count", () => {
    const { run } = setup();
    add(run, "node_add", "a");
    add(run, "node_start", "a");
    add(run, "node_fail", "a", { sig: "E1" });
    add(run, "node_start", "a");
    add(run, "node_fail", "a", { sig: "E2" });
    expect(loadState(run).state.nodes.get("a")!.sameErr).toBe(1);
  });

  test("node_fail needs a signature", () => {
    const { run } = setup();
    add(run, "node_add", "a");
    add(run, "node_start", "a");
    refused(() => add(run, "node_fail", "a"), /data.sig/);
  });
});

describe("cap and pause", () => {
  test("the cap refuses one more start", () => {
    const { run } = setup({ cap: 2 });
    for (const n of ["a", "b", "c"]) add(run, "node_add", n);
    add(run, "node_start", "a");
    add(run, "node_start", "b");
    refused(() => add(run, "node_start", "c"), /cap reached: 2/);
  });

  test("pause blocks starts until resume", () => {
    const { run } = setup();
    add(run, "node_add", "a");
    add(run, "pause");
    refused(() => add(run, "node_start", "a"), /paused/);
    add(run, "resume");
    add(run, "node_start", "a");
  });
});

describe("exec waves", () => {
  test("two units of one wave may not share a file", () => {
    const { run } = setup();
    toExec(run);
    add(run, "node_add", "u1", { wave: 1, files: ["src/a.ts", "src/b.ts"] });
    refused(() => add(run, "node_add", "u2", { wave: 1, files: ["src/b.ts"] }), /u2 and u1 both change src\/b.ts/);
    add(run, "node_add", "u3", { wave: 2, files: ["src/b.ts"] });
  });

  test("a wave starts only after earlier waves are done", () => {
    const { run } = setup();
    toExec(run);
    add(run, "node_add", "u1", { wave: 1, files: ["a"] });
    add(run, "node_add", "u2", { wave: 2, files: ["a"] });
    refused(() => add(run, "node_start", "u2"), /wave 2 waits for u1/);
    add(run, "node_start", "u1");
    add(run, "node_done", "u1");
    add(run, "node_start", "u2");
  });

  test("no node joins a wave lower than one that started", () => {
    const { run } = setup();
    toExec(run);
    add(run, "node_add", "u1", { wave: 2, files: ["a"] });
    add(run, "node_start", "u1");
    refused(() => add(run, "node_add", "u0", { wave: 1, files: ["b"] }), /lower than wave 2/);
  });

  test("an exec node needs a wave", () => {
    const { run } = setup();
    toExec(run);
    refused(() => add(run, "node_add", "u1", { files: ["a"] }), /data.wave/);
  });
});

describe("reopen (Forge.tla Reopen)", () => {
  test("waits while an agent runs", () => {
    const { run } = setup();
    add(run, "node_add", "a");
    add(run, "node_start", "a");
    refused(() => add(run, "cycle_open", undefined, { start: "grill", slug: "qa bug" }), /phase boundary: a still running/);
  });

  test("a start later than the current phase stays in this cycle", () => {
    const { run } = setup();
    refused(() => add(run, "cycle_open", undefined, { start: "exec" }), /later than the current phase grill/);
  });

  test("a code-only cycle needs an approved spec and keeps it", () => {
    const { run } = setup();
    toExec(run);
    add(run, "phase_done");
    add(run, "cycle_open", undefined, { start: "exec", slug: "QA: login bug" });
    const { state, cycleDir } = loadState(run);
    expect([state.cycle, state.phase, state.approved]).toEqual([2, "exec", true]);
    expect(cycleDir.endsWith("002-qa-login-bug")).toBe(true);
  });

  test("a spec change drops the approval and goes through the gate again", () => {
    const { run } = setup();
    toExec(run);
    add(run, "cycle_open", undefined, { start: "grill", slug: "add refunds" });
    const { state } = loadState(run);
    expect([state.cycle, state.phase, state.approved]).toEqual([2, "grill", false]);
    expect(readdirSync(join(run.dir, "cycles")).sort()).toEqual(["001-initial", "002-add-refunds"]);
  });

  test("HEAD follows the current cycle", () => {
    const { run } = setup();
    toExec(run);
    add(run, "cycle_open", undefined, { start: "verify", slug: "cex" });
    expect(JSON.parse(readFileSync(join(run.dir, "HEAD"), "utf8"))).toMatchObject({ cycle: 2, dir: "002-cex", phase: "verify", approved: false, paused: false, events: 1 });
  });
});

test("Refused is the error type for rules", () => {
  const { run } = setup();
  expect(() => add(run, "approved")).toThrow(Refused);
});
