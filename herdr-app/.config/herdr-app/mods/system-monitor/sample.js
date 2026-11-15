// Pure sampling logic for the system-monitor mod: no herdr imports, so `node --test` can load it.

export const GREEN = "#00d787";
export const YELLOW = "#ffd700";
export const RED = "#ff0000";

/** The rounded 0..100 integer shown for a finite raw percentage. Throws on a non-finite raw. */
export function shown(raw) {
  if (!Number.isFinite(raw)) throw new Error(`shown: raw is not finite: ${raw}`);
  return Math.min(100, Math.max(0, Math.round(raw)));
}

export const FAILED = { ok: false };

/** A good sample for a finite raw percentage, else FAILED. */
export function good(raw) {
  return Number.isFinite(raw) ? { ok: true, value: shown(raw) } : FAILED;
}

function stdoutOf(res) {
  if (res === null || typeof res !== "object") return null;
  if (res.code !== 0 || typeof res.stdout !== "string") return null;
  return res.stdout;
}

/** macOS: CPU from the second `CPU usage:` line of `top -l 2`. */
export function parseTopCpu(res) {
  const out = stdoutOf(res);
  if (out === null) return FAILED;
  const lines = out.split("\n").filter((l) => l.includes("CPU usage:"));
  if (lines.length < 2) return FAILED;
  const m = lines[1].match(/(-?\d+(?:\.\d+)?)%\s*idle/);
  if (!m) return FAILED;
  const idle = Number(m[1]);
  if (!Number.isFinite(idle)) return FAILED;
  return good(100 - idle);
}

function vmField(out, name) {
  const m = out.match(new RegExp(`${name}:\\s*(-?\\d+)\\.`));
  return m ? Number(m[1]) : NaN;
}

/** macOS: memory from `vm_stat` plus one `hw.memsize` line. */
export function parseMacMem(res) {
  const out = stdoutOf(res);
  if (out === null) return FAILED;
  const ps = out.match(/page size of (\d+) bytes/);
  const pageSize = ps ? Number(ps[1]) : NaN;
  const anon = vmField(out, "Anonymous pages");
  const purgeable = vmField(out, "Pages purgeable");
  const wired = vmField(out, "Pages wired down");
  const compressor = vmField(out, "Pages occupied by compressor");
  const nonEmpty = out.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const memsize = nonEmpty.length ? Number(nonEmpty[nonEmpty.length - 1]) : NaN;
  const all = [pageSize, anon, purgeable, wired, compressor, memsize];
  if (!all.every(Number.isFinite)) return FAILED;
  if (pageSize <= 0 || memsize <= 0) return FAILED;
  return good(((anon - purgeable + wired + compressor) * pageSize) / memsize * 100);
}

/** Linux: CPU from two reads of the first /proc/stat line. Returns { sample, prev }. */
export function linuxCpu(res, prev) {
  const out = stdoutOf(res);
  if (out === null) return { sample: FAILED, prev };
  const first = out.split("\n")[0].trim().split(/\s+/);
  if (first[0] !== "cpu" || first.length < 9) return { sample: FAILED, prev };
  const nums = first.slice(1, 9).map(Number);
  if (!nums.every(Number.isFinite)) return { sample: FAILED, prev };
  const next = { idleAll: nums[3] + nums[4], total: nums.reduce((a, b) => a + b, 0) };
  if (prev === null) return { sample: FAILED, prev: next };
  const dTotal = next.total - prev.total;
  const dIdle = next.idleAll - prev.idleAll;
  if (!(dTotal > 0) || !Number.isFinite(dTotal) || !Number.isFinite(dIdle)) return { sample: FAILED, prev: next };
  return { sample: good(100 * (1 - dIdle / dTotal)), prev: next };
}

function kbField(out, name) {
  const m = out.match(new RegExp(`^${name}:\\s*(-?\\d+)`, "m"));
  return m ? Number(m[1]) : NaN;
}

/** Linux: memory from /proc/meminfo. */
export function parseMeminfo(res) {
  const out = stdoutOf(res);
  if (out === null) return FAILED;
  const total = kbField(out, "MemTotal");
  const avail = kbField(out, "MemAvailable");
  if (!Number.isFinite(total) || !Number.isFinite(avail) || total <= 0) return FAILED;
  return good(((total - avail) / total) * 100);
}

export function initialMetric() {
  return { state: "never", value: null };
}

/** The next display state for one metric. Returns a new object. */
export function reduce(metric, sample) {
  if (sample.ok) return { state: "fresh", value: sample.value };
  if (metric.state === "never") return { state: "never", value: null };
  return { state: "stale", value: metric.value };
}

/** Reduce one metric of { cpu, mem }; the other key stays the same object. */
export function reduceAll(metrics, which, sample) {
  return { ...metrics, [which]: reduce(metrics[which], sample) };
}

export function tone(v) {
  return v < 60 ? GREEN : v < 85 ? YELLOW : RED;
}

export function colorSource(metric, dim) {
  return metric.state === "fresh" ? tone(metric.value) : dim;
}

export function segment(label, metric) {
  return metric.state === "never" ? `${label}[--]` : `${label}[${metric.value}%]`;
}

/** In-flight gate: no two samples of one metric overlap. */
export function createGate() {
  let busy = false;
  return {
    tryEnter() {
      if (busy) return false;
      busy = true;
      return true;
    },
    leave() {
      busy = false;
    },
    busy: () => busy,
  };
}
