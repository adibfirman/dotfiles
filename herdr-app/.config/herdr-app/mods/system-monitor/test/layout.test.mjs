import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layout = JSON.parse(readFileSync(new URL("../../../layouts/omarchy.json", import.meta.url), "utf8"));
const barSource = readFileSync(new URL("../../omarchy-bar/main.js", import.meta.url), "utf8");

function findNode(node, id) {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

const topbar = findNode(layout, "topbar");
const monitor = topbar?.children.find((c) => c.id === "sys-monitor");
const P = monitor?.size?.px;

test("topbar children are in order", () => {
  assert.ok(topbar, "topbar row exists");
  const ids = topbar.children.map((c) => c.id);
  assert.deepEqual(ids.slice(0, 4), ["bar-left", "sys-monitor", "ai-usage", "bar-right"]);
});

test("sys-monitor block hosts the system-monitor mod with a positive integer px", () => {
  assert.equal(monitor.content.mod, "system-monitor");
  assert.ok(Number.isInteger(P) && P > 0, `px is a positive integer, got ${P}`);
});

test("omarchy-bar narrow and wide lists use the same px as the layout", () => {
  const matches = [...barSource.matchAll(/\["sys-monitor",\s*\{\s*px:\s*(\d+)\s*\}\]/g)];
  assert.equal(matches.length, 2);
  for (const m of matches) assert.equal(Number(m[1]), P);
});
