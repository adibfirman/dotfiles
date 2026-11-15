import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GREEN, YELLOW, RED, shown, good, FAILED, parseTopCpu, parseMacMem, linuxCpu, parseMeminfo,
  initialMetric, reduce, reduceAll, tone, colorSource, segment, createGate,
} from "../sample.js";

const ok = (stdout) => ({ code: 0, stdout });

const TOP2 = [
  "Processes: 400 total",
  "CPU usage: 10.0% user, 5.0% sys, 85.0% idle",
  "PhysMem: 10G used",
  "Processes: 401 total",
  "CPU usage: 20.5% user, 10.0% sys, 69.5% idle",
].join("\n");

test("top: value comes from the second CPU usage line", () => {
  assert.deepEqual(parseTopCpu(ok(TOP2)), { ok: true, value: 31 });
});
test("top: one CPU usage line fails", () => {
  assert.deepEqual(parseTopCpu(ok("CPU usage: 10.0% user, 5.0% sys, 85.0% idle\n")), FAILED);
});
test("top: no CPU usage line fails", () => {
  assert.deepEqual(parseTopCpu(ok("nothing here\n")), FAILED);
});
test("top: null and nonzero code fail", () => {
  assert.deepEqual(parseTopCpu(null), FAILED);
  assert.deepEqual(parseTopCpu({ code: 1, stdout: TOP2 }), FAILED);
  assert.deepEqual(parseTopCpu({ code: 0, stdout: null }), FAILED);
});

const vm = (page, over = {}) => {
  const f = { anon: 100000, purg: 20000, wired: 50000, comp: 30000, mem: 17179869184, ...over };
  const lines = [`Mach Virtual Memory Statistics: (page size of ${page} bytes)`, "Pages free: 5."];
  if (f.anon !== null) lines.push(`Anonymous pages: ${f.anon}.`);
  if (f.purg !== null) lines.push(`Pages purgeable: ${f.purg}.`);
  if (f.wired !== null) lines.push(`Pages wired down: ${f.wired}.`);
  if (f.comp !== null) lines.push(`Pages occupied by compressor: ${f.comp}.`);
  lines.push(String(f.mem), "");
  return ok(lines.join("\n"));
};
const expectMac = (page, anon, purg, wired, comp, mem) =>
  Math.min(100, Math.max(0, Math.round(((anon - purg + wired + comp) * page) / mem * 100)));

test("mac mem: 16384 and 4096 page sizes match the formula", () => {
  assert.deepEqual(parseMacMem(vm(16384)), { ok: true, value: expectMac(16384, 100000, 20000, 50000, 30000, 17179869184) });
  assert.deepEqual(parseMacMem(vm(4096)), { ok: true, value: expectMac(4096, 100000, 20000, 50000, 30000, 17179869184) });
  assert.equal(parseMacMem(vm(16384)).value, 15);
});
test("mac mem: each missing field fails", () => {
  for (const k of ["anon", "purg", "wired", "comp"]) {
    assert.deepEqual(parseMacMem(vm(16384, { [k]: null })), FAILED, k);
  }
});
test("mac mem: page size 0 and memsize 0 fail", () => {
  assert.deepEqual(parseMacMem(vm(0)), FAILED);
  assert.deepEqual(parseMacMem(vm(16384, { mem: 0 })), FAILED);
  assert.deepEqual(parseMacMem(vm(16384, { mem: "abc" })), FAILED);
});
test("mac mem: purgeable above anonymous gives a good 0", () => {
  assert.deepEqual(parseMacMem(vm(16384, { anon: 1000, purg: 200000, wired: 10, comp: 10 })), { ok: true, value: 0 });
});
test("mac mem: null and nonzero code fail", () => {
  assert.deepEqual(parseMacMem(null), FAILED);
  assert.deepEqual(parseMacMem({ code: 2, stdout: vm(16384).stdout }), FAILED);
});

const stat = (...n) => ok(`cpu  ${n.join(" ")}\ncpu0 1 2 3 4 5 6 7 8\n`);

test("linux cpu: first read has no value and sets prev", () => {
  const r = linuxCpu(stat(100, 0, 100, 700, 100, 0, 0, 0), null);
  assert.deepEqual(r.sample, FAILED);
  assert.deepEqual(r.prev, { idleAll: 800, total: 1000 });
});
test("linux cpu: two reads give the D10 value", () => {
  const a = linuxCpu(stat(100, 0, 100, 700, 100, 0, 0, 0), null);
  const b = linuxCpu(stat(150, 0, 150, 750, 150, 0, 0, 0), a.prev);
  // dTotal = 1200 - 1000 = 200, dIdle = 900 - 800 = 100, raw = 100 * (1 - 0.5) = 50
  assert.deepEqual(b.sample, { ok: true, value: 50 });
  assert.deepEqual(b.prev, { idleAll: 900, total: 1200 });
});
test("linux cpu: dTotal 0 fails", () => {
  const prev = { idleAll: 800, total: 1000 };
  const r = linuxCpu(stat(100, 0, 100, 700, 100, 0, 0, 0), prev);
  assert.deepEqual(r.sample, FAILED);
});
test("linux cpu: counter reset fails and the read becomes prev", () => {
  const prev = { idleAll: 9000, total: 10000 };
  const r = linuxCpu(stat(10, 0, 10, 70, 10, 0, 0, 0), prev);
  assert.deepEqual(r.sample, FAILED);
  assert.deepEqual(r.prev, { idleAll: 80, total: 100 });
  // next read: dTotal = 200 - 100 = 100, dIdle = 130 - 80 = 50 -> 50
  const n = linuxCpu(stat(20, 0, 20, 120, 10, 0, 0, 30), r.prev);
  assert.deepEqual(n.sample, { ok: true, value: 50 });
});
test("linux cpu: exec and parse failures keep the same prev object", () => {
  const prev = { idleAll: 800, total: 1000 };
  const cases = [
    null,
    { code: 1, stdout: "cpu 1 2 3 4 5 6 7 8\n" },
    ok("garbage line\n"),
    ok("cpu 1 2 3\n"),
    stat(1, 2, 3, "NaN", 5, 6, 7, 8),
    stat(1, 2, 3, "x", 5, 6, 7, 8),
  ];
  for (const res of cases) {
    const r = linuxCpu(res, prev);
    assert.deepEqual(r.sample, FAILED);
    assert.equal(r.prev, prev);
  }
  assert.equal(linuxCpu(null, null).prev, null);
});

test("meminfo: value follows D11", () => {
  const out = "MemTotal:       16000000 kB\nMemFree: 100 kB\nMemAvailable:    4000000 kB\n";
  assert.deepEqual(parseMeminfo(ok(out)), { ok: true, value: 75 });
});
test("meminfo: missing MemAvailable fails", () => {
  assert.deepEqual(parseMeminfo(ok("MemTotal: 16000000 kB\n")), FAILED);
});
test("meminfo: MemTotal 0 fails", () => {
  assert.deepEqual(parseMeminfo(ok("MemTotal: 0 kB\nMemAvailable: 0 kB\n")), FAILED);
  assert.deepEqual(parseMeminfo(null), FAILED);
});

test("non-finite raw is not good and shown throws", () => {
  for (const raw of [NaN, Infinity, -Infinity]) assert.deepEqual(good(raw), { ok: false });
  assert.throws(() => shown(NaN));
});
test("rounding", () => {
  assert.equal(shown(42.4), 42);
  assert.equal(shown(42.5), 43);
  assert.equal(shown(100.3), 100);
  assert.equal(shown(-0.2), 0);
});
test("good values are integers in 0..100", () => {
  for (const raw of [-50, 0, 59.6, 84.5, 150, 33.3, 100]) {
    const g = good(raw);
    assert.equal(g.ok, true);
    assert.ok(Number.isInteger(g.value) && g.value >= 0 && g.value <= 100, String(raw));
  }
  assert.equal(good(-50).value, 0);
  assert.equal(good(150).value, 100);
});

test("reducer transitions", () => {
  const never = initialMetric();
  assert.deepEqual(never, { state: "never", value: null });
  assert.deepEqual(reduce(never, good(42)), { state: "fresh", value: 42 });
  assert.deepEqual(reduce(never, FAILED), { state: "never", value: null });
  const fresh = reduce(never, good(42));
  assert.deepEqual(reduce(fresh, good(50)), { state: "fresh", value: 50 });
  const stale = reduce(fresh, FAILED);
  assert.deepEqual(stale, { state: "stale", value: 42 });
  assert.deepEqual(reduce(stale, good(7)), { state: "fresh", value: 7 });
  assert.deepEqual(reduce(reduce(stale, FAILED), FAILED), { state: "stale", value: 42 });
  assert.deepEqual(never, { state: "never", value: null });
});
test("reducer: only a good sample leaves never", () => {
  let m = initialMetric();
  for (let i = 0; i < 3; i++) m = reduce(m, FAILED);
  assert.equal(m.state, "never");
  assert.equal(reduce(m, good(0)).state, "fresh");
});
test("reduceAll keeps the other metric the same object", () => {
  const cpu = { state: "fresh", value: 30 };
  const mem = { state: "fresh", value: 60 };
  const a = reduceAll({ cpu, mem }, "cpu", FAILED);
  assert.equal(a.mem, mem);
  assert.deepEqual(a.cpu, { state: "stale", value: 30 });
  const b = reduceAll({ cpu, mem }, "mem", FAILED);
  assert.equal(b.cpu, cpu);
  assert.deepEqual(b.mem, { state: "stale", value: 60 });
});

test("tone boundaries", () => {
  assert.equal(tone(59), GREEN);
  assert.equal(tone(60), YELLOW);
  assert.equal(tone(84), YELLOW);
  assert.equal(tone(85), RED);
  assert.equal(tone(good(59.6).value), YELLOW);
  assert.equal(tone(good(84.5).value), RED);
});
test("colorSource is dim unless fresh", () => {
  assert.equal(colorSource({ state: "fresh", value: 70 }, "DIM"), YELLOW);
  assert.equal(colorSource({ state: "never", value: null }, "DIM"), "DIM");
  assert.equal(colorSource({ state: "stale", value: 70 }, "DIM"), "DIM");
});
test("segment shows -- only for never", () => {
  assert.equal(segment("CPU", { state: "never", value: null }), "CPU[--]");
  assert.equal(segment("CPU", { state: "fresh", value: 42 }), "CPU[42%]");
  assert.equal(segment("CPU", { state: "stale", value: 42 }), "CPU[42%]");
});

test("gate blocks overlap", () => {
  const g = createGate();
  assert.equal(g.busy(), false);
  assert.equal(g.tryEnter(), true);
  assert.equal(g.busy(), true);
  assert.equal(g.tryEnter(), false);
  assert.equal(g.busy(), true);
  g.leave();
  assert.equal(g.busy(), false);
  assert.equal(g.tryEnter(), true);
});
