import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { appendEvent, cycleDirs, loadState, readLines, Refused, type Run } from "./append";
import { running, type Event } from "./events";
import { unregister } from "./registry";
import { closeTerminal, hc, isLive, launch, nodeSpawnId, spawnInfo, terminalName, type Launched } from "./spawn";

const PHASE_COORD: Record<string, string> = { grill: "grill-coord", verify: "verify-coord", exec: "exec-coord" };

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
  const role = PHASE_COORD[state.phase];
  if (!role) return undefined;
  return coordinators(run).reverse().find((c) => c.id !== exceptId && c.role === role && isLive(spawnInfo(c.cycleDir, c.id)?.terminal ?? ""));
}

const BOOT = "BOOT. Run `forge reconcile`, then `forge status`, then follow your protocol from the step that matches the state.";

/** Start the coordinator for the current phase, or a classifier. Not a node: no cap, no barrier. */
export function startCoordinator(run: Run, role?: string, task = BOOT): Launched & { role: string; id: string } {
  const { state, cycleDir } = loadState(run);
  const r = role ?? PHASE_COORD[state.phase];
  if (!r) throw new Refused(`no coordinator for phase ${state.phase}: at the gate use forge approve or forge followup`);
  if (r !== "classifier" && PHASE_COORD[state.phase] !== r) throw new Refused(`${r} does not run phase ${state.phase}`);
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
 * A follow-up: QA bug, request, gate comment, PR review. A live coordinator gets it with hc send and
 * handles it at its next phase boundary. With no live coordinator, a classifier starts.
 */
export function followup(run: Run, text: string, source = "user") {
  const { event } = appendEvent(run, { kind: "followup", data: { text, source } });
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
export function removeRun(run: Run) {
  const killed: string[] = [];
  for (const dir of cycleDirs(run)) {
    const spawnDir = join(dir, ".spawn");
    if (!existsSync(spawnDir)) continue;
    for (const f of readdirSync(spawnDir).filter((n) => n.endsWith(".json") && !/-(settings|mcp)\.json$/.test(n))) {
      let terminal: unknown;
      try {
        terminal = JSON.parse(readFileSync(join(spawnDir, f), "utf8")).terminal;
      } catch {
        continue;
      }
      if (typeof terminal === "string" && !killed.includes(terminal) && isLive(terminal) && hc(["kill", terminal]).code === 0) killed.push(terminal);
    }
  }
  let kept: string[] = [];
  try {
    kept = (JSON.parse(readFileSync(join(run.dir, "run.json"), "utf8")).repos ?? []).map((r: { worktree: string }) => r.worktree).filter((w: string) => existsSync(w));
  } catch {
    // no run.json: nothing to keep
  }
  unregister(run.dir);
  rmSync(run.dir, { recursive: true, force: true });
  return { removed: run.dir, killed, kept };
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

/** The newest spec files: the draft from grill, the gate copy, and the last approved one. */
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
  };
}
