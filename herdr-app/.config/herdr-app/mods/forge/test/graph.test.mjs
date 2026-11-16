import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentDecisions, boxSize, historyGraph, lastPlanWave, parseTsGraph, runGraph, stageDetail, stageGraph, tsBlocks, verdictCounts, waveName } from "../graph.js";

const spec = readFileSync(new URL("./spec-fixture.md", import.meta.url), "utf8");

test("tsBlocks finds every ts graph with its title", () => {
  const blocks = tsBlocks(spec);
  assert.deepEqual(blocks.map((b) => b.title), ["System flow", "Order state machine", "Exec plan"]);
  assert.equal(blocks[1].full, "Order state machine (after this change)");
});

test("parseTsGraph: nodes, parents by indent, details, and paths", () => {
  const g = parseTsGraph([
    "Run",
    "  → refund(order)  src/order.ts:26",
    "    guards the status",
    "    → throw  // a comment",
    "  → return",
  ].join("\n"));
  const labels = [...g.nodes.values()].map((n) => n.label);
  assert.deepEqual(labels, ["Run", "refund(order)", "throw", "return"]);
  const byLabel = (l) => [...g.nodes.values()].find((n) => n.label === l);
  assert.equal(byLabel("refund(order)").sub, "src/order.ts:26");
  assert.equal(byLabel("refund(order)").path, "src/order.ts:26");
  assert.deepEqual(byLabel("refund(order)").details, ["guards the status"]);
  const edge = (a, b) => g.edges.some((e) => e.from === byLabel(a).id && e.to === byLabel(b).id);
  assert.ok(edge("Run", "refund(order)") && edge("refund(order)", "throw") && edge("Run", "return"));
  assert.equal(g.edges.length, 3);
});

test("the fixture's state machine parses into one tree", () => {
  const g = parseTsGraph(tsBlocks(spec)[1].code);
  assert.equal(g.nodes.get("n0").label, "Order status");
  assert.equal(g.edges.length, g.nodes.size - 1);
});

test("runGraph: phases chain, nodes under phases, exec nodes under waves", () => {
  const g = runGraph({
    phase: "exec",
    nodes: [
      { id: "ask-r1", phase: "grill", gen: 0, status: "done", role: "asker" },
      { id: "plan", phase: "exec", gen: 0, status: "done", wave: 1, role: "planner" },
      { id: "u1", phase: "exec", gen: 1, status: "running", wave: 100, role: "unit", files: ["a.ts"] },
    ],
  });
  assert.equal(g.nodes.get("phase:grill").status, "done");
  assert.equal(g.nodes.get("phase:gate").status, "done");
  assert.equal(g.nodes.get("phase:exec").status, "running");
  assert.equal(g.nodes.has("phase:done"), false);
  assert.equal(g.nodes.get("node:u1").label, "u1 · g1");
  assert.equal(g.nodes.get("wave:100").status, "running");
  const has = (a, b) => g.edges.some((e) => e.from === a && e.to === b);
  assert.ok(has("phase:exec", "wave:1") && has("wave:1", "wave:100") && has("wave:100", "node:u1") && has("phase:grill", "node:ask-r1"));
});

test("runGraph: the gate waits for the user", () => {
  const g = runGraph({ phase: "gate", nodes: [] });
  assert.equal(g.nodes.get("phase:gate").status, "waiting");
  assert.equal(g.nodes.get("phase:gate").sub, "waiting for you");
  assert.equal(g.nodes.get("phase:exec").status, "pending");
});

test("agentDecisions reads the gate list", () => {
  const d = agentDecisions(spec);
  assert.deepEqual(d.map((x) => x.id), ["D8", "D9", "D10", "D11", "D12", "D13"]);
  assert.ok(d[0].text.startsWith("D8: Add"));
});

test("boxSize grows with the label and has two lines with a sub", () => {
  assert.deepEqual(boxSize({ label: "x", sub: "" }), { w: 110, h: 36 });
  assert.equal(boxSize({ label: "a much longer label here", sub: "role" }).h, 50);
});

test("historyGraph: one graph for all cycles, old nodes kept, a back-arc from the node that caused the loop", () => {
  const st = { cycle: 2, phase: "grill", nodes: [{ id: "ask-r1", phase: "grill", gen: 0, status: "running", role: "asker" }] };
  const hist = [
    { cycle: 1, dir: "001-initial", start: "grill", slug: "initial", reason: "start", from: null, phase: "verify",
      nodes: [{ id: "ask-r1", phase: "grill", gen: 0, status: "done", role: "asker" }, { id: "tla-sample-ends", phase: "verify", gen: 0, status: "done", role: "tla-writer" }] },
    { cycle: 2, dir: "002-cex-sample-ends", start: "grill", slug: "cex-sample-ends", reason: "sample-ends fails on Linux", from: null, phase: "grill", nodes: [] },
  ];
  const g = historyGraph(st, hist);
  assert.equal(g.nodes.get("c1:node:ask-r1").old, true);
  assert.equal(g.nodes.get("c1:node:ask-r1").label, "ask-r1 · c1");
  assert.equal(g.nodes.get("c1:node:ask-r1").node.cycleDir, "001-initial");
  assert.equal(g.nodes.get("node:ask-r1").old, undefined);
  const arc = g.edges.find((e) => e.arc);
  assert.deepEqual([arc.from, arc.to, arc.arc, arc.label], ["c1:node:tla-sample-ends", "phase:grill", "cex", "cycle 2: counterexample"]);
  assert.equal(arc.reason, "sample-ends fails on Linux");
  // A recorded from.node wins; without a node, the arc starts at the phase the earlier cycle was in.
  hist[1].from = { cycle: 1, phase: "verify" };
  hist[1].slug = "qa-fix";
  hist[1].followup = { id: "1-1", source: "qa", text: "the CPU number is wrong" };
  const g2 = historyGraph(st, hist);
  const arc2 = g2.edges.find((e) => e.arc);
  assert.deepEqual([arc2.from, arc2.arc, arc2.label, arc2.reason], ["phase:verify", "followup", "cycle 2: QA follow-up", "the CPU number is wrong"]);
  // One cycle only: as before.
  assert.equal(historyGraph(st, hist, { onlyCurrent: true }).nodes.has("c1:node:ask-r1"), false);
});

test("waveName reads the exec wave numbers; lastPlanWave finds the last plan wave", () => {
  assert.deepEqual([1, 100, 101, 102, 103, 199, 200].map((w) => waveName(w, 2)),
    ["Plan", "Wave 1", "Wave 1 · gates", "Wave 1 · fix 1", "Wave 1 · gates after fix 1", "Wave 1 · commit", "Wave 2"]);
  assert.deepEqual([301, 302, 399].map((w) => waveName(w, 2)), ["End check · gates", "End check · fix 1", "End check · commit"]);
  assert.equal(lastPlanWave([{ wave: 1 }, { wave: 100 }, { wave: 199 }, { wave: 200 }, { wave: 301 }]), 2);
});

test("verdictCounts counts the models and the counterexamples in a verify summary", () => {
  const md = [
    "| # | Invariant | Verdict | Mutation | Result |", "|---|---|---|---|---|",
    "| 1 | a | COUNTEREXAMPLE | caught | x |", "| 2 | b | PASS | caught | y |", "| 3 | c | COUNTEREXAMPLE | caught | z |",
  ].join("\n");
  assert.deepEqual(verdictCounts(md), { models: 3, failed: 2 });
});

test("stageGraph: one box per cycle stage, labelled arrows, the next cycle under its counterexample", () => {
  const st = { cycle: 2, phase: "grill", nodes: [{ id: "fact-r1-q1", phase: "grill", gen: 0, status: "running", role: "fact-finder" }] };
  const hist = [
    { cycle: 1, dir: "001-initial", start: "grill", slug: "initial", reason: null, from: null, phase: "verify",
      nodes: [
        { id: "fact-r3-q1", phase: "grill", gen: 0, status: "done", role: "fact-finder" },
        { id: "tla-a", phase: "verify", gen: 0, status: "done", role: "tla-writer" },
        { id: "tla-b", phase: "verify", gen: 0, status: "done", role: "tla-writer" },
      ] },
    { cycle: 2, dir: "002-cex-a", start: "grill", slug: "cex-a", reason: "a fails", from: { cycle: 1, phase: "verify", node: "tla-a" }, phase: "grill", nodes: [] },
  ];
  const g = stageGraph(st, hist, { verdicts: { 1: { models: 2, failed: 2 } } });
  assert.deepEqual([...g.nodes.keys()], ["c1:grill", "c1:verify", "c2:grill", "c2:verify", "c2:gate", "c2:exec"]);
  assert.equal(g.nodes.get("c1:grill").sub, "3 rounds, 1 agent");
  assert.deepEqual([g.nodes.get("c1:verify").status, g.nodes.get("c1:verify").sub], ["failed", "2 models, 2 failed"]);
  assert.deepEqual([g.nodes.get("c2:grill").status, g.nodes.get("c2:grill").visited], ["running", true]);
  assert.deepEqual([g.nodes.get("c2:gate").status, g.nodes.get("c2:gate").visited], ["pending", false]);
  const edge = (a, b) => g.edges.find((e) => e.from === a && e.to === b);
  assert.equal(edge("c1:grill", "c1:verify").label, "spec written");
  assert.deepEqual([edge("c1:verify", "c2:grill").arc, edge("c1:verify", "c2:grill").label], ["cex", "2 counterexamples (first: a)"]);
  assert.equal(edge("c2:grill", "c2:verify").label, undefined);
  assert.deepEqual([...stageGraph(st, hist, { onlyCurrent: true }).nodes.keys()], ["c2:grill", "c2:verify", "c2:gate", "c2:exec"]);
});

test("stageGraph splits exec into plan, waves, and the end check; stageDetail names the wave steps", () => {
  const st = { cycle: 1, phase: "exec", nodes: [
    { id: "plan", phase: "exec", gen: 0, status: "done", wave: 1, role: "planner" },
    { id: "u-a", phase: "exec", gen: 0, status: "done", wave: 100, role: "unit" },
    { id: "g-beh-w1-r0", phase: "exec", gen: 0, status: "done", wave: 101, role: "gate-beh" },
    { id: "fix-u-a-r1", phase: "exec", gen: 0, status: "done", wave: 102, role: "unit" },
    { id: "commit-w1", phase: "exec", gen: 0, status: "done", wave: 199, role: "commit" },
    { id: "u-b", phase: "exec", gen: 0, status: "running", wave: 200, role: "unit" },
    { id: "g-beh-final-r0", phase: "exec", gen: 0, status: "pending", wave: 301, role: "gate-beh" },
  ] };
  const g = stageGraph(st, null);
  assert.deepEqual([...g.nodes.keys()], ["c1:grill", "c1:verify", "c1:gate", "c1:plan", "c1:wave:1", "c1:wave:2", "c1:end"]);
  assert.equal(g.nodes.get("c1:wave:1").sub, "1 unit, 1 fix round, committed");
  assert.deepEqual(["c1:wave:2", "c1:end"].map((id) => g.nodes.get(id).status), ["running", "pending"]);
  const edge = (a, b) => g.edges.find((e) => e.from === a && e.to === b);
  assert.deepEqual([edge("c1:gate", "c1:plan").label, edge("c1:plan", "c1:wave:1").label, edge("c1:wave:1", "c1:wave:2").label],
    ["you approved", "plan ready", "committed"]);
  // The end check has not started: it is not on the path, and nothing says "committed" into it yet.
  assert.deepEqual(["c1:wave:2", "c1:end"].map((id) => g.nodes.get(id).visited), [true, false]);
  assert.equal(edge("c1:wave:2", "c1:end").label, undefined);
  const d = stageDetail(st, null, "c1:wave:1");
  assert.deepEqual([...d.nodes.values()].filter((n) => n.kind === "wave").map((n) => n.label),
    ["Wave 1", "Wave 1 · gates", "Wave 1 · fix 1", "Wave 1 · commit"]);
  assert.ok(d.edges.some((e) => e.from === "wave:101" && e.to === "node:g-beh-w1-r0"));
  assert.equal(stageDetail(st, null, "c9:grill").nodes.size, 0);
});
