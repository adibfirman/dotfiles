// From Blueprint for Herdr (https://github.com/chappse6/herdr-blueprint-app, mods/blueprint/layout.js),
// MIT licensed, copied unchanged below this note. See BLUEPRINT-LICENSE.md.

// Layered layout for small flowcharts (Sugiyama-style), in graph units (px at 100%).
//
//   1. cycles: DFS back edges are reversed for ranking and drawn as side arcs
//   2. ranks by longest path; sources move next to their nearest target
//   3. an edge longer than one rank gets a dummy point in each rank it crosses
//   4. order inside each rank by barycenter sweeps, keeping the fewest crossings
//   5. coordinates: ranks along the main axis, each node pulled toward its neighbours
//   6. edges as cubic beziers through their dummy points
//
// layout(g, "LR" | "TB", size(node) -> {w, h}, labelSize(edge) -> {w, h})
//   -> { nodes: [{node, x, y, w, h}], edges: [{e, segs, label, tip, dir}], bounds }
//
// A big diagram takes longer than Herdr lets one call run (a render gets about
// 50 ms), so the work is also a generator, layoutSteps: it yields between
// rounds, and the caller runs it a few ms at a time between frames.

const SEP = { LR: 28, TB: 36 }; // between nodes across the main axis
const DUMMY_SEP = 14;
const GAP = { LR: 56, TB: 44 }; // between ranks along it

export function layout(g, dir, size, labelSize) {
  const steps = layoutSteps(g, dir, size, labelSize);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

export function* layoutSteps(g, dir, size, labelSize) {
  const LR = dir === "LR";
  const ids = [...g.nodes.keys()];
  const edges = g.edges.filter((e) => e.from !== e.to && g.nodes.has(e.from) && g.nodes.has(e.to));

  // 1. cycles
  const state = new Map(), back = new Set();
  const from = new Map(ids.map((id) => [id, []]));
  for (const e of edges) from.get(e.from).push(e);
  const visit = (v) => {
    state.set(v, 1);
    for (const e of from.get(v)) {
      const s = state.get(e.to);
      if (s === 1) back.add(e);
      else if (!s) visit(e.to);
    }
    state.set(v, 2);
  };
  const hasIn = new Set(edges.map((e) => e.to));
  for (const id of ids) if (!hasIn.has(id) && !state.get(id)) visit(id);
  for (const id of ids) if (!state.get(id)) visit(id);
  const forward = edges.filter((e) => !back.has(e));

  // 2. ranks
  const rank = new Map(ids.map((id) => [id, 0]));
  const ranked = [...forward.map((e) => [e.from, e.to]), ...[...back].map((e) => [e.to, e.from])];
  for (let k = 0; k < ids.length; k++) {
    let longer = false;
    for (const [u, v] of ranked) {
      if (rank.get(v) < rank.get(u) + 1) {
        rank.set(v, rank.get(u) + 1);
        longer = true;
      }
    }
    if (!longer) break; // settled: more rounds change nothing
    yield;
  }
  // Then every box with more edges out than in (a start, or a box that hands
  // off to several) moves down to just above what it leads to: each step down
  // shortens more edges than it lengthens. Bottom up, so a box sees where its
  // children end up. Without it a start feeding the bottom of the drawing sat
  // at the top, with long edges down one side and empty space around them.
  const order = [...ids].sort((a, b) => rank.get(b) - rank.get(a));
  const succ = new Map(ids.map((id) => [id, []])), preds = new Map(ids.map((id) => [id, 0]));
  for (const [u, v] of ranked) {
    succ.get(u).push(v);
    preds.set(v, preds.get(v) + 1);
  }
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const id of order) {
      const outs = succ.get(id).map((v) => rank.get(v));
      const ins = preds.get(id);
      if (!outs.length || outs.length <= ins) continue;
      const to = Math.min(...outs) - 1;
      if (to > rank.get(id)) {
        rank.set(id, to);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const top = Math.min(...rank.values());
  for (const id of ids) rank.set(id, rank.get(id) - top);
  const R = Math.max(0, ...rank.values()) + 1;

  // 3. dummies (forward edges only; back edges go around the side)
  const layers = Array.from({ length: R }, () => []);
  for (const id of ids) layers[rank.get(id)].push(id);
  const dummy = new Set();
  const up = new Map(ids.map((id) => [id, []])), down = new Map(ids.map((id) => [id, []]));
  const chains = forward.map((e, i) => {
    const chain = [e.from];
    for (let r = rank.get(e.from) + 1; r < rank.get(e.to); r++) {
      const id = `\u0000${i}:${r}`;
      dummy.add(id);
      rank.set(id, r);
      layers[r].push(id);
      up.set(id, []);
      down.set(id, []);
      chain.push(id);
    }
    chain.push(e.to);
    for (let k = 0; k + 1 < chain.length; k++) {
      down.get(chain[k]).push(chain[k + 1]);
      up.get(chain[k + 1]).push(chain[k]);
    }
    return chain;
  });

  // 4. order
  const crossings = () => {
    let c = 0;
    for (let r = 0; r + 1 < R; r++) {
      const pos = new Map(layers[r + 1].map((id, i) => [id, i]));
      const segs = [];
      layers[r].forEach((a, i) => down.get(a).forEach((b) => segs.push([i, pos.get(b)])));
      for (let x = 0; x < segs.length; x++) {
        for (let y = x + 1; y < segs.length; y++) if ((segs[x][0] - segs[y][0]) * (segs[x][1] - segs[y][1]) < 0) c++;
      }
    }
    return c;
  };
  yield;
  let best = layers.map((l) => [...l]), fewest = crossings();
  for (let it = 0; it < 16 && fewest > 0; it++) {
    yield;
    const downward = it % 2 === 0;
    for (let k = 1; k < R; k++) {
      const r = downward ? k : R - 1 - k;
      const pos = new Map(layers[downward ? r - 1 : r + 1].map((id, i) => [id, i]));
      const bc = new Map(layers[r].map((id, i) => {
        const nb = (downward ? up : down).get(id);
        return [id, nb.length ? nb.reduce((s, n) => s + pos.get(n), 0) / nb.length : i];
      }));
      layers[r].sort((a, b) => bc.get(a) - bc.get(b));
    }
    const c = crossings();
    if (c < fewest) {
      best = layers.map((l) => [...l]);
      fewest = c;
    }
  }
  best.forEach((l, r) => (layers[r] = l));

  // 5. coordinates
  const sz = new Map(ids.map((id) => [id, size(g.nodes.get(id))]));
  const along = (id) => (dummy.has(id) ? 0 : LR ? sz.get(id).w : sz.get(id).h);
  const across = (id) => (dummy.has(id) ? 0 : LR ? sz.get(id).h : sz.get(id).w);
  const apart = (a, b) => (across(a) + across(b)) / 2 + (dummy.has(a) || dummy.has(b) ? DUMMY_SEP : SEP[dir]);

  const labels = new Map(edges.filter((e) => e.label).map((e) => [e, labelSize(e)]));
  const gapAfter = Array(R).fill(GAP[dir]);
  for (const e of forward) {
    const l = labels.get(e);
    if (l) gapAfter[rank.get(e.from)] = Math.max(gapAfter[rank.get(e.from)], (LR ? l.w : l.h) + (LR ? 44 : 40));
  }
  const mainPos = [];
  let acc = 0;
  for (let r = 0; r < R; r++) {
    const ext = Math.max(0, ...layers[r].map(along));
    mainPos.push(acc + ext / 2);
    acc += ext + gapAfter[r];
  }

  const cross = new Map();
  for (const layer of layers) {
    let x = 0;
    layer.forEach((id, i) => {
      if (i) x += apart(layer[i - 1], id);
      cross.set(id, x);
    });
    for (const id of layer) cross.set(id, cross.get(id) - x / 2);
  }
  // Each layer in turn goes where its edges are shortest (the sum of squared
  // offsets to its neighbours, long edges' pieces counting more so they stay
  // straight) while keeping its order and spacing. Every step can only shorten
  // the edges, so the drawing settles instead of drifting apart (pushing a
  // layer one way and re-centring it did, when a long edge crossed a branch).
  const weight = (a, b) => (dummy.has(a) && dummy.has(b) ? 4 : dummy.has(a) || dummy.has(b) ? 2 : 1);
  // Neighbours with their weights and each layer's spacing stay the same
  // through the rounds, so they are worked out once.
  const near = new Map([...up.keys()].map((id) => [id, [...up.get(id), ...down.get(id)].map((n) => [n, weight(id, n)])]));
  const gaps = layers.map((layer) => layer.map((id, i) => (i ? apart(layer[i - 1], id) : 0)));
  for (let it = 0; it < 24; it++) {
    yield;
    const downward = it % 2 === 0;
    for (let k = 0; k < R; k++) {
      const r = downward ? k : R - 1 - k, layer = layers[r];
      const want = [], w = [];
      for (const id of layer) {
        let sum = 0, total = 0;
        for (const [n, wt] of near.get(id)) {
          sum += wt * cross.get(n);
          total += wt;
        }
        want.push(total ? sum / total : cross.get(id));
        w.push(total || 0.01);
      }
      const x = spaced(want, w, gaps[r]);
      layer.forEach((id, i) => cross.set(id, x[i]));
    }
  }
  yield;
  // A one-to-one link (a's only successor is b, b's only predecessor is a)
  // should be straight: line b up with a when its neighbours leave room.
  for (let round = 0; round < 2; round++) {
    for (let r = 1; r < R; r++) {
      const layer = layers[r];
      layer.forEach((b, i) => {
        if (up.get(b).length !== 1) return;
        const a = up.get(b)[0];
        if (down.get(a).length !== 1) return;
        let x = cross.get(a);
        if (i > 0) x = Math.max(x, cross.get(layer[i - 1]) + apart(layer[i - 1], b));
        if (i + 1 < layer.length) x = Math.min(x, cross.get(layer[i + 1]) - apart(b, layer[i + 1]));
        cross.set(b, x);
      });
    }
  }
  const P = new Map();
  for (const [id, r] of rank) P.set(id, LR ? { x: mainPos[r], y: cross.get(id) } : { x: cross.get(id), y: mainPos[r] });

  // 6. edges
  const box = (id) => ({ ...P.get(id), ...sz.get(id), shape: g.nodes.get(id).shape });
  const main = LR ? [1, 0] : [0, 1];
  // Several edges into (or out of) one side spread along it, in the order of
  // where they come from, instead of meeting in one point.
  const ins = new Map(), outs = new Map();
  forward.forEach((e, i) => {
    const ch = chains[i];
    if (!ins.has(e.to)) ins.set(e.to, []);
    if (!outs.has(e.from)) outs.set(e.from, []);
    ins.get(e.to).push({ i, at: P.get(ch[ch.length - 2]) });
    outs.get(e.from).push({ i, at: P.get(ch[1]) });
  });
  const spread = (map, id, i) => {
    const list = map.get(id) ?? [];
    if (list.length < 2 || g.nodes.get(id).shape === "diamond") return 0;
    const key = (p) => (LR ? p.at.y : p.at.x);
    list.sort((a, b) => key(a) - key(b));
    const step = Math.min(18, ((LR ? sz.get(id).h : sz.get(id).w) * 0.5) / (list.length - 1));
    return (list.findIndex((x) => x.i === i) - (list.length - 1) / 2) * step;
  };
  const shift = (p, d) => (LR ? { x: p.x, y: p.y + d } : { x: p.x + d, y: p.y });
  const out = [];
  for (let i = 0; i < forward.length; i++) {
    if (i % 128 === 127) yield;
    const e = forward[i];
    const pts = chains[i].map((id) => ({ ...P.get(id) }));
    const u = box(e.from), v = box(e.to);
    const start = exitPort(u, pts[1], LR), end = entryPort(v, LR);
    if (!(u.shape === "diamond" && (LR ? start.t[1] : start.t[0]))) start.p = shift(start.p, spread(outs, e.from, i));
    end.p = shift(end.p, spread(ins, e.to, i));
    pts[0] = start.p;
    pts[pts.length - 1] = end.p;
    const tan = pts.map((_, k) => (k === 0 ? start.t : k === pts.length - 1 ? end.t : main));
    const segs = [];
    for (let k = 0; k + 1 < pts.length; k++) segs.push(bezier(pts[k], pts[k + 1], tan[k], tan[k + 1]));
    const last = segs[segs.length - 1];
    out.push({ e, segs, label: e.label ? at(segs[0], 0.45) : null, tip: last[3], dir: norm(sub(last[3], last[2])) });
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y, hw = 0, hh = 0) => {
    minX = Math.min(minX, x - hw); maxX = Math.max(maxX, x + hw);
    minY = Math.min(minY, y - hh); maxY = Math.max(maxY, y + hh);
  };
  for (const id of ids) grow(P.get(id).x, P.get(id).y, sz.get(id).w / 2 + 10, sz.get(id).h / 2 + 10);

  yield;
  // Back edges: an arc outside everything they span, on the far side.
  for (const e of back) {
    const a = box(e.from), b = box(e.to);
    const lo = Math.min(rank.get(e.from), rank.get(e.to)), hi = Math.max(rank.get(e.from), rank.get(e.to));
    let side = -Infinity;
    for (const id of ids) {
      if (rank.get(id) < lo || rank.get(id) > hi) continue;
      side = Math.max(side, LR ? P.get(id).y + sz.get(id).h / 2 : P.get(id).x + sz.get(id).w / 2);
    }
    side += 36;
    const p0 = LR ? { x: a.x, y: a.y + a.h / 2 } : { x: a.x + a.w / 2, y: a.y };
    const p3 = LR ? { x: b.x, y: b.y + b.h / 2 } : { x: b.x + b.w / 2, y: b.y };
    const seg = LR
      ? [p0, { x: p0.x, y: side }, { x: p3.x, y: side }, p3]
      : [p0, { x: side, y: p0.y }, { x: side, y: p3.y }, p3];
    out.push({ e, segs: [seg], label: e.label ? at(seg, 0.5) : null, tip: p3, dir: norm(sub(p3, seg[2])), back: true });
    grow(LR ? p0.x : side, LR ? side : p0.y, 4, 4);
  }
  // A label goes where it covers no other label and no box: first the usual
  // spot near the start, then further along its own path. Edges leaving one
  // box side by side would otherwise put theirs on the same line.
  const taken = ids.map((id) => ({ x: P.get(id).x, y: P.get(id).y, w: sz.get(id).w, h: sz.get(id).h }));
  const clear = (c, l) => taken.every((b) => Math.abs(c.x - b.x) * 2 >= l.w + b.w + 4 || Math.abs(c.y - b.y) * 2 >= l.h + b.h + 4);
  let placed = 0;
  for (const ed of out) {
    const l = ed.label && labels.get(ed.e);
    if (!l) continue;
    if (++placed % 32 === 0) yield;
    const spots = [ed.label];
    for (const sg of ed.segs) for (const t of [0.45, 0.25, 0.65, 0.85]) spots.push(at(sg, t));
    ed.label = spots.find((c) => clear(c, l)) ?? ed.label;
    taken.push({ ...ed.label, w: l.w, h: l.h });
  }
  for (const ed of out) {
    const l = ed.label && labels.get(ed.e);
    if (l) grow(ed.label.x, ed.label.y, l.w / 2, l.h / 2);
  }

  return {
    nodes: ids.map((id) => ({ node: g.nodes.get(id), ...P.get(id), ...sz.get(id) })),
    edges: out,
    bounds: { minX, minY, maxX, maxY },
  };
}

// Where an edge leaves `u` toward `next`, and its direction there. A diamond
// branching up or down leaves from that corner (the "yes / no" look).
// Positions closest to `want` (least squares, weighted by `w`) that keep the
// order with at least gaps[i] between i-1 and i: subtract the running gap,
// then pool neighbours that are out of order (isotonic regression).
function spaced(want, w, gaps) {
  const off = [];
  gaps.forEach((g, i) => off.push((i ? off[i - 1] : 0) + g));
  const blocks = [];
  want.forEach((v, i) => {
    blocks.push({ v: v - off[i], w: w[i], n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
      const b2 = blocks.pop(), b1 = blocks.pop();
      blocks.push({ v: (b1.v * b1.w + b2.v * b2.w) / (b1.w + b2.w), w: b1.w + b2.w, n: b1.n + b2.n });
    }
  });
  const out = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(b.v + off[out.length]);
  return out;
}

function exitPort(u, next, LR) {
  if (LR) {
    if (u.shape === "diamond" && Math.abs(next.y - u.y) > u.h / 4) {
      const s = Math.sign(next.y - u.y);
      return { p: { x: u.x, y: u.y + (s * u.h) / 2 }, t: [0, s] };
    }
    return { p: { x: u.x + u.w / 2, y: u.y }, t: [1, 0] };
  }
  if (u.shape === "diamond" && Math.abs(next.x - u.x) > u.w / 4) {
    const s = Math.sign(next.x - u.x);
    return { p: { x: u.x + (s * u.w) / 2, y: u.y }, t: [s, 0] };
  }
  return { p: { x: u.x, y: u.y + u.h / 2 }, t: [0, 1] };
}

function entryPort(v, LR) {
  return LR ? { p: { x: v.x - v.w / 2, y: v.y }, t: [1, 0] } : { p: { x: v.x, y: v.y - v.h / 2 }, t: [0, 1] };
}

function bezier(p0, p1, t0, t1) {
  const d = sub(p1, p0);
  const k0 = Math.max(16, Math.abs(d.x * t0[0] + d.y * t0[1]) * 0.5);
  const k1 = Math.max(16, Math.abs(d.x * t1[0] + d.y * t1[1]) * 0.5);
  return [p0, { x: p0.x + t0[0] * k0, y: p0.y + t0[1] * k0 }, { x: p1.x - t1[0] * k1, y: p1.y - t1[1] * k1 }, p1];
}

export function at([a, b, c, d], t) {
  const s = 1 - t;
  return {
    x: s * s * s * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c.x + t * t * t * d.x,
    y: s * s * s * a.y + 3 * s * s * t * b.y + 3 * s * t * t * c.y + t * t * t * d.y,
  };
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const norm = (v) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};
