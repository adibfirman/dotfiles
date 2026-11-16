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
  return { w: Math.max(110, Math.min(260, Math.round(chars * 7.2 + 30))), h: n.sub ? 50 : 36 };
}
