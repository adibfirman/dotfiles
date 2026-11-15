// Source-scan checks of the Herdr glue. main.js imports herdr modules node cannot load, so it is read, not run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("..", import.meta.url);
const main = readFileSync(new URL("main.js", dir), "utf8");
const jsFiles = readdirSync(dir).filter((f) => f.endsWith(".js"));

test("no .js file of the mod uses the file reader (D20)", () => {
  const word = "read" + "TextFile";
  assert.ok(jsFiles.includes("main.js"));
  for (const f of jsFiles) {
    assert.ok(!readFileSync(new URL(f, dir), "utf8").includes(word), `${f} contains ${word}`);
  }
});

// Index of the bracket that closes the one at `open`, or -1.
function closeOf(src, open, openCh, closeCh) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh && --depth === 0) return i;
  }
  return -1;
}

// Line comments removed, so words in comments do not count.
const code = main.replace(/^\s*\/\/.*$/gm, "");

test("exec is called once, only inside run, with timeout: 4000 (sample-ends, D15)", () => {
  const calls = [...code.matchAll(/\bexec\s*\(/g)];
  assert.equal(calls.length, 1, "exec must be called exactly once");
  const helper = code.match(/const\s+run\s*=\s*\([^)]*\)\s*=>\s*(exec\s*\()/);
  assert.ok(helper, "the exec call must be the body of the run helper");
  const start = helper.index + helper[0].length - helper[1].length;
  assert.equal(start, calls[0].index, "the one exec call is not the run helper's");
  const end = closeOf(code, code.indexOf("(", start), "(", ")");
  assert.ok(end > 0, "unclosed exec call");
  assert.match(code.slice(start, end + 1), /(?<![\w$])timeout:\s*4000(?!\d)/);
});

test("exec is referenced only by its import and the run helper (no aliasing)", () => {
  const refs = [...code.matchAll(/(?<![\w$.])exec(?![\w$])/g)].map((m) => m.index);
  assert.equal(refs.length, 2, "exec may appear only in the import and in run");
  assert.match(code.slice(0, refs[0]), /import\s*\{[^}]*$/);
  assert.equal(refs[1], [...code.matchAll(/\bexec\s*\(/g)][0].index);
});

test("every await is on run(...) or Promise.all/allSettled (sample-ends)", () => {
  const awaits = [...code.matchAll(/\bawait\b/g)];
  assert.ok(awaits.length >= 1);
  for (const m of awaits) {
    const rest = code.slice(m.index + 5);
    assert.match(rest, /^\s+(run\s*\(|Promise\.(all|allSettled)\s*\()/, `await at offset ${m.index} is not bounded`);
  }
});

test("poll returns early on a failed tryEnter, before cx.spawn (no-overlap)", () => {
  const guard = code.search(/if\s*\(\s*!this\.gate\.tryEnter\(\)\s*\)\s*return\b/);
  assert.ok(guard >= 0, "poll must early-return when tryEnter fails");
  assert.equal([...code.matchAll(/\btryEnter\b/g)].length, 1);
  const spawn = code.indexOf("cx.spawn", guard);
  assert.ok(spawn > guard, "the gate check must come before cx.spawn");
});

test("the gate is left in a finally block (no-overlap)", () => {
  const m = code.match(/\bfinally\s*\{/);
  assert.ok(m, "no finally block");
  const open = m.index + m[0].length - 1;
  const close = closeOf(code, open, "{", "}");
  assert.ok(close > 0, "unclosed finally block");
  assert.match(code.slice(open, close), /this\.gate\.leave\(\)/);
});
