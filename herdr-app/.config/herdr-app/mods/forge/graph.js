// Pure graph code for the forge mod: no herdr imports, so `node --test` can load it.
//
// A graph is { nodes: Map<id, node>, edges: [{ from, to, arrow }] }, the shape layout.js takes.
// A node is { id, label, sub, status, details, path }.

const PATH = /([\w./~-]+\.[A-Za-z0-9]+):(\d+)/;

/** The ```ts blocks of a spec, each with a title: the line just above it, else the nearest heading. */
export function tsBlocks(markdown) {
  const out = [];
  const lines = markdown.split("\n");
  let heading = "", above = "", code = null;
  for (const line of lines) {
    if (code) {
      if (/^```\s*$/.test(line)) {
        const full = plain(above) || plain(heading) || `Graph ${out.length + 1}`;
        out.push({ title: full.replace(/\s*\([^)]*\)/g, "").trim().slice(0, 40) || full.slice(0, 40), full, code: code.join("\n") });
        code = null;
        above = "";
      } else code.push(line);
      continue;
    }
    if (/^```ts\s*$/.test(line)) {
      code = [];
      continue;
    }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      heading = h[1];
      above = "";
    } else if (line.trim()) above = line;
  }
  return out;
}

// A title without heading marks, numbering, bold, or a trailing colon. Tabs drop "(…)" parts; the tooltip keeps them.
const plain = (s) => s.replace(/^#+\s*/, "").replace(/^\d+\.\s*/, "").replace(/\*\*/g, "").replace(/[:*`]+$/g, "").trim();

/**
 * The call-graph format: a line starting with → is a node, and its parent is the nearest node above
 * with less indent. Lines at the smallest indent are roots. Other indented lines are details of the
 * node above. `// comments` are dropped. Two or more spaces split a label from its second line.
 */
export function parseTsGraph(code) {
  const nodes = new Map();
  const edges = [];
  const raw = code.split("\n").map((l) => l.replace(/(^|\s)\/\/\s.*$/, "").replace(/\s+$/, "")).filter((l) => l.trim());
  if (!raw.length) return { nodes, edges };
  const indentOf = (l) => l.length - l.trimStart().length;
  const base = Math.min(...raw.map(indentOf));
  const stack = [];
  for (const line of raw) {
    const indent = indentOf(line);
    const text = line.trim();
    const isNode = text.startsWith("→") || indent === base;
    if (!isNode) {
      const owner = [...stack].reverse().find((s) => s.indent < indent);
      if (owner) {
        const n = nodes.get(owner.id);
        n.details.push(text);
        n.path ??= PATH.exec(text)?.[0] ?? null;
      }
      continue;
    }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const body = text.replace(/^→\s*/, "");
    const [label, ...rest] = body.split(/\s{2,}/);
    const id = `n${nodes.size}`;
    nodes.set(id, { id, label: label.trim(), sub: rest.join("  ").trim(), status: null, details: [], path: PATH.exec(body)?.[0] ?? null });
    if (stack.length) edges.push({ from: stack[stack.length - 1].id, to: id, arrow: true });
    stack.push({ indent, id });
  }
  return { nodes, edges };
}

export const PHASES = ["grill", "verify", "gate", "exec", "done"];

function groupStatus(list) {
  if (list.some((n) => n.blocked)) return "blocked";
  if (list.some((n) => n.status === "running")) return "running";
  if (list.some((n) => n.status === "failed")) return "failed";
  if (list.length && list.every((n) => n.status === "done")) return "done";
  return "pending";
}

/**
 * The run as a graph, from `forge status`: the phases as a chain, each node under its phase, and
 * exec nodes under their wave (waves chain in order, as forge runs them).
 */
export function runGraph(st) {
  const nodes = new Map();
  const edges = [];
  const cur = PHASES.indexOf(st.phase);
  const shown = PHASES.filter((p) => p !== "done" || st.phase === "done");
  shown.forEach((p, i) => {
    const k = PHASES.indexOf(p);
    const status = k < cur || st.phase === "done" ? "done" : k === cur ? (p === "gate" ? "waiting" : "running") : "pending";
    nodes.set(`phase:${p}`, { id: `phase:${p}`, label: p, sub: p === "gate" && status === "waiting" ? "waiting for you" : "", status, details: [], path: null, kind: "phase" });
    if (i) edges.push({ from: `phase:${shown[i - 1]}`, to: `phase:${p}`, arrow: true });
  });
  const waves = new Map();
  for (const n of st.nodes ?? []) {
    if (n.phase === "exec" && n.wave !== undefined) {
      if (!waves.has(n.wave)) waves.set(n.wave, []);
      waves.get(n.wave).push(n);
    }
  }
  const order = [...waves.keys()].sort((a, b) => a - b);
  order.forEach((w, i) => {
    const id = `wave:${w}`;
    nodes.set(id, { id, label: `wave ${w}`, sub: "", status: groupStatus(waves.get(w)), details: [], path: null, kind: "wave" });
    edges.push({ from: i ? `wave:${order[i - 1]}` : "phase:exec", to: id, arrow: true });
  });
  for (const n of st.nodes ?? []) {
    const id = `node:${n.id}`;
    nodes.set(id, {
      // A node blocked by the retry cap waits for the user (Retry or Skip); a skipped one says so.
      id, label: n.gen > 0 ? `${n.id} · g${n.gen}` : n.id,
      sub: n.blocked ? `blocked after ${n.fails} failures` : n.skipped ? `${n.role ?? ""} · skipped` : n.role ?? "",
      status: n.blocked ? "blocked" : n.status,
      details: n.files?.length ? [`files: ${n.files.join(", ")}`] : [], path: null, kind: "node", node: n,
    });
    const parent = n.phase === "exec" && n.wave !== undefined ? `wave:${n.wave}` : `phase:${n.phase}`;
    if (nodes.has(parent)) edges.push({ from: parent, to: id, arrow: true });
  }
  return { nodes, edges };
}

// Why a later cycle opened, as a short arc label and an arc kind (it picks the arc's colour).
function arcKind(c) {
  if (String(c.slug ?? "").startsWith("cex")) return ["counterexample", "cex"];
  const src = c.followup?.source;
  if (src === "gate") return ["gate comment", "gate"];
  if (src === "qa" || src === "pr") return [`${src.toUpperCase()} follow-up`, "followup"];
  if (src) return ["follow-up", "followup"];
  return ["reopened", "other"];
}

/**
 * The whole run as one graph, like meta7: the phases once; every cycle's nodes under their phase (a later
 * cycle adds nodes and never replaces them); and for each later cycle a back-arc from what caused it to the
 * phase it restarted at, labelled with why. Older cycles' nodes are marked old (drawn dimmed), and clicking
 * one reads its output from its own cycle folder. hist is `forge history`; onlyCurrent shows one cycle.
 */
export function historyGraph(st, hist, { onlyCurrent = false } = {}) {
  const g = runGraph(st);
  if (onlyCurrent || !Array.isArray(hist) || hist.length < 2) return g;
  const idOf = (cycle, node) => (cycle === st.cycle ? `node:${node}` : `c${cycle}:node:${node}`);
  for (const c of hist) {
    if (c.cycle === st.cycle) continue;
    const waves = [...new Set(c.nodes.filter((n) => n.phase === "exec" && n.wave !== undefined).map((n) => n.wave))].sort((x, y) => x - y);
    waves.forEach((w, i) => {
      const id = `c${c.cycle}:wave:${w}`;
      g.nodes.set(id, { id, label: `wave ${w} · c${c.cycle}`, sub: "", status: groupStatus(c.nodes.filter((n) => n.wave === w)), details: [], path: null, kind: "wave", old: true });
      g.edges.push({ from: i ? `c${c.cycle}:wave:${waves[i - 1]}` : "phase:exec", to: id, arrow: true });
    });
    for (const n of c.nodes) {
      const id = idOf(c.cycle, n.id);
      g.nodes.set(id, {
        id, label: `${n.id}${n.gen > 0 ? ` · g${n.gen}` : ""} · c${c.cycle}`,
        sub: n.blocked ? `blocked after ${n.fails} failures` : n.skipped ? `${n.role ?? ""} · skipped` : n.role ?? "",
        status: n.blocked ? "blocked" : n.status, details: n.files?.length ? [`files: ${n.files.join(", ")}`] : [], path: null,
        kind: "node", node: { ...n, cycleDir: c.dir }, old: true, cycle: c.cycle,
      });
      const parent = n.phase === "exec" && n.wave !== undefined ? `c${c.cycle}:wave:${n.wave}` : `phase:${n.phase}`;
      if (g.nodes.has(parent)) g.edges.push({ from: parent, to: id, arrow: true });
    }
  }
  // One back-arc per later cycle. Old runs have no `from`: a counterexample cycle "cex-<slug>" came from the
  // node tla-<slug> when it exists, else the arc starts at the phase the earlier cycle was in.
  hist.forEach((c, i) => {
    if (!i) return;
    const prev = hist[i - 1];
    const guess = String(c.slug ?? "").startsWith("cex-") ? `tla-${c.slug.slice(4)}` : null;
    const node = c.from?.node ?? (guess && prev.nodes.some((n) => n.id === guess) ? guess : null);
    const from = node && g.nodes.has(idOf(prev.cycle, node)) ? idOf(prev.cycle, node) : `phase:${c.from?.phase ?? prev.phase}`;
    const to = `phase:${c.start ?? "grill"}`;
    if (!g.nodes.has(from) || !g.nodes.has(to)) return;
    const [word, kind] = arcKind(c);
    g.edges.push({ from, to, arrow: true, arc: kind, label: `cycle ${c.cycle}: ${word}`, reason: c.followup?.text ?? c.reason ?? "", cycle: c.cycle });
  });
  return g;
}

// ---------------------------------------------------------------- stage summary

/**
 * A readable name for an exec wave number (the table in forge's roles/exec-coord.md): `plan` is wave 1,
 * plan wave k is 100·k, its gates 100·k+1, fix round r 100·k+2r, the gates after it 100·k+2r+1, and its
 * commit 100·k+99. A k past lastPlan (the last plan wave) is the end check.
 */
export function waveName(w, lastPlan = Infinity) {
  if (w < 100) return "Plan";
  const k = Math.floor(w / 100), r = w % 100;
  const base = k > lastPlan ? "End check" : `Wave ${k}`;
  if (r === 0) return base;
  if (r === 99) return `${base} · commit`;
  if (r === 1) return `${base} · gates`;
  return r % 2 === 0 ? `${base} · fix ${r / 2}` : `${base} · gates after fix ${(r - 1) / 2}`;
}

/** The last plan wave: the highest k with units at wave 100·k (Infinity while no unit exists). */
export function lastPlanWave(nodes) {
  const ks = nodes.filter((n) => n.wave >= 100 && n.wave % 100 === 0).map((n) => n.wave / 100);
  return ks.length ? Math.max(...ks) : Infinity;
}

/**
 * Counts from a cycle's verify/summary.md table, and each model's verdict by slug (slug in column 2, verdict
 * in column 3): { models, failed, bySlug: { "<slug>": "COUNTEREXAMPLE" | "PASS" | "<other text>" } }.
 */
export function verdictCounts(markdown) {
  const rows = markdown.split("\n").filter((l) => /^\|\s*\d+\s*\|/.test(l));
  const bySlug = {};
  for (const row of rows) {
    const [, , slug = "", verdict = ""] = row.split("|").map((c) => c.trim().replace(/`/g, ""));
    if (slug) bySlug[slug] = /COUNTEREXAMPLE/.test(verdict) ? "COUNTEREXAMPLE" : /PASS/.test(verdict) ? "PASS" : verdict;
  }
  return { models: rows.length, failed: rows.filter((l) => /COUNTEREXAMPLE/.test(l)).length, bySlug };
}

const STAGE_NAME = { grill: "Grill", verify: "Verify", gate: "Gate", exec: "Exec" };
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Every cycle with its nodes. The current cycle's phase and nodes come from `forge status` (fresher).
function cyclesOf(st, hist) {
  const cur = { cycle: st.cycle ?? 1, dir: null, start: "grill", slug: null, reason: null, from: null, followup: null, phase: st.phase, nodes: st.nodes ?? [] };
  if (!Array.isArray(hist) || !hist.length) return [cur];
  return hist.map((c) => (c.cycle === cur.cycle ? { ...c, phase: st.phase, nodes: st.nodes ?? c.nodes } : c));
}

// The stage an exec node belongs to: the plan, a plan wave, or the end check.
function execStage(n, lastPlan) {
  if (n.wave === undefined || n.wave < 100) return "plan";
  const k = Math.floor(n.wave / 100);
  return k > lastPlan ? "end" : `wave:${k}`;
}

// One cycle's stages in order: [{ key, phase, label, nodes, future }]. The current cycle also shows the
// phases still ahead of it (up to exec, or done when the run is done).
function stagesOf(c, isCurrent, stPhase) {
  const from = Math.max(0, PHASES.indexOf(c.start ?? "grill"));
  const reached = PHASES.indexOf(c.phase);
  const last = isCurrent ? (stPhase === "done" ? PHASES.indexOf("done") : PHASES.indexOf("exec")) : reached;
  const out = [];
  for (let i = from; i <= last; i++) {
    const p = PHASES[i];
    const nodes = c.nodes.filter((n) => n.phase === p);
    const future = i > reached;
    if (p !== "exec" || !nodes.length) {
      out.push({ key: p, phase: p, label: p === "done" ? "Done" : `Cycle ${c.cycle} · ${STAGE_NAME[p]}`, nodes, future });
      continue;
    }
    const K = lastPlanWave(nodes);
    const groups = new Map();
    for (const n of nodes) {
      const k = execStage(n, K);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    }
    const rank = (k) => (k === "plan" ? 0 : k === "end" ? Infinity : Number(k.slice(5)));
    for (const k of [...groups.keys()].sort((a, b) => rank(a) - rank(b))) {
      const name = k === "plan" ? "Plan" : k === "end" ? "End check" : `Wave ${k.slice(5)}`;
      out.push({ key: k, phase: p, label: `Cycle ${c.cycle} · ${name}`, nodes: groups.get(k), future });
    }
  }
  return out;
}

// A stage box's second line: what happened in it, in counts.
function stageSub(s, verdict, waiting) {
  if (s.phase === "grill") {
    const rounds = Math.max(0, ...s.nodes.map((x) => Number(/-r(\d+)/.exec(x.id)?.[1] ?? 0)));
    return [rounds ? count(rounds, "round") : "", s.nodes.length ? count(s.nodes.length, "agent") : ""].filter(Boolean).join(", ");
  }
  if (s.phase === "verify") {
    const models = verdict?.models ?? s.nodes.filter((x) => x.role === "tla-writer").length;
    return models ? `${count(models, "model")}${verdict ? `, ${verdict.failed} failed` : ""}` : "";
  }
  if (s.phase === "gate") return waiting ? "waiting for you" : "";
  if (s.key === "plan") return "planner";
  if (s.key.startsWith("wave:") || s.key === "end") {
    const units = s.nodes.filter((x) => x.wave % 100 === 0).length;
    const fixes = new Set(s.nodes.filter((x) => x.wave % 100 > 1 && x.wave % 100 < 99 && x.wave % 2 === 0).map((x) => x.wave)).size;
    const committed = s.nodes.some((x) => x.wave % 100 === 99 && x.status === "done");
    return [units ? count(units, "unit") : "", fixes ? count(fixes, "fix round") : "", committed ? "committed" : ""].filter(Boolean).join(", ");
  }
  return "";
}

// The label on the arrow from stage a to stage b inside one cycle.
function stepLabel(a, b) {
  if (a.phase === "grill") return "spec written";
  if (a.phase === "verify") return "all models pass";
  if (a.phase === "gate") return "you approved";
  if (a.key === "plan") return "plan ready";
  return b.phase === "done" ? "done" : "committed";
}

/**
 * The run as stages, for the default Run view (drawn top to bottom): one box per cycle phase, exec split
 * into the plan, each plan wave, and the end check. Arrows say what moved the run on. The arrow into a later
 * cycle comes from the earlier cycle's last stage and says why the cycle opened (coloured by kind).
 * verdicts maps a cycle number to verdictCounts() of its verify/summary.md.
 */
export function stageGraph(st, hist, { onlyCurrent = false, verdicts = {} } = {}) {
  const nodes = new Map();
  const edges = [];
  const curCycle = st.cycle ?? 1;
  const cycles = cyclesOf(st, hist).filter((c) => !onlyCurrent || c.cycle === curCycle);
  let prevLast = null;
  for (const c of cycles) {
    const isCurrent = c.cycle === curCycle;
    const stages = stagesOf(c, isCurrent, st.phase);
    let prev = null;
    for (const s of stages) {
      const id = `c${c.cycle}:${s.key}`;
      const current = isCurrent && s.phase === st.phase && st.phase !== "done";
      const verdict = s.phase === "verify" ? verdicts[c.cycle] : null;
      const gs = s.nodes.length ? groupStatus(s.nodes) : null;
      let status;
      if (s.future) status = "pending";
      else if (current && st.phase === "gate") status = "waiting";
      else if (verdict?.failed) status = "failed";
      else if (gs) status = gs === "pending" && current && s.phase !== "exec" ? "running" : gs;
      else status = current ? "running" : "done";
      // An exec stage that has not started yet (a later wave, the end check) is ahead of the run too.
      const ahead = s.future || (s.phase === "exec" && status === "pending");
      nodes.set(id, {
        id, label: s.label, sub: stageSub(s, verdict, status === "waiting"), status, details: [], path: null,
        kind: "stage", visited: !ahead, stage: { cycle: c.cycle, key: s.key, dir: c.dir },
      });
      if (prev) {
        const e = { from: prev.id, to: id, arrow: true };
        if (!ahead) {
          const label = stepLabel(prev.s, s);
          Object.assign(e, { arc: "step", label, reason: label });
        }
        edges.push(e);
      } else if (prevLast) {
        const [word, kind] = arcKind(c);
        const failed = verdicts[c.cycle - 1]?.failed ?? 0;
        const name = String(c.slug ?? "").replace(/^cex-?/, "");
        const label = kind !== "cex" ? word : failed > 1 ? `${failed} counterexamples (first: ${name})` : `counterexample: ${name}`;
        edges.push({ from: prevLast, to: id, arrow: true, arc: kind, label, reason: c.followup?.text ?? c.reason ?? "", cycle: c.cycle });
      }
      prev = { id, s };
    }
    const lastSeen = [...stages].reverse().find((s) => nodes.get(`c${c.cycle}:${s.key}`)?.visited);
    if (lastSeen) prevLast = `c${c.cycle}:${lastSeen.key}`;
  }
  return { nodes, edges };
}

/**
 * One stage's agents, for the drill-down (drawn left to right): the stage box first, then each agent. In an
 * exec stage the agents sit under their named wave step (Wave 1 · gates, Wave 1 · fix 1, …). An older
 * cycle's agent carries cycleDir, so a click reads its output from its own cycle folder.
 */
export function stageDetail(st, hist, stageId, verdicts = {}) {
  const nodes = new Map();
  const edges = [];
  const m = /^c(\d+):(.+)$/.exec(stageId ?? "");
  if (!m) return { nodes, edges };
  const cycle = Number(m[1]), key = m[2];
  const c = cyclesOf(st, hist).find((x) => x.cycle === cycle);
  if (!c) return { nodes, edges };
  const isCurrent = cycle === (st.cycle ?? 1);
  const s = stagesOf(c, isCurrent, st.phase).find((x) => x.key === key);
  if (!s) return { nodes, edges };
  const root = `stage:${stageId}`;
  // The stage box has the same status as in the stage summary (a verify with counterexamples is failed).
  const status = stageGraph(st, hist, { verdicts }).nodes.get(stageId)?.status ?? (s.nodes.length ? groupStatus(s.nodes) : null);
  nodes.set(root, { id: root, label: s.label, sub: "", status, details: [], path: null, kind: "phase" });
  const K = lastPlanWave(c.nodes.filter((n) => n.phase === "exec"));
  const steps = [...new Set(s.nodes.filter((n) => n.phase === "exec" && n.wave >= 100).map((n) => n.wave))].sort((a, b) => a - b);
  steps.forEach((w, i) => {
    const id = `wave:${w}`;
    nodes.set(id, { id, label: waveName(w, K), sub: "", status: groupStatus(s.nodes.filter((n) => n.wave === w)), details: [], path: null, kind: "wave" });
    edges.push({ from: i ? `wave:${steps[i - 1]}` : root, to: id, arrow: true });
  });
  // A TLA+ model's box shows its verdict from verify/summary.md: its agent is done either way.
  const bySlug = verdicts[cycle]?.bySlug ?? {};
  for (const n of s.nodes) {
    const id = `node:${n.id}`;
    const verdict = n.phase === "verify" && n.id.startsWith("tla-") ? bySlug[n.id.slice(4)] : undefined;
    nodes.set(id, {
      id, label: n.gen > 0 ? `${n.id} · g${n.gen}` : n.id,
      sub: n.blocked ? `blocked after ${n.fails} failures` : n.skipped ? `${n.role ?? ""} · skipped`
        : verdict === "COUNTEREXAMPLE" ? "counterexample" : verdict === "PASS" ? "pass" : n.role ?? "",
      status: n.blocked ? "blocked" : verdict === "COUNTEREXAMPLE" ? "failed" : n.status,
      details: n.files?.length ? [`files: ${n.files.join(", ")}`] : [], path: null, kind: "node",
      node: isCurrent ? n : { ...n, cycleDir: c.dir },
    });
    edges.push({ from: n.phase === "exec" && n.wave >= 100 ? `wave:${n.wave}` : root, to: id, arrow: true });
  }
  return { nodes, edges };
}

/** The bullets of "## Agent decisions to confirm" in the gate spec: [{ id, text }]. */
export function agentDecisions(markdown) {
  const m = /^## Agent decisions to confirm\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(markdown);
  if (!m) return [];
  return m[1].split("\n").filter((l) => /^\s*-\s+/.test(l)).map((l) => {
    const text = l.replace(/^\s*-\s+/, "").trim();
    const id = /\*\*(D\d+)\*\*|^(D\d+)\b/.exec(text);
    return { id: id ? id[1] ?? id[2] : null, text: text.replace(/\*\*/g, "") };
  });
}

/** Box size in layout px for a node: wide enough for its label, two lines when it has a second line. */
export function boxSize(n) {
  const chars = Math.max(n.label.length, Math.min(n.sub?.length ?? 0, 40) * 0.85);
  return { w: Math.max(110, Math.min(340, Math.round(chars * 8.6 + 30))), h: n.sub ? 50 : 36 };
}
