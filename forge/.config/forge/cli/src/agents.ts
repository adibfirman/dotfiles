import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { appendEvent, cycleDirs, loadState, readLines, Refused, type Run } from "./append";
import { running, type Event } from "./events";
import { entries, registerExisting, unregister } from "./registry";
import { dirtyWorktrees, removeWorktrees, restoreRepoWorktrees, runMeta, runOptions, updateMeta } from "./repos";
import { closeTerminal, hc, isLive, launch, nodeSpawnId, spawnInfo, terminalName, type Launched } from "./spawn";
import { ticketWorktree } from "./init";

const PHASE_COORD: Record<string, string> = { grill: "grill-coord", verify: "verify-coord", exec: "exec-coord" };

/** The coordinator role of a phase. A run started "with me" grills with the user (grill-me-coord). */
export function phaseCoord(run: Run, phase: string): string | undefined {
  if (phase === "grill" && grillMode(run) === "me") return "grill-me-coord";
  return PHASE_COORD[phase];
}

/** The grill mode of the current cycle: the --grill of the follow-up that opened it, else the run's own. */
export function grillMode(run: Run): "auto" | "me" {
  const { cycleDir } = loadState(run);
  const id = events(cycleDir)[0]?.data?.followup;
  if (id !== undefined) {
    const fu = cycleDirs(run).flatMap(events).find((e) => e.kind === "followup" && String(e.data?.id) === String(id));
    const g = fu?.data?.grill;
    if (g === "me" || g === "auto") return g;
  }
  return runOptions(run).grill;
}

/**
 * A follow-up from the user (no FORGE_NODE) needs a clean tree: a new cycle's agents would build on top of
 * edits made by hand in the chat. A coordinator's own follow-up runs mid-cycle, where changes are expected.
 */
export function assertClean(run: Run) {
  if (process.env.FORGE_NODE) return;
  const dirty = dirtyWorktrees(run);
  if (dirty.length) throw new Refused(`commit or stash first, so the next cycle starts clean: ${dirty.map((d) => `${d.path} (${d.files.join(", ")}${d.files.length === 5 ? ", …" : ""})`).join("; ")}`);
}

function events(cycleDir: string): Event[] {
  return readLines(join(cycleDir, "events.jsonl")).map((l) => JSON.parse(l));
}

/** Coordinators and classifiers started in the current cycle, oldest first. */
export function coordinators(run: Run) {
  const { cycleDir } = loadState(run);
  return events(cycleDir).filter((e) => e.kind === "coord_start").map((e) => ({ role: String(e.data!.role), id: String(e.data!.id), cycleDir }));
}

/**
 * The coordinator still running the current phase. One whose phase has ended (its terminal can stay
 * open and idle after it stops) does not count, so at the gate or after done a classifier starts.
 */
export function liveCoordinator(run: Run, exceptId = process.env.FORGE_NODE) {
  const { state } = loadState(run);
  const role = phaseCoord(run, state.phase);
  if (!role) return undefined;
  return coordinators(run).reverse().find((c) => c.id !== exceptId && c.role === role && isLive(spawnInfo(c.cycleDir, c.id)?.terminal ?? ""));
}

const BOOT = "BOOT. Run `forge reconcile`, then `forge status`, then follow your protocol from the step that matches the state.";

/** Start the coordinator for the current phase, or a classifier. Not a node: no cap, no barrier. */
export function startCoordinator(run: Run, role?: string, task = BOOT): Launched & { role: string; id: string } {
  const { state, cycleDir } = loadState(run);
  const r = role ?? phaseCoord(run, state.phase);
  if (!r) throw new Refused(`no coordinator for phase ${state.phase}: at the gate use forge approve or forge followup`);
  if (r !== "classifier" && phaseCoord(run, state.phase) !== r) throw new Refused(`${r} does not run phase ${state.phase}`);
  if (state.paused) throw new Refused("the run is paused");
  const n = coordinators(run).filter((c) => c.role === r).length;
  const id = `${r}-${n + 1}`;
  appendEvent(run, { kind: "coord_start", data: { role: r, id } });
  const name = terminalName(run.ticket, state.cycle, r.replace("-coord", "c"), n + 1);
  const l = launch(run, { role: r, id, name, phase: state.phase, cycle: state.cycle, cycleDir, task, label: `${run.ticket}/${state.cycle}/${id}` });
  return { ...l, role: r, id };
}

/** The human gate: approve the spec, then start the exec coordinator. */
export function approve(run: Run) {
  appendEvent(run, { kind: "approved" });
  return startCoordinator(run);
}

/**
 * The user's decision on a blocked node: retry it (a fresh generation, a new count) or skip it (counts as done).
 * The live coordinator is told; with none running the phase, one starts and finds the node from the state.
 */
export function decide(run: Run, node: string, how: "retry" | "skip") {
  appendEvent(run, { kind: how === "retry" ? "node_retry" : "node_skip", node });
  const live = liveCoordinator(run, undefined);
  const note = how === "retry"
    ? `forge: the user unblocked ${node}. Spawn it again with a changed approach; its failure count starts over.`
    : `forge: the user skipped ${node}. It counts as done. Go on without its output; say so in your log and in the phase result.`;
  if (live) {
    hc(["send", spawnInfo(live.cycleDir, live.id)!.terminal, note]);
    return { node, how, sentTo: live.id };
  }
  const c = startCoordinator(run, undefined, `${BOOT}\n\n${note}`);
  return { node, how, coordinator: c.id };
}

/**
 * A follow-up: QA bug, request, gate comment, PR review. A live coordinator gets it with hc send and
 * handles it at its next phase boundary. With no live coordinator, a classifier starts.
 */
export function followup(run: Run, text: string, source = "user", grill?: string) {
  if (grill !== undefined && grill !== "me" && grill !== "auto") throw new Refused(`--grill must be auto or me, not "${grill}"`);
  const { event } = appendEvent(run, { kind: "followup", data: { text, source, ...(grill ? { grill } : {}) } });
  const id = String(event.data!.id);
  const live = liveCoordinator(run, undefined);
  if (live) {
    const terminal = spawnInfo(live.cycleDir, live.id)!.terminal;
    hc(["send", terminal, `forge followup ${id} (${source}): ${text}\nHandle it at your next phase boundary, as your protocol says.`]);
    return { id, sentTo: live.id };
  }
  const c = startCoordinator(run, "classifier", `Classify forge follow-up ${id} (${source}): ${text}\n\nRun \`forge reconcile\` and \`forge status\` first.`);
  return { id, classifier: c.id };
}

/**
 * Remove a run: end its live agents, take it off the list, and delete its forge folder (.forge/tickets/<ticket>:
 * events, specs, refs, logs). Code is never touched: a workspace run's worktrees and every branch stay.
 */
/**
 * Remove a run: end its agents and its chat, and take it off the list. The .forge folder (context, specs,
 * history, PR text) stays, and `forge register --run <dir>` lists it again. The worktrees forge made are
 * removed; branches stay; a worktree with changes not committed is skipped. purge: a start that failed, so
 * the half-made folder goes too.
 */
export function removeRun(run: Run, purge = false) {
  const killed: string[] = [];
  const kill = (terminal: unknown) => {
    if (typeof terminal === "string" && !killed.includes(terminal) && isLive(terminal) && hc(["kill", terminal]).code === 0) killed.push(terminal);
  };
  for (const dir of cycleDirs(run)) {
    const spawnDir = join(dir, ".spawn");
    if (!existsSync(spawnDir)) continue;
    for (const f of readdirSync(spawnDir).filter((n) => n.endsWith(".json") && !/-(settings|mcp)\.json$/.test(n))) {
      try {
        kill(JSON.parse(readFileSync(join(spawnDir, f), "utf8")).terminal);
      } catch {
        continue;
      }
    }
  }
  let worktrees: ReturnType<typeof removeWorktrees> = { removed: [], skipped: [] };
  try {
    kill(runMeta(run).chat?.terminal);
    if (!purge) worktrees = removeWorktrees(run);
  } catch {
    // no run.json: nothing more to end or remove
  }
  unregister(run.dir);
  if (purge) rmSync(run.dir, { recursive: true, force: true });
  return { removed: run.dir, kept: !purge, killed, worktrees };
}

/**
 * Bring back a removed run: make again the worktrees remove took (the ticket worktree on its kept branch, or
 * each repo worktree of a workspace run), save the space, and list the run again. It starts no agent: the user
 * continues in the run's Chat (forge followup). A failure stops before the run is listed again.
 */
export function restoreRun(run: Run, space?: string) {
  if (entries().some((e) => e.dir === run.dir)) throw new Refused(`run ${run.ticket} is listed already: open it instead`);
  const m = runMeta(run);
  let worktrees: string[] = [];
  let listed = run;
  if (m.mode === "workspace") worktrees = restoreRepoWorktrees(run);
  else if (m.branch && m.worktree && m.worktree !== m.main && !existsSync(m.worktree)) {
    const wt = ticketWorktree(m.main, m.branch);
    worktrees = [wt];
    if (wt !== m.worktree) updateMeta(run, { worktree: wt });
    listed = { ...run, worktree: wt };
  }
  if (space) updateMeta(run, { space });
  registerExisting(listed);
  return { restored: run.dir, worktrees, space: space ?? m.space ?? null };
}

/**
 * At coordinator boot: a running node whose agent is gone fails with "agent lost", so it can retry.
 * Coordinators of this run other than the caller are closed (their screens are saved first).
 */
export function reconcile(run: Run, self = process.env.FORGE_NODE) {
  // Close old coordinators first: their node agents are their hc children and end with them.
  const closed: string[] = [];
  for (const dir of cycleDirs(run)) {
    for (const e of events(dir).filter((x) => x.kind === "coord_start")) {
      const id = String(e.data!.id);
      if (id !== self && closeTerminal(dir, id)) closed.push(`${basename(dir)}/${id}`);
    }
  }
  const { state, cycleDir } = loadState(run);
  const lost: string[] = [];
  for (const n of running(state)) {
    const info = spawnInfo(cycleDir, nodeSpawnId(n.id, n.gen));
    if (info && isLive(info.terminal)) continue;
    appendEvent(run, { kind: "node_fail", node: n.id, data: { sig: "agent lost" } });
    lost.push(n.id);
  }
  return { lost, closed };
}

/** Follow-ups of all cycles, each marked handled when a later event points at it with data.followup. */
export function followups(run: Run) {
  const all = cycleDirs(run).flatMap(events);
  const handled = new Set(all.map((e) => e.data?.followup).filter(Boolean).map(String));
  return all.filter((e) => e.kind === "followup").map((e) => ({ id: String(e.data!.id), source: String(e.data!.source ?? "user"), text: String(e.data!.text), handled: handled.has(String(e.data!.id)) }));
}

/** The newest spec files: the draft from grill, the gate copy, the last approved one, and the newest exec plan. */
export function specs(run: Run) {
  const dirs = cycleDirs(run).reverse();
  const find = (rel: string, ok: (d: string) => boolean = () => true) => {
    const d = dirs.find((x) => existsSync(join(x, rel)) && ok(x));
    return d ? join(d, rel) : null;
  };
  return {
    draft: find("grill/SPEC.draft.md"),
    gate: find("gate/SPEC.md"),
    approved: find("gate/SPEC.md", (d) => events(d).some((e) => e.kind === "approved")),
    plan: find("exec/plan.md"),
  };
}
