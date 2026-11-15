import { basename } from "node:path";
import { loadState, type Run } from "./append";
import { running } from "./events";
import { queued } from "./spawn";

/** The current cycle as plain JSON, rebuilt from events.jsonl alone. */
export function status(run: Run) {
  const { state, cycleDir } = loadState(run);
  return {
    ticket: run.ticket,
    run: run.dir,
    worktree: run.worktree,
    cycle: state.cycle,
    cycleDir: basename(cycleDir),
    phase: state.phase,
    approved: state.approved,
    paused: state.paused,
    cap: state.cap,
    running: running(state).length,
    nodes: [...state.nodes.values()].map((n) => ({
      id: n.id, phase: n.phase, gen: n.gen, status: n.status, sameErr: n.sameErr,
      ...(n.wave !== undefined ? { wave: n.wave } : {}),
      ...(n.files.length ? { files: n.files } : {}),
      ...(n.role ? { role: n.role } : {}),
    })),
    queue: queued(cycleDir).map((q) => ({ node: q.node, role: q.role })),
  };
}
