// forge: the run graph, the spec graphs, the gate, and the buttons for a forge run.
// The forge CLI owns the state; this mod reads `forge status` and calls forge commands.
import { View, div, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView, Popover } from "gpui-base";
import { theme, settings, focused, exec, readTextFile, writeTextFile, watchFolder, notify, run, hc, appHome, shared, setShared, closeOverlay, props as given } from "herdr";
import * as fs from "fs/promises";
import { layout } from "./layout.js";
import { agentDecisions, boxSize, historyGraph, parseTsGraph, tsBlocks } from "./graph.js";
import { forge, listRuns, readJson, repoOf } from "./data.js";

// The size of a back-arc label, in graph units (the layout keeps it off boxes and other labels).
const arcLabelSize = (label) => ({ w: label.length * 6.4 + 18, h: 20 });

// Herdr's zoom scales the px we give and paint_path geometry, not on_size_change sizes (see Blueprint).
const zoomOf = (s) => (Number(s?.zoom) > 0 ? Number(s.zoom) : 1);
const alpha = (hex, a) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(a * 255).toString(16).padStart(2, "0") : hex);
const HEADER_H = 40;

export default class Forge extends View {
  init(props, cx) {
    Object.assign(this, {
      cwd: null, repo: null, runs: [], dir: null, pinned: null, st: null, error: null,
      specText: "", tab: "run", lastPhase: null, selected: null, detail: null,
      size: { width: 640, height: 420 }, zoom: 1, busy: null, loading: false, gen: 0, layouts: new Map(), views: {}, drag: null, dragged: false,
    });
    this.followup = InputState.new({ placeholder: "Follow-up: a QA bug or a new request, then Enter" });
    this.followup.on("submit", (_e, cx) => this.sendFollowup(cx));
    this.comment = TextareaState.new({ placeholder: "Gate comment, or an override like \"D8: keep partial refunds\"", rows: 3 });
    this.ticketIn = InputState.new({ placeholder: "Ticket, like ABC-123 (empty: no ticket, run here)" });
    this.goalIn = TextareaState.new({ placeholder: "What to build: the goal, the rules, the files", rows: 6 });
    // props.run pins one run folder: `herdr-app do pane.split --direction right --mod forge --props '{"run":"<dir>"}'`.
    // Pane props come from props() (the init argument does not carry them).
    this.pinned = this.propsRun = given()?.run ?? props?.run ?? null;
    // A click on a forge row in the spaces sidebar sets "forge.selected"; this panel then shows that run.
    this.selAt = shared("forge.selected")?.at ?? null;
    cx.timer.every(8000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  // ---------------------------------------------------------------- data

  refresh(cx) {
    const p = given()?.run ?? null;
    if (p && p !== this.propsRun) Object.assign(this, { propsRun: p, pinned: p, cwd: null });
    const sel = shared("forge.selected");
    if (sel?.at && sel.at !== this.selAt && !this.propsRun) {
      this.selAt = sel.at;
      Object.assign(this, { propsRun: sel.dir, pinned: sel.dir, cwd: null, tab: "run", selected: null, detail: null });
    }
    const f = focused();
    if (f?.cwd && !this.pinnedByProps()) this.cwd = f.cwd;
    if ((!this.cwd && !this.pinned) || this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        if (!this.cwd && this.pinned) {
          const meta = await readJson(`${this.pinned}/run.json`);
          this.runJsonState = meta ? "ok" : "unreadable";
          this.cwd = meta?.worktree ?? null;
        }
        const found = await repoOf(this.cwd);
        this.repoError = found?.error ?? null;
        const repo = found?.error ? null : found;
        if (repo?.main !== this.repo?.main) Object.assign(this, { dir: null, pinned: this.propsRun, st: null, selected: null, detail: null });
        this.repo = repo;
        this.runs = repo ? await listRuns(repo.main) : [];
        const dir = (this.pinned && this.runs.find((r) => r.dir === this.pinned)?.dir) ?? this.runs.find((r) => r.worktree === repo?.top)?.dir ?? this.runs[0]?.dir ?? null;
        if (dir !== this.dir) {
          this.dir = dir;
          this.watch(cx);
        }
        await this.load();
        // What this copy sees, for debugging without a screenshot (a covered window is not redrawn).
        await fs.mkdir(`${appHome()}/data/forge`, { recursive: true }).catch(() => {});
        await fs.writeFile(`${appHome()}/data/forge/last-state.json`, JSON.stringify({
          at: new Date().toISOString(), cwd: this.cwd, propsRun: this.propsRun, dir: this.dir, repo: this.repo,
          phase: this.st?.phase ?? null, nodes: this.st?.nodes?.length ?? null, specChars: this.specText.length, tab: this.tab, error: this.error, repoError: this.repoError,
        }, null, 2)).catch(() => {});
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  pinnedByProps() {
    return Boolean(this.pinned) && this.pinned === this.propsRun;
  }

  async load() {
    if (!this.dir) {
      this.st = null;
      return;
    }
    const r = await forge(["status"], { run: this.dir, cwd: this.repo.main });
    this.st = r.ok ? JSON.parse(r.out) : null;
    this.error = r.ok ? null : r.err;
    // Every cycle, for the one-graph Run view (a later cycle adds to the graph and loops back to its cause).
    if (this.st?.cycle > 1) {
      const h = await forge(["history"], { run: this.dir, cwd: this.repo.main });
      this.hist = h.ok ? JSON.parse(h.out) : null;
    } else this.hist = null;
    const spec = this.st && (this.st.phase === "gate" ? this.st.spec.gate : this.st.spec.approved ?? this.st.spec.gate ?? this.st.spec.draft);
    this.specText = spec ? (await readTextFile(spec)) ?? "" : "";
    if (this.st?.phase === "gate" && this.lastPhase !== "gate") this.tab = "gate";
    this.lastPhase = this.st?.phase ?? null;
  }

  // One watch per shown run: a change under the run folder refreshes the view.
  watch(cx) {
    const g = ++this.gen, dir = this.dir;
    if (!dir) return;
    cx.spawn(async (cx) => {
      while (g === this.gen) {
        try {
          await watchFolder(dir);
        } catch {
          return; // the 8 s timer still refreshes
        }
        if (g === this.gen) this.refresh(cx);
      }
    });
  }

  // ---------------------------------------------------------------- actions

  act(cx, label, args, timeout = 120_000) {
    if (this.busy) return;
    this.busy = label;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await forge(args, { run: this.dir, cwd: this.repo.main, timeout });
      this.busy = null;
      notify({ title: `Forge: ${label}`, body: r.ok ? "Done." : r.err.slice(0, 400), level: r.ok ? "success" : "error" });
      this.refresh(cx);
      cx.notify();
    });
  }

  sendFollowup(cx) {
    const text = this.followup.value().trim();
    if (!text || !this.dir) return;
    this.followup.set_value("");
    this.act(cx, "follow-up sent", ["followup", text, "--source", "user"]);
  }

  sendComment(cx) {
    const text = this.comment.value().trim();
    if (!text) return;
    this.comment.set_value("");
    this.act(cx, "gate comment sent", ["followup", text, "--source", "gate"]);
  }

  start(cx) {
    const goal = this.goalIn.value().trim();
    if (!goal || !this.repo || this.busy) return;
    const ticket = this.ticketIn.value().trim();
    this.busy = "starting";
    cx.notify();
    cx.spawn(async (cx) => {
      const inbox = `${this.repo.main}/.forge/inbox`;
      const file = `${inbox}/${Date.now()}.md`;
      const front = ticket ? `ticket: ${ticket}\ntype: feat\nbase: main` : "ticket: none";
      let msg = null;
      try {
        await exec("mkdir", ["-p", inbox]);
        await writeTextFile(file, `---\n${front}\n---\n${goal}\n`, null);
        const init = await forge(["init", file], { cwd: this.cwd, timeout: 120_000 });
        if (!init.ok) throw new Error(init.err);
        const dir = JSON.parse(init.out).run;
        const coord = await forge(["coord"], { run: dir, cwd: this.repo.main, timeout: 120_000 });
        if (!coord.ok) throw new Error(coord.err);
        this.pinned = dir;
        this.goalIn.set_value("");
        this.ticketIn.set_value("");
      } catch (e) {
        msg = String(e?.message ?? e);
      }
      this.busy = null;
      notify({ title: "Forge: start", body: msg ? msg.slice(0, 400) : "The grill coordinator is running.", level: msg ? "error" : "success" });
      this.refresh(cx);
      cx.notify();
    });
  }

  // The user's decision on a blocked node: forge retry (fresh count) or forge skip (counts as done).
  decide(cx, node, how) {
    if (this.busy || !this.dir) return;
    this.busy = how === "retry" ? "retrying" : "skipping";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await forge([how, node], { run: this.dir, cwd: this.repo?.main });
      this.busy = null;
      if (r.ok) this.detail = null;
      notify({ title: `Forge: ${how} ${node}`, body: r.ok ? (how === "retry" ? "The coordinator tries it again." : "Skipped: it counts as done.") : r.err.slice(0, 300), level: r.ok ? "success" : "error" });
      this.refresh(cx);
      cx.notify();
    });
  }

  // A running node: show its agent's terminal beside this pane. A finished one: show its output here.
  open(n, cx) {
    if (!n.node || !this.st) return;
    const { id, gen, phase, status } = n.node;
    // An older cycle's node: its output is in its own cycle folder, and its agent is long gone.
    const cyclePath = n.node.cycleDir ? `${this.dir}/cycles/${n.node.cycleDir}` : this.st.cyclePath;
    cx.spawn(async (cx) => {
      const info = n.node.cycleDir ? null : await readJson(`${cyclePath}/.spawn/${id}-g${gen}.json`);
      if (status === "running" && info?.terminal) {
        const r = await hc(["get", info.terminal, "--json"]).catch(() => null);
        let live = false;
        try {
          live = r?.code === 0 && JSON.parse(r.stdout).state === "live";
        } catch {
          live = false;
        }
        if (live) {
          run("terminal.keep", { terminal: info.terminal, place: "right" });
          return;
        }
      }
      const text = await readTextFile(`${cyclePath}/${phase}/${id}.md`);
      const blocked = Boolean(n.node.blocked);
      this.detail = {
        title: blocked ? `${id} · blocked after ${n.node.fails} failures` : `${n.label} · ${status}${n.node.skipped ? " (skipped)" : ""}`,
        text: text ?? "No output file yet.", node: id, blocked: blocked && !n.node.cycleDir,
      };
      cx.notify();
    });
  }

  // The run window went away (closed, or its coordinator ended): the sidebar no longer marks the run as open.
  async close() {
    if (given()?.overlay && shared("forge.window")?.run === this.propsRun) setShared("forge.window", null);
  }

  // ---------------------------------------------------------------- view

  render(cx) {
    const t = theme();
    this.zoom = zoomOf(settings());
    if (!this.propsRun && (shared("forge.selected")?.at ?? null) !== this.selAt) this.refresh(cx);
    return v_flex().id("forge").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).overflow_hidden()
      // In a run window, a press that reaches the window drags it: stop presses here, so dragging the graph
      // pans it and the window stays where it is. (Inner handlers, like the graph's pan, run first.)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(this.header(t, cx))
      .when(Boolean(this.st), (el) => el.child(this.viewRow(t)))
      .child(div().id("forge-body").flex_1().min_h(0).relative()
        .on_size_change((s, cx) => {
          const n = { width: s.width / this.zoom, height: s.height / this.zoom };
          if (Math.abs(n.width - this.size.width) > 1 || Math.abs(n.height - this.size.height) > 1) {
            this.size = n;
            cx.notify();
          }
        })
        .child(this.body(t, cx)))
      .when(Boolean(this.detail), (el) => el.child(this.detailView(t)))
      .child(this.footer(t, cx));
  }

  button(t, id, label, onClick, { primary = false, enabled = true } = {}) {
    const on = enabled && !this.busy;
    return div().id(id).h(26).px(10).flex().items_center().rounded(6).text_size(12)
      .bg(primary && on ? t.solid : t.raised).text_color(primary && on ? t.solid_foreground : on ? t.foreground : t.dim)
      .when(on, (e) => e.cursor_pointer().hover((s) => s.bg(primary ? t.solid : t.hover)).on_click((_e, cx) => onClick(cx)))
      .child(label);
  }

  pill(t, text, color) {
    return div().px(7).py(1).rounded(10).text_size(11).bg(alpha(color, 0.16)).text_color(color).child(text);
  }

  statusColor(t, s) {
    return s === "done" ? t.done : s === "running" ? t.working : s === "failed" || s === "blocked" ? t.blocked : s === "waiting" ? t.accent : t.input;
  }

  header(t, cx) {
    const st = this.st;
    const row = h_flex().h(HEADER_H).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).child(div().font_semibold().child("Forge"));
    if (!st) return row.child(div().flex_1()).child(this.button(t, "f-refresh", "Refresh", (cx) => this.refresh(cx)));
    const phaseColor = st.phase === "gate" ? t.accent : st.phase === "done" ? t.done : t.working;
    return row
      .children(this.runs.length > 1
        ? this.runs.slice(0, 4).map((r) => div().id(`f-run-${r.ticket}`).px(7).py(1).rounded(6).text_size(11).cursor_pointer()
          .bg(r.dir === this.dir ? t.selected : t.raised).text_color(r.dir === this.dir ? t.foreground : t.muted)
          .on_click((_e, cx) => { this.pinned = r.dir; this.refresh(cx); }).child(r.ticket))
        : [div().text_size(12).text_color(t.muted).child(st.ticket)])
      .child(div().text_size(12).text_color(t.dim).child(`cycle ${st.cycle}`))
      .child(this.pill(t, st.paused ? `${st.phase} · paused` : st.phase, st.paused ? t.blocked : phaseColor))
      .child(div().text_size(12).text_color(t.dim).child(`${st.running}/${st.cap} running`))
      .when(Boolean(st.blocked?.length), (e) => e.child(div().text_size(12).text_color(t.blocked).tooltip("Stopped after too many failures: click the node, then Retry or Skip")
        .child(`◆ ${st.blocked.length} blocked: needs you`)))
      .when(st.queue.length > 0, (e) => e.child(div().text_size(12).text_color(t.dim).child(`${st.queue.length} queued`)))
      .child(div().flex_1())
      .when(Boolean(this.busy), (e) => e.child(div().text_size(12).text_color(t.working).child(`${this.busy}…`)))
      .child(this.button(t, "f-pause", st.paused ? "Resume" : "Pause", (cx) => this.act(cx, st.paused ? "resumed" : "paused", ["append", st.paused ? "resume" : "pause"]), { enabled: st.phase !== "done" }))

  }

  // Why the current cycle exists, for every cycle after the first: a counterexample, a follow-up, a gate comment.
  cycleText() {
    const st = this.st;
    if (!st || st.cycle <= 1) return null;
    const o = st.cycleOpen ?? {};
    const src = { gate: "gate comment", qa: "QA follow-up", pr: "PR follow-up", user: "follow-up" };
    if (String(o.slug ?? "").startsWith("cex")) return `fixing a TLA+ counterexample from cycle ${st.cycle - 1}: ${o.reason ?? ""}`;
    if (o.followup) return `${src[o.followup.source] ?? "follow-up"}: ${o.followup.text}`;
    return o.reason || `started at ${o.start ?? "?"}`;
  }

  // One row under the header: why this cycle exists on the left (a click shows all of it), and on the right
  // a dropdown that picks the view (the run graph, the gate, each spec graph, the spec).
  viewRow(t) {
    const text = this.cycleText();
    const open = this.cycleOpen && Boolean(text);
    const items = this.viewItems();
    const cur = items.find(([k]) => k === this.tab) ?? items[0];
    const gateWaiting = this.st.phase === "gate" && this.tab !== "gate";
    const left = h_flex().id("f-cycle-line").flex_1().min_w(0).gap(6).items_start()
      .when(Boolean(text), (e) => e.cursor_pointer().on_click((_e, cx) => { this.cycleOpen = !this.cycleOpen; cx.notify(); }))
      .child(div().flex_none().text_color(t.dim).child(text ? (open ? "▾" : "▸") : " "))
      .child(div().flex_none().font_semibold().text_color(t.accent).child(`Cycle ${this.st.cycle}`))
      .when(Boolean(text), (e) => e.child(open
        ? div().id("f-cycle-full").flex_1().min_w(0).max_h(160).overflow_y_scrollbar().text_color(t.foreground).child(text)
        : div().flex_1().min_w(0).truncate().text_color(t.muted).child(text)));
    const trigger = h_flex().id("f-view-btn").h(24).max_w(300).px(9).gap(6).items_center().rounded(6).border_1().border_color(t.input).bg(t.raised)
      .cursor_pointer().hover((x) => x.bg(t.hover)).tooltip(cur[2] ?? cur[1])
      .when(gateWaiting, (e) => e.child(div().w(7).h(7).flex_none().rounded_full().bg(t.blocked)))
      .child(div().min_w(0).truncate().text_color(t.foreground).child(cur[1]))
      .child(div().flex_none().text_color(t.dim).child("▾"));
    const menu = v_flex().id("f-view-menu").w(340).max_h(360).overflow_y_scrollbar().p(4).gap(2).rounded(8).bg(t.popover).border_1().border_color(t.border).shadow_md()
      .children(items.map(([k, label, full]) => div().id(`f-view-${k}`).h(26).px(8).flex().items_center().rounded(5).text_size(12).truncate().cursor_pointer()
        .bg(this.tab === k ? t.selected : t.popover).text_color(this.tab === k ? t.foreground : t.muted).hover((x) => x.bg(t.hover).text_color(t.foreground))
        .tooltip(full ?? label)
        .on_click((_e, cx) => { this.tab = k; this.selected = null; this.viewOpen = false; cx.notify(); })
        .child(k === "gate" ? `● ${label}` : label)));
    // With more than one cycle, the Run view shows them all as one graph; this switch shows the current one only.
    const many = this.tab === "run" && (this.hist?.length ?? 0) > 1;
    const scope = div().id("f-scope").h(24).flex_none().px(9).flex().items_center().rounded(6).border_1().border_color(t.input)
      .bg(this.onlyCurrent ? t.raised : t.selected).text_color(t.foreground).cursor_pointer().hover((x) => x.bg(t.hover))
      .tooltip(this.onlyCurrent ? "Show every cycle as one graph" : "Show only the current cycle")
      .on_click((_e, cx) => { this.onlyCurrent = !this.onlyCurrent; cx.notify(); })
      .child(this.onlyCurrent ? `Cycle ${this.st.cycle} only` : `All ${this.hist?.length ?? 0} cycles`);
    return h_flex().flex_none().px(12).py(5).gap(10).items_start().border_b(1).border_color(t.border).bg(t.surface).text_size(11.5)
      .child(left)
      .when(many, (e) => e.child(scope))
      .child(Popover.new("f-view").anchor("top_right").open(Boolean(this.viewOpen))
        .on_open_change((o, cx) => { this.viewOpen = o; cx.notify(); })
        .trigger(trigger).content(menu));
  }

  graphs() {
    return tsBlocks(this.specText);
  }

  viewItems() {
    const items = [["run", "Run"], ...(this.st.phase === "gate" ? [["gate", "Gate"]] : []), ...this.graphs().map((b, i) => [`g${i}`, b.title, b.full]), ...(this.specText ? [["spec", "Spec"]] : [])];
    if (!items.some(([k]) => k === this.tab)) this.tab = "run";
    return items;
  }

  body(t, cx) {
    if (!this.repo) return this.note(t, this.repoError ? `Not a git repo: ${this.repoError}` : this.error ? `Error: ${this.error}` : this.loading ? "Loading…" : this.runJsonState === "unreadable" ? `Cannot read ${this.pinned}/run.json` : "Focus a terminal in a git repo.");
    if (!this.st) return this.error ? this.note(t, this.error) : this.startForm(t);
    if (this.tab === "gate") return this.gateView(t);
    if (this.tab === "spec") return div().id("f-spec").size_full().overflow_y_scrollbar().p(14).child(TextView.markdown("f-spec-md", this.specText));
    if (this.tab.startsWith("g")) {
      const b = this.graphs()[Number(this.tab.slice(1))];
      return b ? this.canvas(t, parseTsGraph(b.code), `spec:${this.tab}:${b.code.length}`) : this.note(t, "No graph.");
    }
    return this.canvas(t, historyGraph(this.st, this.hist, { onlyCurrent: this.onlyCurrent }), "run");
  }

  note(t, text) {
    return div().size_full().flex().items_center().justify_center().p(20).text_color(t.dim).child(text);
  }

  startForm(t) {
    return v_flex().size_full().items_center().justify_center().p(20).child(v_flex().w(480).gap(10).p(16).rounded(10).bg(t.surface).border_1().border_color(t.border)
      .child(div().font_semibold().child("Start a forge run"))
      .child(div().text_size(12).text_color(t.muted).child(`Repo: ${this.repo.top}`))
      .child(div().h(30).px(8).flex().items_center().rounded(6).border_1().border_color(t.input).child(Input.new(this.ticketIn).h_full().text_size(12)))
      .child(div().rounded(6).border_1().border_color(t.input).child(Textarea.new(this.goalIn).text_size(12)))
      .child(h_flex().justify_between().items_center()
        .child(div().text_size(11).text_color(t.dim).child("Agents grill it, TLA+ checks it, then you approve."))
        .child(this.button(t, "f-start", "Start", (cx) => this.start(cx), { primary: true }))));
  }

  gateView(t) {
    const decisions = agentDecisions(this.specText);
    return h_flex().size_full().min_h(0)
      .child(div().id("f-gate-spec").flex_1().h_full().min_w(0).overflow_y_scrollbar().p(14).border_r(1).border_color(t.border).child(TextView.markdown("f-gate-md", this.specText)))
      .child(v_flex().id("f-gate-side").w(320).flex_none().h_full().overflow_y_scrollbar().p(12).gap(10)
        .child(div().font_semibold().child("Decisions the agents made for you"))
        .children(decisions.length ? decisions.map((d, i) => v_flex().id(`f-dec-${i}`).gap(4).p(8).rounded(8).bg(t.surface).border_1().border_color(t.border)
          .child(div().text_size(12).child(d.text))
          .when(Boolean(d.id), (e) => e.child(h_flex().justify_end().child(div().id(`f-ovr-${i}`).text_size(11).text_color(t.accent).cursor_pointer()
            .on_click((_e, cx) => { this.comment.set_value(`${d.id}: `); this.comment.focus(); cx.notify(); }).child("Override…")))))
          : [div().text_size(12).text_color(t.dim).child("None listed.")])
        .child(div().rounded(6).border_1().border_color(t.input).child(Textarea.new(this.comment).text_size(12)))
        .child(h_flex().gap(8).justify_end()
          .child(this.button(t, "f-comment", "Send comment", (cx) => this.sendComment(cx)))
          .child(this.button(t, "f-approve", "Approve", (cx) => this.act(cx, "approved, exec started", ["approve"]), { primary: true }))));
  }

  detailView(t) {
    const d = this.detail;
    return v_flex().h(220).flex_none().border_t(1).border_color(t.border)
      .child(h_flex().h(30).flex_none().px(12).gap(8).items_center().bg(t.surface)
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(d.blocked ? t.blocked : t.foreground).child(d.title))
        // A blocked node waits for the user: try again (fresh count) or skip it (counts as done).
        .when(Boolean(d.blocked), (e) => e
          .child(this.button(t, "f-node-retry", "Retry", (cx) => this.decide(cx, d.node, "retry"), { primary: true }))
          .child(this.button(t, "f-node-skip", "Skip", (cx) => this.decide(cx, d.node, "skip"))))
        .child(div().id("f-detail-close").text_size(12).text_color(t.muted).cursor_pointer().on_click((_e, cx) => { this.detail = null; cx.notify(); }).child("Close")))
      .child(div().id("f-detail").flex_1().min_h(0).overflow_y_scrollbar().p(12).child(TextView.markdown("f-detail-md", this.detail.text)));
  }

  footer(t, cx) {
    const st = this.st;
    const row = h_flex().h(44).flex_none().px(10).gap(8).items_center().border_t(1).border_color(t.border);
    if (!st) return row.child(div().text_size(11).text_color(t.dim).child(this.repo ? "No forge run in this repo yet." : ""));
    return row
      .child(div().flex_1().h(30).px(8).flex().items_center().rounded(6).border_1().border_color(t.input).child(Input.new(this.followup).h_full().text_size(12)))
      .child(this.button(t, "f-followup", "Send", (cx) => this.sendFollowup(cx)));
    // Push and Create PR live in the Pull request panel only (it knows what is pushed and what has a PR).
  }

  // The graph: Blueprint's layout, boxes as divs, edges as one stroke path and one arrow path.
  canvas(t, g, key) {
    const W = this.size.width, H = this.size.height;
    if (!g.nodes.size) return this.note(t, "Nothing to draw yet.");
    // Always left to right: each step's nodes stack in one vertical column, whatever the pane's shape.
    const dir = "LR";
    const sig = `${key}|${dir}|${[...g.nodes.values()].map((n) => `${n.id}:${n.label}:${n.sub}`).join(",")}|${g.edges.map((e) => `${e.from}>${e.to}`).join(",")}`;
    let L = this.layouts.get(key);
    if (!L || L.sig !== sig) {
      L = { sig, ...layout(g, dir, (n) => boxSize(n), (e) => (e.label ? arcLabelSize(e.label) : { w: 0, h: 0 })) };
      this.layouts.set(key, L);
    }
    const b = L.bounds, pad = 24;
    const bw = b.maxX - b.minX || 1, bh = b.maxY - b.minY || 1;
    const fit = () => {
      const z = Math.max(0.2, Math.min(1.2, (W - 2 * pad) / bw, (H - 2 * pad) / bh));
      return { z, ox: (W - bw * z) / 2 - b.minX * z, oy: Math.max(pad, (H - bh * z) / 2) - b.minY * z };
    };
    const v = this.views[key] ?? fit();
    this.cur = { key, v, fit };
    const { z, ox, oy } = v;
    const X = (x) => x * z + ox, Y = (y) => y * z + oy;

    let lines = PathBuilder.stroke(1.25), arrows = PathBuilder.fill();
    const head = Math.max(4, 7 * Math.sqrt(z)), tips = new Set();
    // Back-arcs (a later cycle looping back to its cause) get their own colour, thicker, with a label.
    const arcs = new Map();
    for (const ed of L.edges) {
      if (ed.e.arc) {
        if (!arcs.has(ed.e.arc)) arcs.set(ed.e.arc, { lines: PathBuilder.stroke(2), arrows: PathBuilder.fill(), eds: [] });
        const a = arcs.get(ed.e.arc);
        a.eds.push(ed);
        const segs = ed.segs, last = segs[segs.length - 1][3], d = ed.dir;
        const end = { x: X(last.x), y: Y(last.y) }, stop = { x: end.x - d.x * head * 0.8, y: end.y - d.y * head * 0.8 };
        a.lines = a.lines.move_to(X(segs[0][0].x), Y(segs[0][0].y));
        segs.forEach(([, c1, c2, p], i) => {
          const to = i === segs.length - 1 ? stop : { x: X(p.x), y: Y(p.y) };
          a.lines = a.lines.cubic_bezier_to(to.x, to.y, X(c1.x), Y(c1.y), X(c2.x), Y(c2.y));
        });
        const side = { x: -d.y, y: d.x }, w = head * 0.55;
        a.arrows = a.arrows.add_polygon([[end.x, end.y], [end.x - d.x * head + side.x * w, end.y - d.y * head + side.y * w], [end.x - d.x * head - side.x * w, end.y - d.y * head - side.y * w]], true);
        continue;
      }
      const segs = ed.segs, last = segs[segs.length - 1][3], d = ed.dir;
      const end = { x: X(last.x), y: Y(last.y) };
      const stop = { x: end.x - d.x * head * 0.8, y: end.y - d.y * head * 0.8 };
      lines = lines.move_to(X(segs[0][0].x), Y(segs[0][0].y));
      segs.forEach(([, c1, c2, p], i) => {
        const to = i === segs.length - 1 ? stop : { x: X(p.x), y: Y(p.y) };
        lines = lines.cubic_bezier_to(to.x, to.y, X(c1.x), Y(c1.y), X(c2.x), Y(c2.y));
      });
      const tip = `${Math.round(end.x)}:${Math.round(end.y)}`;
      if (!tips.has(tip)) {
        tips.add(tip);
        const side = { x: -d.y, y: d.x }, w = head * 0.55;
        arrows = arrows.add_polygon([[end.x, end.y], [end.x - d.x * head + side.x * w, end.y - d.y * head + side.y * w], [end.x - d.x * head - side.x * w, end.y - d.y * head - side.y * w]], true);
      }
    }
    const layer = (path, color) => div().absolute().left(0).top(0).w(W).h(H).child(window.paint_path(path.build(), color));
    const els = [layer(lines, alpha(t.muted, 0.75)), layer(arrows, alpha(t.muted, 0.9))];
    const arcColor = (k) => (k === "cex" ? t.blocked : k === "gate" ? t.accent : k === "followup" ? t.working : t.muted);
    for (const [k, a] of arcs) els.push(layer(a.lines, alpha(arcColor(k), 0.85)), layer(a.arrows, arcColor(k)));

    for (const item of L.nodes) {
      const n = g.nodes.get(item.node.id) ?? item.node;
      const w = item.w * z, h = item.h * z, left = X(item.x) - w / 2, top = Y(item.y) - h / 2;
      // An older cycle's node is dimmed: it is history, the current cycle is what runs.
      const color = n.status ? alpha(this.statusColor(t, n.status), n.old ? 0.5 : 1) : t.input;
      const picked = this.selected === n.id;
      const mark = n.status === "done" ? "✓ " : n.status === "failed" ? "✕ " : n.status === "running" ? "● " : n.status === "waiting" || n.status === "blocked" ? "◆ " : "";
      els.push(v_flex().id(`f-n-${key}-${n.id}`).absolute().left(left).top(top).w(w).h(h).justify_center().px(8 * z).rounded(8 * z)
        .bg(n.kind === "phase" ? t.surface : t.background).border(picked ? 2 : n.status === "running" || n.status === "waiting" ? 2 : 1)
        .border_color(picked ? t.accent : color).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { if (this.dragged) return; this.selected = n.id; if (n.node) this.open(n, cx); else if (n.details.length || n.path) this.detail = { title: n.label, text: [n.sub, ...n.details].filter(Boolean).join("\n\n") }; cx.notify(); })
        .child(h_flex().min_w(0).text_size(12.5 * z).font_semibold()
          .when(Boolean(mark), (e) => e.child(div().flex_none().text_color(color).child(mark)))
          .child(div().min_w(0).truncate().text_color(n.old ? t.dim : n.status === "pending" ? t.muted : t.foreground).child(n.label)))
        .when(Boolean(n.sub), (e) => e.child(div().text_size(10.5 * z).truncate().text_color(n.old ? t.dim : t.muted).child(n.sub))));
    }
    // Each back-arc's label: why that cycle opened. A click shows the whole reason.
    for (const [k, a] of arcs) {
      for (const ed of a.eds) {
        if (!ed.label) continue;
        const sz = arcLabelSize(ed.e.label), w = sz.w * z, h = sz.h * z;
        els.push(div().id(`f-arc-${key}-${ed.e.cycle}`).absolute().left(X(ed.label.x) - w / 2).top(Y(ed.label.y) - h / 2).w(w).h(h)
          .flex().items_center().justify_center().rounded(h / 2).bg(t.popover).border_1().border_color(arcColor(k))
          .text_size(10.5 * z).text_color(arcColor(k)).cursor_pointer().hover((x) => x.bg(t.hover)).tooltip(ed.e.reason || ed.e.label)
          .on_click((_e, cx) => { if (this.dragged) return; this.detail = { title: ed.e.label, text: ed.e.reason || "No reason recorded." }; cx.notify(); })
          .child(ed.e.label));
      }
    }
    const ctl = (id, label, f, tip) => div().id(id).h(24).min_w(24).px(6).flex().items_center().justify_center().rounded(5).text_size(12).cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { f(); cx.notify(); }).child(label);
    els.push(h_flex().absolute().right(10).bottom(10).gap(2).p(3).rounded(7).bg(t.popover).border_1().border_color(t.border)
      .child(ctl("f-zoom-out", "−", () => this.zoomBy(0.8), "Zoom out (⌘/Ctrl + scroll)"))
      .child(ctl("f-zoom-fit", `${Math.round(z * 100)}%`, () => delete this.views[key], "Fit the graph to the pane"))
      .child(ctl("f-zoom-in", "+", () => this.zoomBy(1.25), "Zoom in (⌘/Ctrl + scroll)")));
    return div().id(`f-canvas-${key}`).size_full().relative().overflow_hidden().bg(t.canvas)
      .on_scroll_wheel((e, cx) => {
        const p = this.pointer(e);
        // Same directions as Blueprint's canvas.
        if (e.modifiers?.control || e.modifiers?.platform) this.zoomBy(Math.exp(e.delta.y * 0.003), p);
        else this.pan(e.delta.x / this.zoom, e.delta.y / this.zoom);
        cx.notify();
      })
      .on_mouse_down("left", (e) => {
        this.dragged = false;
        this.drag = { x: e.position.x, y: e.position.y, v: { ...this.cur.v } };
      })
      .on_mouse_move((e, cx) => {
        const d = this.drag;
        if (!d) return;
        const dx = (e.position.x - d.x) / this.zoom, dy = (e.position.y - d.y) / this.zoom;
        if (!this.dragged && Math.hypot(dx, dy) < 3) return;
        this.dragged = true;
        this.views[this.cur.key] = { ...d.v, ox: d.v.ox + dx, oy: d.v.oy + dy };
        cx.notify();
      })
      .on_mouse_up("left", () => { this.drag = null; })
      .on_hover((h) => { if (!h) this.drag = null; })
      .children(els);
  }

  // A point in the canvas, in layout px (pointer positions arrive in real px).
  pointer(e) {
    const r = e.local_position ?? (e.bounds ? { x: e.position.x - e.bounds.x, y: e.position.y - e.bounds.y } : null);
    return r ? { x: r.x / this.zoom, y: r.y / this.zoom } : { x: this.size.width / 2, y: this.size.height / 2 };
  }

  // Zoom around a point (default: the middle), keeping that point still. 20% to 300%.
  zoomBy(factor, at = { x: this.size.width / 2, y: this.size.height / 2 }) {
    if (!this.cur) return;
    const v = this.views[this.cur.key] ?? this.cur.v;
    const z = Math.max(0.2, Math.min(3, v.z * factor));
    const wx = (at.x - v.ox) / v.z, wy = (at.y - v.oy) / v.z;
    this.views[this.cur.key] = { z, ox: at.x - wx * z, oy: at.y - wy * z };
  }

  pan(dx, dy) {
    if (!this.cur) return;
    const v = this.views[this.cur.key] ?? this.cur.v;
    this.views[this.cur.key] = { ...v, ox: v.ox + dx, oy: v.oy + dy };
  }
}
