import { createHash } from "node:crypto";

export const PHASES = ["grill", "verify", "gate", "exec", "done"] as const;
export type Phase = (typeof PHASES)[number];
export const WORK: readonly Phase[] = ["grill", "verify", "exec"];

export const KINDS = [
  "cycle_open", "node_add", "node_start", "node_done", "node_fail", "node_evolve",
  "phase_done", "approved", "comment", "followup", "pause", "resume",
] as const;
export type Kind = (typeof KINDS)[number];

export type Data = Record<string, unknown>;

/** A rule said no. The CLI prints it and exits 1. */
export class Refused extends Error {}

export interface Event {
  ts: string;
  cycle: number;
  phase: Phase;
  kind: Kind;
  node?: string;
  gen?: number;
  data?: Data;
  prev: string;
}

export type NodeStatus = "pending" | "running" | "failed" | "done";

export interface NodeState {
  id: string;
  phase: Phase;
  gen: number;
  status: NodeStatus;
  sameErr: number;
  lastSig?: string;
  wave?: number;
  files: string[];
  role?: string;
  terminal?: string;
}

export interface State {
  cycle: number;
  slug: string;
  phase: Phase;
  approved: boolean;
  paused: boolean;
  cap: number;
  nodes: Map<string, NodeState>;
  lastHash: string;
  count: number;
}

export const GENESIS = "genesis";
export const NODE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

export const idx = (p: Phase) => PHASES.indexOf(p);
export const hashLine = (line: string) => createHash("sha256").update(line).digest("hex");

export function emptyState(): State {
  return { cycle: 0, slug: "", phase: "grill", approved: false, paused: false, cap: 4, nodes: new Map(), lastHash: GENESIS, count: 0 };
}

export const running = (s: State) => [...s.nodes.values()].filter((n) => n.status === "running");

const nextPhase: Partial<Record<Phase, Phase>> = { grill: "verify", verify: "gate", exec: "done" };

function text(data: Data | undefined, key: string): string | null {
  const v = data?.[key];
  return typeof v === "string" && v.trim() ? v : null;
}

/** Why node n cannot start now, or null when it can. Shared by apply() and the spawn queue. */
export function startBlock(s: State, n: NodeState): string | null {
  if (n.phase !== s.phase) return `node ${n.id} belongs to phase ${n.phase}, the cycle is in ${s.phase}`;
  if (n.status === "running" || n.status === "done") return `node ${n.id} is ${n.status}`;
  if (n.status === "failed" && n.sameErr >= 2) return `node ${n.id} failed twice with the same error: evolve it`;
  if (s.paused) return "the run is paused";
  if (running(s).length >= s.cap) return `cap reached: ${s.cap} agents running`;
  if (n.phase === "exec") {
    if (!s.approved) return "exec needs an approved spec";
    const waiting = [...s.nodes.values()].filter((o) => o.phase === "exec" && (o.wave ?? 0) < (n.wave ?? 0) && o.status !== "done");
    if (waiting.length) return `wave ${n.wave} waits for ${waiting.map((o) => o.id).join(", ")}`;
  }
  return null;
}

/** Apply one event to the state. Returns an error message, or null when the event is valid. */
export function apply(s: State, e: Event): string | null {
  if (!(KINDS as readonly string[]).includes(e.kind)) return `unknown kind ${e.kind}`;
  if (s.count === 0 && e.kind !== "cycle_open") return "the first event of a cycle must be cycle_open";
  if (s.count > 0 && e.kind === "cycle_open") return "cycle_open opens a new cycle file, not a line in this one";
  if (s.count > 0 && (e.cycle !== s.cycle || e.phase !== s.phase)) return `event says cycle ${e.cycle}/${e.phase}, state is ${s.cycle}/${s.phase}`;

  const node = e.node ? s.nodes.get(e.node) : undefined;
  const needNode = () => (node ? null : `unknown node ${e.node ?? "(none)"}`);

  switch (e.kind) {
    case "cycle_open": {
      const start = text(e.data, "start") as Phase | null;
      if (!start || !WORK.includes(start)) return "cycle_open needs data.start: grill, verify, or exec";
      const approved = e.data?.approved === true;
      if (start === "exec" && !approved) return "a cycle can start at exec only with an approved spec";
      const cap = e.data?.cap;
      Object.assign(s, {
        cycle: e.cycle, phase: start, approved, slug: text(e.data, "slug") ?? "",
        cap: typeof cap === "number" && cap > 0 ? cap : 4,
      });
      if (e.phase !== start) return `cycle_open phase ${e.phase} differs from data.start ${start}`;
      break;
    }
    case "node_add": {
      if (!e.node || !NODE_ID.test(e.node)) return "node_add needs a node id: a-z, 0-9, dashes, at most 41 chars";
      if (node) return `node ${e.node} already exists`;
      if (!WORK.includes(s.phase)) return `no nodes can be added in phase ${s.phase}`;
      const files = Array.isArray(e.data?.files) ? (e.data!.files as unknown[]).map(String) : [];
      let wave: number | undefined;
      if (s.phase === "exec") {
        const w = e.data?.wave;
        if (typeof w !== "number" || !Number.isInteger(w) || w < 1) return "an exec node needs data.wave, an integer from 1";
        wave = w;
        const started = [...s.nodes.values()].filter((o) => o.phase === "exec" && o.status !== "pending").map((o) => o.wave ?? 0);
        if (started.length && w < Math.max(...started)) return `wave ${w} is lower than wave ${Math.max(...started)}, which already started`;
        for (const o of s.nodes.values()) {
          if (o.phase !== "exec" || o.wave !== w) continue;
          const shared = o.files.filter((f) => files.includes(f));
          if (shared.length) return `wave ${w}: ${e.node} and ${o.id} both change ${shared.join(", ")}`;
        }
      }
      s.nodes.set(e.node, { id: e.node, phase: s.phase, gen: 0, status: "pending", sameErr: 0, files, wave, role: text(e.data, "role") ?? undefined });
      break;
    }
    case "node_start": {
      const err = needNode() ?? startBlock(s, node!);
      if (err) return err;
      node!.status = "running";
      node!.role = text(e.data, "role") ?? node!.role;
      node!.terminal = text(e.data, "terminal") ?? undefined;
      break;
    }
    case "node_done": {
      const err = needNode();
      if (err) return err;
      if (node!.status !== "running") return `node ${node!.id} is ${node!.status}, not running`;
      node!.status = "done";
      node!.sameErr = 0;
      node!.lastSig = undefined;
      break;
    }
    case "node_fail": {
      const err = needNode();
      if (err) return err;
      if (node!.status !== "running") return `node ${node!.id} is ${node!.status}, not running`;
      const sig = text(e.data, "sig");
      if (!sig) return "node_fail needs data.sig, a short error signature";
      node!.sameErr = node!.lastSig === sig ? node!.sameErr + 1 : 1;
      node!.lastSig = sig;
      node!.status = "failed";
      break;
    }
    case "node_evolve": {
      const err = needNode();
      if (err) return err;
      if (node!.status !== "failed" || node!.sameErr < 2) return `node ${node!.id} can evolve only after 2 identical failures`;
      Object.assign(node!, { gen: node!.gen + 1, status: "pending", sameErr: 0, lastSig: undefined, terminal: undefined });
      break;
    }
    case "phase_done": {
      const to = nextPhase[s.phase];
      if (!to) return `phase ${s.phase} does not end with phase_done`;
      const open = [...s.nodes.values()].filter((n) => n.phase === s.phase && n.status !== "done");
      if (open.length) return `phase ${s.phase} has nodes that are not done: ${open.map((n) => n.id).join(", ")}`;
      s.phase = to;
      break;
    }
    case "approved": {
      if (s.phase !== "gate") return `approved is valid only at the gate, the cycle is in ${s.phase}`;
      s.phase = "exec";
      s.approved = true;
      break;
    }
    case "comment":
    case "followup": {
      if (!text(e.data, "text")) return `${e.kind} needs data.text`;
      break;
    }
    case "pause": {
      if (s.paused) return "the run is already paused";
      s.paused = true;
      break;
    }
    case "resume": {
      if (!s.paused) return "the run is not paused";
      s.paused = false;
      break;
    }
  }
  return null;
}

/** Replay the lines of one cycle file. Checks the hash chain and every rule. */
export function replay(lines: string[]): State {
  const s = emptyState();
  lines.forEach((line, i) => {
    let e: Event;
    try {
      e = JSON.parse(line);
    } catch {
      throw new Refused(`events.jsonl line ${i + 1}: not JSON`);
    }
    if (e.prev !== s.lastHash) throw new Refused(`events.jsonl line ${i + 1}: hash chain broken (a line was changed or removed)`);
    const err = apply(s, e);
    if (err) throw new Refused(`events.jsonl line ${i + 1}: ${err}`);
    s.lastHash = hashLine(line);
    s.count++;
  });
  return s;
}
