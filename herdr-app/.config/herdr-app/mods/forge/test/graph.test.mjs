import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentDecisions, boxSize, parseTsGraph, runGraph, tsBlocks } from "../graph.js";

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
