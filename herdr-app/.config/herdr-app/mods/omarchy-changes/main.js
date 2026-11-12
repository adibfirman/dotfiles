import { View, div, image, svg } from "gpui-kit";
import { fileAppearance, gitStatus, statusColor } from "./appearance.js";
import GitGraph from "./graph/main.js";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, props, run, shared, setShared } from "herdr";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: line.slice(1) || " " };
    if (kind === "+") return { kind, number: next++, text: line.slice(1) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: line.slice(1) || " " }; }
    return { kind: "", text: line };
  });
}

export default class Changes extends View {
  init(_props, cx) {
    // One mod, two views: props {view: "graph"} is the commit graph (graph/), and the
    // graph's menus and dialogs come back here with props.role.
    if (props()?.view === "graph" || props()?.role) { this.graph = new GitGraph(); this.graph.init(_props, cx); return; }
    this.files = []; this.rows = []; this.diffWidth = 0; this.message = ""; this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.branchInput = InputState.new({ placeholder: "New branch name" });
    // The file list's height, dragged by the edge above the diff; null fits the files.
    this.listH = shared("omarchy-changes.list") ?? null;
    this.branchInput.on("submit", (_e, cx) => this.createBranch(cx));
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.open = null; this.sync = null;
      this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.closed = false; this.limited = false; this.branches = null;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.sync = null; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        const [branch, counts, stashes] = await Promise.all([
          git(["symbolic-ref", "--short", "-q", "HEAD"]),
          git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
          git(["stash", "list"]),
        ]);
        const [behind, ahead] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
        const sync = { branch: branch.code === 0 ? branch.stdout.trim() : "detached HEAD", upstream: counts.code === 0, behind, ahead, stashes: stashes.stdout.split("\n").filter(Boolean).length };
        const files = [];
        const entries = status.stdout.split("\0").filter(Boolean);
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const s = gitStatus(xy);
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh, ...stat });
        }
        if (key() !== context) return;
        this.root = root; this.on = on; this.hasHead = head.code === 0; this.files = files; this.sync = sync; this.limited = entries.length > 1000; this.error = null;
        this.watch(root, cx);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
        // The first file's diff shows until you pick another.
        if (!this.open && !this.closed && files.length) this.open = files[0].path;
        if (this.open) {
          try { await this.load(this.open, context); }
          catch { if (key() === context) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
        }
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines;
    if (file.fresh || (!this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map(l => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "diff", ...(this.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.open === path) this.setLines(lines.slice(0, 1500).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...lines.map(line => line.length * 7 + 50));
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (key() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  commit(cx) {
    if (!this.message.trim()) return;
    const message = this.message.trim();
    this.git(cx, "Commit", [["add", "-A"], ["commit", "-m", message]], () => { this.message = ""; this.input.set_value(""); });
  }

  // Runs git commands in order for one button; the first failure stops the rest and shows in the note.
  git(cx, name, steps, done) {
    if (!this.root || this.busy || this.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context;
    this.busy = name; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of steps) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) done?.();
      } catch (e) { if (key() === context) this.note = `${name} failed: ${e.message ?? e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  push(cx) {
    const s = this.sync;
    this.git(cx, "Push", [s?.upstream ? ["push"] : ["push", "-u", "origin", "HEAD"]]);
  }

  // Local branches, then remote-only ones by short name (`git switch` creates the tracking branch).
  toggleBranches(cx) {
    if (this.branches) { this.branches = null; this.naming = false; cx.notify(); return; }
    if (!this.root) return;
    const root = this.root, on = this.on, context = this.context;
    this.branches = [];
    cx.spawn(async (cx) => {
      const r = await exec("git", [...READ, "for-each-ref", "--sort=-committerdate", "--format=%(refname)", "refs/heads", "refs/remotes"], { cwd: root, on });
      if (key() !== context || !this.branches) return;
      const names = [];
      for (const ref of r.stdout.split("\n").filter(Boolean)) {
        const name = ref.startsWith("refs/heads/") ? ref.slice(11) : ref.split("/").slice(3).join("/");
        if (name && name !== "HEAD" && !names.includes(name)) names.push(name);
      }
      this.branches = names.length ? names : null;
      if (r.code !== 0) this.note = `Branches failed: ${r.stderr.trim()}`;
      cx.notify();
    });
    cx.notify();
  }

  // Branches from HEAD and switches to it; uncommitted changes come along.
  createBranch(cx) {
    const name = this.branchInput.value().trim();
    if (!name) return;
    if (/\s/.test(name) || name.startsWith("-")) { this.note = "Branch name can't have spaces or start with -"; cx.notify(); return; }
    this.branches = null; this.naming = false;
    this.git(cx, "Branch", [["switch", "-c", name]], () => this.branchInput.set_value(""));
  }

  switchTo(name, cx) {
    this.branches = null;
    this.git(cx, "Switch", [["switch", name]], () => { this.open = null; this.closed = false; this.setLines([]); });
  }

  branchList(t) {
    const current = this.sync?.branch;
    return v_flex().id("branch-list").flex_none().max_h(220).overflow_y_scrollbar().py(4).border_b(1).border_color(t.border).bg(t.chrome)
      .child(this.naming
        ? h_flex().h(30).flex_none().px(10).gap(6).items_center()
          .child(div().id("new-branch-name").flex_1().min_w(0).h(24).px(8).flex().items_center().border_1().border_color(t.accent).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .child(Input.new(this.branchInput).h_full().text_size(12).text_color(t.foreground)))
          .child(div().id("new-branch-create").h(24).px(10).flex().items_center().bg(t.accent).text_color(t.background).text_size(12).cursor_pointer().on_click((_e, cx) => this.createBranch(cx)).child("Create"))
        : h_flex().id("new-branch").h(26).flex_none().px(12).gap(8).items_center().text_size(12).text_color(t.accent).cursor_pointer()
          .hover((s) => s.bg(t.foreground + "14")).on_click((_e, cx) => { this.naming = true; this.branchInput.focus(); cx.notify(); })
          .child(div().w(10).flex_none().child("+")).child("New branch…"))
      .when(!this.branches.length, (e) => e.child(div().px(12).py(4).text_size(12).text_color(t.dim).child("Loading branches…")))
      .children(this.branches.map((name) => h_flex().id(`branch-${name}`).h(26).flex_none().px(12).gap(8).items_center().text_size(12)
        .text_color(name === current ? t.accent : t.foreground)
        .when(name !== current && !this.busy && !this.loading, (e) => e.cursor_pointer().hover((s) => s.bg(t.foreground + "14")).on_click((_e, cx) => this.switchTo(name, cx)))
        .child(div().w(10).flex_none().child(name === current ? "•" : ""))
        .child(div().flex_1().min_w(0).truncate().child(name))));
  }

  syncButton(t, name, icon, tip, onClick, { enabled = true, count = 0, arrow = "", color } = {}) {
    const on = enabled && Boolean(this.root) && !this.busy && !this.loading;
    return h_flex().id(`git-${name}`).h(28).px(7).gap(4).items_center().flex_none().rounded(0).border_1().border_color(t.background)
      .bg(count > 0 ? color + "1f" : t.foreground + "0a")
      .tooltip(tip).accessibility_label(count > 0 ? `${tip}, ${count} ${arrow === "↓" ? "behind" : "ahead"}` : tip)
      .when(on, (e) => e.cursor_pointer().hover((s) => s.bg(t.foreground + "14").border_color(t.foreground + "40")).on_click((_e, cx) => onClick(cx)))
      .when(!on, (e) => e.opacity(0.45))
      .child(svg(`mods/omarchy-changes/${icon}.svg`).size(14).text_color(count > 0 ? color : t.foreground))
      .when(count > 0, (e) => e.child(div().text_size(11).font_semibold().text_color(color).child(`${arrow}${count}`)))
      .when(this.busy === name, (e) => e.child(div().text_size(11).text_color(t.muted).child("…")));
  }

  syncRow(t) {
    const s = this.sync;
    return h_flex().h(40).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .child(h_flex().id("git-branch").flex_1().min_w(0).h(28).gap(6).items_center().cursor_pointer().tooltip("Switch branch")
        .text_color(this.branches ? t.foreground : t.muted).hover((st) => st.text_color(t.foreground))
        .when(!this.busy && !this.loading, (e) => e.on_click((_e, cx) => this.toggleBranches(cx)))
        .child(svg("mods/omarchy-changes/branch.svg").size(14).flex_none().text_color(t.muted))
        .child(div().min_w(0).truncate().text_size(12).child(s ? `${s.branch}${s.upstream ? "" : " · no upstream"}` : ""))
        .child(svg("mods/omarchy-changes/chevron-down.svg").size(12).flex_none().text_color(t.muted)))
      .child(this.syncButton(t, "Fetch", "fetch", "Fetch from remote", (cx) => this.git(cx, "Fetch", [["fetch", "--prune"]])))
      .child(this.syncButton(t, "Pull", "pull", "Pull (fast-forward only)", (cx) => this.git(cx, "Pull", [["pull", "--ff-only"]]), { enabled: Boolean(s?.upstream), count: s?.behind, arrow: "↓", color: t.ansi3 }))
      .child(this.syncButton(t, "Push", "push", s?.upstream ? "Push commits" : "Push and set upstream to origin", (cx) => this.push(cx), { enabled: s?.branch !== "detached HEAD", count: s?.ahead, arrow: "↑", color: t.ansi4 }))
      .child(this.syncButton(t, "Stash", "stash", "Stash all changes", (cx) => this.git(cx, "Stash", [["stash", "push", "-u"]]), { enabled: this.files.length > 0 }))
      .child(this.syncButton(t, "Pop", "unstash", s?.stashes ? `Pop latest stash (${s.stashes} saved)` : "Pop stash (none saved)", (cx) => this.git(cx, "Pop", [["stash", "pop"]]), { enabled: Boolean(s?.stashes) }));
  }

  // Wrapped rows grow to fit their text; unwrapped ones stay one 20px line.
  diffRow({ kind, number, text }, t, wrap) {
    const line = (el) => wrap ? el.min_h(20).whitespace_normal() : el.h(20).truncate();
    if (kind === "@") return line(div().w_full().px(12).flex_none().bg(t.raised).text_color(t.dim)).child(text);
    return h_flex().w_full().when(wrap, (e) => e.min_h(20).items_start()).when(!wrap, (e) => e.h(20)).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(line(div().flex_1().min_w(0)).text_color(kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : t.foreground).child(text));
  }

  // Pointer moves come in window units; element sizes are units times the zoom.
  moveDrag(e, cx) {
    const d = this.drag;
    if (!d) return;
    // Leaves the diff at least 120 of the body's height.
    this.listH = Math.max(44, Math.min((this.bodyH ?? 800) - 120, d.from + (e.position.y - d.y) / (settings().zoom ?? 1)));
    d.moved = true;
    cx.notify();
  }

  endDrag(cx) {
    if (!this.drag) return;
    if (this.drag.moved) setShared("omarchy-changes.list", this.listH);
    this.drag = null;
    cx.notify();
  }

  render(cx) {
    if (this.graph) return this.graph.render(cx);
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    const wrap = shared("omarchy-changes.wrap") === true, graph = props()?.graph;
    const listH = this.listH ?? Math.min(200, Math.max(44, this.files.length * 28 + 12));
    const headButton = (id, label, on, onClick, icon) => h_flex().id(id).h(22).px(7).gap(5).flex_none().items_center().border_1().cursor_pointer().text_size(11)
      .border_color(on ? t.accent : t.border).text_color(on ? t.accent : t.muted).hover((s) => s.text_color(t.foreground)).on_click(onClick)
      .when(Boolean(icon), (e) => e.child(svg(icon).size(12))).child(label);
    return v_flex().id("changes").size_full().min_h(0).rounded(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_mouse_move((e, cx) => this.moveDrag(e, cx))
      .on_mouse_up("left", (_e, cx) => this.endDrag(cx))
      .on_hover((hovered, cx) => { if (!hovered) this.endDrag(cx); })
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      // Graph sits where the graph's back button does, so the two toggle in place.
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(graph), (e) => e.child(headButton("changes-graph", "Graph", false, () => run("layout.select", { stack: "changes", child: graph }), "mods/omarchy-changes/graph.svg")))
        .child(headButton("changes-wrap", "Wrap", wrap, () => setShared("omarchy-changes.wrap", !wrap)))
        .child(div().text_size(11).text_color(t.muted).child("CHANGES"))
        .child(div().px(5).py(1).rounded(0).text_size(10).text_color(t.muted).child(`${this.files.length} files`))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
      .when(Boolean(this.root), (e) => e.child(this.syncRow(t)))
      .when(Boolean(this.root && this.branches), (e) => e.child(this.branchList(t)))
      .child(v_flex().id("changes-body").flex_1().min_h(0).p(8).on_size_change((size) => { this.bodyH = size.height / (settings().zoom ?? 1); })
        .child(v_flex().id("changes-list").flex_none().h(listH).overflow_y_scrollbar().p(6).rounded(0).bg(t.chrome).children(this.files.map((f) => {
          const parts = f.path.split("/"), name = parts.pop();
          return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(0).cursor_pointer().relative().when(this.open === f.path, (e) => e.bg(t.foreground + "2e")).hover((s) => s.bg(this.open === f.path ? t.foreground + "2e" : t.foreground + "14")).on_click((_e, cx) => this.pick(f.path, cx))
            .when(this.open === f.path, (e) => e.child(div().absolute().left_0().top_0().bottom_0().w(2).bg(t.accent)))
            .child(div().w(14).text_size(11).text_color(statusColor(f.status, t)).child(f.status))
            .child(image(`mods/omarchy-changes/icons/${fileAppearance(name).icon}.svg`).size(16).flex_none())
            .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().text_color(statusColor(f.status, t)).child(name)))
            .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
        })).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || (this.loading ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder")))))
        .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
        // The gap between list and diff is the drag handle; a double-click fits the list to its files again.
        .child(div().id("changes-split").h(8).flex_none().flex().items_center().cursor_row_resize()
          .on_mouse_down("left", (e, cx) => {
            cx.stop_propagation();
            if (e.click_count > 1) { this.listH = null; setShared("omarchy-changes.list", null); cx.notify(); return; }
            this.drag = { y: e.position.y, from: listH };
          })
          .child(div().w_full().h(1).when(Boolean(this.drag), (e) => e.bg(t.accent)))
          .hover((s) => s.bg(t.border)))
        .child(div().id("changes-diff-container").flex_1().min_h(0).relative().rounded(0).overflow_hidden().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
          .when(wrap, (e) => e.child(v_flex().id("changes-diff-wrap").size_full().overflow_y_scrollbar().children(this.rows.map((row) => this.diffRow(row, t, true)))))
          .when(!wrap, (e) => e.child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
            .child(div().w_full().min_w(this.diffWidth).h_full().child(this.rows.length ? v_virtual_list("changes-diff", this.rows.length, 20, (i) => String(i),
              (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t, false))).size_full() : div())))
            .when(this.rows.length > 0, el => el.child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())))
          .when(!this.open && this.files.length > 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child("Select a file to view its changes"))))
      )
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
      .child(h_flex().flex_none().p(10).gap(8)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(0).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(0).bg(enabled ? t.accent : t.foreground + "0a").text_color(enabled ? t.background : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy === "Commit" ? "Committing…" : "Commit")));
  }
}
