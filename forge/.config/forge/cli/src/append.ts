import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { apply, emptyState, hashLine, idx, Refused, replay, running, WORK, type Data, type Event, type Kind, type Phase, type State } from "./events";

export { Refused };

function projectCapOf(main: string): number | null {
  try {
    const cap = JSON.parse(readFileSync(join(main, ".forge", "config.json"), "utf8")).cap;
    return Number.isInteger(cap) && cap >= 1 && cap <= 8 ? cap : null;
  } catch {
    return null;
  }
}

export interface Run {
  dir: string;        // <main>/.forge/tickets/<ticket>
  ticket: string;
  main: string;       // main checkout
  worktree: string;   // where agents run
}

export const pad = (n: number) => String(n).padStart(3, "0");
export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 5).join("-") || "cycle";

function git(cwd: string, args: string[]): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The main checkout of the repo that holds cwd (also when cwd is a linked worktree). */
export function mainCheckout(cwd: string): string {
  const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common) throw new Refused(`not inside a git repo: ${cwd}`);
  return dirname(realpathSync(common));
}

export function loadRun(dir: string): Run {
  const file = join(dir, "run.json");
  if (!existsSync(file)) throw new Refused(`no forge run at ${dir} (run.json missing)`);
  const meta = JSON.parse(readFileSync(file, "utf8"));
  return { dir, ticket: meta.ticket, main: meta.main, worktree: meta.worktree };
}

/** --run flag, then $FORGE_RUN, then the ticket from the branch name, then the only ticket. */
/** The nearest folder at or above cwd that holds .forge/tickets (a workspace root). */
function forgeRoot(cwd: string): string | null {
  for (let d = cwd; ; d = dirname(d)) {
    if (existsSync(join(d, ".forge", "tickets"))) return d;
    if (dirname(d) === d) return null;
  }
}

export function findRun(flag: string | undefined, cwd = process.cwd()): Run {
  const given = flag ?? process.env.FORGE_RUN;
  if (given) return loadRun(given);
  let main: string;
  try {
    main = mainCheckout(cwd);
    if (!existsSync(join(main, ".forge", "tickets"))) main = forgeRoot(cwd) ?? main;
  } catch {
    const root = forgeRoot(cwd);
    if (!root) throw new Refused(`no forge run here: ${cwd} is not in a git repo or a forge workspace`);
    main = root;
  }
  const tickets = join(main, ".forge", "tickets");
  const names = existsSync(tickets) ? readdirSync(tickets).filter((n) => existsSync(join(tickets, n, "run.json"))) : [];
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? "";
  const fromBranch = names.find((n) => branch.split("/").pop()?.toLowerCase() === n.toLowerCase());
  if (fromBranch) return loadRun(join(tickets, fromBranch));
  if (names.length === 1) return loadRun(join(tickets, names[0]));
  throw new Refused(names.length ? `several forge runs (${names.join(", ")}): pass --run <dir>` : `no forge run under ${tickets}`);
}

export function cycleDirs(run: Run): string[] {
  const root = join(run.dir, "cycles");
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((n) => /^\d{3}-/.test(n)).sort().map((n) => join(root, n));
}

export function currentCycleDir(run: Run): string {
  const dirs = cycleDirs(run);
  if (!dirs.length) throw new Refused(`forge run ${run.ticket} has no cycle yet`);
  return dirs[dirs.length - 1];
}

export function readLines(file: string): string[] {
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
}

export function loadState(run: Run): { state: State; cycleDir: string } {
  const cycleDir = currentCycleDir(run);
  const state = replay(readLines(join(cycleDir, "events.jsonl")));
  // The chain cannot see an edit to the last line; HEAD keeps its hash.
  const headFile = join(run.dir, "HEAD");
  const head = existsSync(headFile) ? JSON.parse(readFileSync(headFile, "utf8")) : null;
  if (head?.dir === basename(cycleDir) && head.last && head.last !== state.lastHash)
    throw new Refused(`events.jsonl: the last line differs from what forge wrote (HEAD ${String(head.last).slice(0, 12)}…)`);
  return { state, cycleDir };
}

/** One writer at a time: a lock folder, taken over after 30 s. */
export function withLock<T>(run: Run, fn: () => T): T {
  const lock = join(run.dir, ".lock");
  const until = Date.now() + 10_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 30_000) rmSync(lock, { recursive: true, force: true });
      else if (Date.now() > until) throw new Refused("another forge command holds the lock (.lock)");
      else Bun.sleepSync(25);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function writeHead(run: Run, state: State, cycleDir: string) {
  writeFileSync(join(run.dir, "HEAD"), JSON.stringify({ cycle: state.cycle, dir: basename(cycleDir), phase: state.phase, approved: state.approved, paused: state.paused, events: state.count, last: state.lastHash }) + "\n");
}

function write(file: string, state: State, e: Event) {
  const err = apply(state, e);
  if (err) throw new Refused(err);
  const line = JSON.stringify(e);
  appendFileSync(file, line + "\n");
  state.lastHash = hashLine(line);
  state.count++;
}

export interface AppendInput { kind: Kind; node?: string; data?: Data }

/** Validate one event against the current cycle and add it. The CLI sets ts, cycle, phase, gen, and prev. */
export function appendEvent(run: Run, input: AppendInput): { state: State; cycleDir: string; event: Event } {
  return withLock(run, () => {
    if (input.kind === "cycle_open") return reopen(run, input.data ?? {});
    const { state, cycleDir } = loadState(run);
    if (input.kind === "followup") {
      // Follow-ups get an id that later events point at with data.followup when they handle it.
      const n = readLines(join(cycleDir, "events.jsonl")).filter((l) => JSON.parse(l).kind === "followup").length + 1;
      input = { ...input, data: { ...input.data, id: `${state.cycle}-${n}` } };
    }
    const event: Event = {
      ts: new Date().toISOString(), cycle: state.cycle, phase: state.phase, kind: input.kind,
      ...(input.node ? { node: input.node, gen: state.nodes.get(input.node)?.gen ?? 0 } : {}),
      ...(input.data ? { data: input.data } : {}),
      prev: state.lastHash,
    };
    write(join(cycleDir, "events.jsonl"), state, event);
    writeHead(run, state, cycleDir);
    return { state, cycleDir, event };
  });
}

/** Open the first cycle of a run. */
export function openFirstCycle(run: Run, cap: number) {
  return withLock(run, () => {
    if (cycleDirs(run).length) throw new Refused(`forge run ${run.ticket} already has a cycle`);
    return openCycle(run, 1, "grill", "initial", false, cap, "start");
  });
}

/**
 * A follow-up, gate comment, counterexample, or finding that changes earlier work.
 * Rules from Forge.tla Reopen: no agent running, start at or before the current phase
 * (or the run is done), start = exec only with an approved spec.
 */
function reopen(run: Run, data: Data) {
  const { state } = loadState(run);
  const start = data.start as Phase;
  if (!WORK.includes(start)) throw new Refused("cycle_open needs data.start: grill, verify, or exec");
  if (running(state).length) throw new Refused(`wait for the phase boundary: ${running(state).map((n) => n.id).join(", ")} still running`);
  if (state.phase !== "done" && idx(start) > idx(state.phase))
    throw new Refused(`start ${start} is later than the current phase ${state.phase}: add it to this cycle as a followup event`);
  if (start === "exec" && !state.approved) throw new Refused("a cycle can start at exec only when the spec is approved");
  const slug = slugify(typeof data.slug === "string" ? data.slug : "followup");
  const reason = typeof data.reason === "string" ? data.reason : "";
  const followup = typeof data.followup === "string" ? { followup: data.followup } : {};
  // The project cap (forge config cap) applies from the next cycle.
  const cap = projectCapOf(run.main) ?? state.cap;
  return openCycle(run, state.cycle + 1, start, slug, start === "exec" && state.approved, cap, reason, followup);
}

function openCycle(run: Run, cycle: number, start: Phase, slug: string, approved: boolean, cap: number, reason: string, extra: Data = {}) {
  const cycleDir = join(run.dir, "cycles", `${pad(cycle)}-${slug}`);
  mkdirSync(cycleDir, { recursive: true });
  const state = emptyState();
  const event: Event = {
    ts: new Date().toISOString(), cycle, phase: start, kind: "cycle_open",
    data: { start, slug, approved, cap, reason, ...extra }, prev: state.lastHash,
  };
  write(join(cycleDir, "events.jsonl"), state, event);
  writeHead(run, state, cycleDir);
  return { state, cycleDir, event };
}
