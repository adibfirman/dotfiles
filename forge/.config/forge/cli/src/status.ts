import { basename, join } from "node:path";
import { cycleDirs, loadState, readLines, type Run } from "./append";
import { replay, running } from "./events";
import { queued } from "./spawn";
import { coordinators, followups, specs } from "./agents";
import { listRefs } from "./refs";
import { isWorkspace, reposWithHead, runMeta, runOptions } from "./repos";
import { coordinatorOf } from "./registry";

/** The current cycle as plain JSON, rebuilt from events.jsonl alone. */
export function status(run: Run) {
  const { state, cycleDir } = loadState(run);
  // Why this cycle exists: its cycle_open (start phase, reason, and the follow-up it handles, if any).
  const open = JSON.parse(readLines(join(cycleDir, "events.jsonl"))[0] ?? "{}").data ?? {};
  const fu = open.followup ? followups(run).find((f) => f.id === open.followup) : null;
  return {
    cycleOpen: { start: open.start ?? null, slug: open.slug ?? null, reason: open.reason ?? null, followup: fu ? { id: fu.id, source: fu.source, text: fu.text } : null },
    ticket: run.ticket,
    run: run.dir,
    worktree: run.worktree,
    cycle: state.cycle,
    cycleDir: basename(cycleDir),
    cyclePath: cycleDir,
    phase: state.phase,
    approved: state.approved,
    paused: state.paused,
    cap: state.cap,
    retryCap: state.retryCap,
    blocked: [...state.nodes.values()].filter((n) => n.blocked).map((n) => n.id),
    running: running(state).length,
    nodes: [...state.nodes.values()].map((n) => ({
      id: n.id, phase: n.phase, gen: n.gen, status: n.status, sameErr: n.sameErr, fails: n.fails,
      ...(n.blocked ? { blocked: true } : {}),
      ...(n.skipped ? { skipped: true } : {}),
      ...(n.wave !== undefined ? { wave: n.wave } : {}),
      ...(n.files.length ? { files: n.files } : {}),
      ...(n.role ? { role: n.role } : {}),
    })),
    queue: queued(cycleDir).map((q) => ({ node: q.node, role: q.role })),
    coordinators: coordinators(run).map((c) => ({ role: c.role, id: c.id })),
    coordinator: coordinatorOf(run.dir, { dir: basename(cycleDir) }), // the newest one, with its terminal
    followups: followups(run),
    spec: specs(run),
    mode: isWorkspace(run) ? "workspace" : "repo",
    ...runOptions(run),
    chat: runMeta(run).chat ?? null,
    repos: isWorkspace(run) ? reposWithHead(run).map((r) => ({ name: r.name, base: r.base, branch: r.branch, worktree: r.worktree, head: r.head, remote: r.remote })) : [],
    refs: listRefs(run).map((e) => ({ n: e.n, file: e.file, title: e.title, kind: e.kind, binary: e.binary })),
  };
}

/**
 * Every cycle of the run, oldest first, for the one-graph view: why it opened (start, slug, reason, the
 * follow-up it handles), where it came from (from: cycle, phase, and node when known), the phase it reached,
 * and each node's final state. Old cycles are never changed, so this is the whole history.
 */
export function history(run: Run) {
  const fus = followups(run);
  return cycleDirs(run).map((dir) => {
    const lines = readLines(join(dir, "events.jsonl"));
    const state = replay(lines);
    const open = JSON.parse(lines[0] ?? "{}").data ?? {};
    const fu = open.followup ? fus.find((f) => f.id === open.followup) : null;
    return {
      cycle: state.cycle, dir: basename(dir), start: open.start ?? null, slug: open.slug ?? null, reason: open.reason ?? null,
      from: open.from ?? null, followup: fu ? { id: fu.id, source: fu.source, text: fu.text } : null,
      phase: state.phase,
      nodes: [...state.nodes.values()].map((n) => ({
        id: n.id, phase: n.phase, gen: n.gen, status: n.status, fails: n.fails,
        ...(n.blocked ? { blocked: true } : {}), ...(n.skipped ? { skipped: true } : {}),
        ...(n.wave !== undefined ? { wave: n.wave } : {}), ...(n.role ? { role: n.role } : {}),
        ...(n.files.length ? { files: n.files } : {}),
      })),
    };
  });
}
