import { test } from "node:test";
import assert from "node:assert/strict";
import { cycleNote } from "../cycle.js";

test("cycleNote: nothing for the first cycle, then the source and the text", () => {
  assert.equal(cycleNote(null), null);
  assert.equal(cycleNote({ cycle: 1, cycleOpen: { reason: "initial" } }), null);
  assert.deepEqual(cycleNote({ cycle: 8, cycleOpen: { followup: { source: "user", text: "Fix the checks.\n\nMore." } } }), { source: "follow-up", text: "Fix the checks.\n\nMore." });
  assert.equal(cycleNote({ cycle: 3, cycleOpen: { followup: { source: "gate", text: "x" } } }).source, "gate comment");
  assert.deepEqual(cycleNote({ cycle: 2, cycleOpen: { slug: "cex-slot", reason: "slot in the past" } }), { source: "counterexample", text: "From cycle 1: slot in the past" });
  assert.deepEqual(cycleNote({ cycle: 2, cycleOpen: { start: "verify" } }), { source: null, text: "started at verify" });
});
