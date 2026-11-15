import { test } from "node:test";
import assert from "node:assert/strict";
import { trimPrompt } from "../trim.js";

const RULE = "─".repeat(40);

test("drops Claude's prompt box, its status line, and hc notes", () => {
  const screen = ["⏺ Bash(forge status)", "  ⎿  {", "", RULE, "❯ ", RULE, "  ⏵⏵ don't ask on (shift+tab to cycle)", "[hc] incomplete: older output may be missing"].join("\n");
  assert.deepEqual(trimPrompt(screen), ["⏺ Bash(forge status)", "  ⎿  {"]);
});

test("a screen without the box stays as it is", () => {
  assert.deepEqual(trimPrompt("line 1\nline 2\n"), ["line 1", "line 2"]);
});
