// forge-start: the dialog behind a space's "+". It reads the space folder's repo and its .forge runs:
// open a run, send it a follow-up, or start a new run in this folder (forge init --here).
// Opened as: openOverlay({ mod: "forge-start", kind: "dialog", props: { space, folder } }).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, closeOverlay, theme, exec, home, writeTextFile, notify, run, spaces, panes, setShared } from "herdr";

const forgeBin = () => `${home()}/.local/bin/forge`;
const forge = async (args, cwd) => {
  const r = await exec(forgeBin(), args, { cwd, timeout: 120_000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  return { ok: r.code === 0, out: r.stdout, err: (r.stderr || r.stdout || "").trim() };
};

// Show one forge run: the forge graph on the right and the PR view below it, in the run's space.
// Panes already in that tab follow the shared selection instead of opening again.
function showRun(space, dir) {
  setShared("forge.selected", { dir, at: Date.now() });
  if (space) run("space.select", { id: space.id });
  const tab = space?.tabs?.find((x) => x.active)?.id;
  const inTab = panes().filter((p) => p.tab === tab);
  if (!inTab.some((p) => p.mod === "forge")) run("pane.split", { direction: "right", mod: "forge", props: { run: dir } });
  if (!inTab.some((p) => p.mod === "prs")) run("pane.split", { direction: "down", mod: "prs", props: { run: dir } });
}

export default class ForgeStart extends View {
  init(_props, cx) {
    const p = props() ?? {};
    Object.assign(this, { space: p.space ?? null, folder: p.folder ?? null, overlay: p.overlay, repo: null, runs: [], error: null, busy: null, following: null });
    this.follow = TextareaState.new({ placeholder: "Follow-up: a QA bug, a change, or a review note", rows: 3 });
    this.ticket = InputState.new({ placeholder: "Ticket, like INTR-123 (empty: none)" });
    this.goal = TextareaState.new({ placeholder: "What to build: the goal, the rules, the files", rows: 5 });
    cx.spawn(async (cx) => {
      try {
        if (!this.folder) throw new Error("This space has no folder.");
        const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: this.folder });
        if (common.code !== 0) throw new Error(`Not a git repo: ${this.folder}`);
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: this.folder });
        this.repo = { main: common.stdout.trim().replace(/\/\.git\/?$/, ""), top: top.stdout.trim() };
        const r = await forge(["runs"], this.repo.main);
        if (!r.ok) throw new Error(r.err);
        this.runs = JSON.parse(r.out).filter((x) => x.main === this.repo.main);
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  close() {
    closeOverlay(this.overlay);
  }

  // The run's own space when one shows its worktree, else this space.
  openPanel(dir, worktree) {
    showRun(spaces().find((s) => s.folder === worktree) ?? spaces().find((s) => s.id === this.space), dir);
  }

  task(cx, label, work) {
    if (this.busy) return;
    this.busy = label;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const msg = await work();
        notify({ title: `Forge: ${label}`, body: msg, level: "success" });
        this.close();
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.busy = null;
      cx.notify();
    });
  }

  sendFollow(cx, r) {
    const text = this.follow.value().trim();
    if (!text) return;
    this.task(cx, "follow-up", async () => {
      const res = await forge(["followup", text, "--source", "user", "--run", r.dir], r.main);
      if (!res.ok) throw new Error(res.err);
      return `Sent to ${r.ticket}.`;
    });
  }

  start(cx) {
    const goal = this.goal.value().trim();
    if (!goal || !this.repo) return;
    const ticket = this.ticket.value().trim();
    this.task(cx, "new run", async () => {
      const inbox = `${this.repo.main}/.forge/inbox`;
      const file = `${inbox}/${Date.now()}.md`;
      await exec("mkdir", ["-p", inbox]);
      await writeTextFile(file, `---\nticket: ${ticket || "none"}\n---\n${goal}\n`, null);
      const init = await forge(["init", file, "--here"], this.repo.top);
      if (!init.ok) throw new Error(init.err);
      const st = JSON.parse(init.out);
      const coord = await forge(["coord", "--run", st.run], this.repo.main);
      if (!coord.ok) throw new Error(coord.err);
      this.openPanel(st.run, st.worktree);
      return `${st.ticket}: the grill coordinator is running.`;
    });
  }

  render(cx) {
    const t = theme();
    const name = this.repo ? this.repo.top.split("/").pop() : this.folder?.split("/").pop() ?? "";
    const field = (child) => div().rounded(6).border_1().border_color(t.input).bg(t.background).child(child);
    const button = (id, label, f, primary = false) => div().id(id).h(28).px(12).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).hover((s) => s.bg(primary ? t.solid : t.hover))
      .when(!this.busy, (e) => e.on_click((_e, cx) => f(cx))).child(label);
    const phase = (r) => {
      const h = r.head ?? {};
      return h.phase === "gate" ? ["◆ waiting for you", t.accent] : h.phase === "done" ? ["✓ done", t.done] : [`● ${h.phase ?? "?"}`, t.working];
    };
    return v_flex().id("forge-start").size_full().min_h(0).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(h_flex().h(44).flex_none().px(16).items_center().justify_between().border_b(1).border_color(t.border)
        .child(div().font_semibold().child(`Forge · ${name}`))
        .child(div().id("fs-close").text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(() => this.close()).child("×")))
      .child(v_flex().id("fs-body").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(10)
        .when(Boolean(this.error), (e) => e.child(div().text_size(12).text_color(t.blocked).child(this.error)))
        .when(Boolean(this.busy), (e) => e.child(div().text_size(12).text_color(t.working).child(`${this.busy}…`)))
        .child(div().text_size(11.5).text_color(t.dim).child(`Runs in this repo ${this.runs.length}`))
        .children(this.runs.map((r, i) => {
          const [label, color] = phase(r);
          const open = this.following === r.dir;
          return v_flex().id(`fs-run-${i}`).gap(6).p(10).rounded(8).bg(t.surface).border_1().border_color(open ? t.accent : t.border)
            .child(h_flex().gap(8).items_center()
              .child(v_flex().flex_1().min_w(0)
                .child(div().font_semibold().truncate().child(r.title || r.ticket))
                .child(div().text_size(11.5).text_color(t.dim).truncate().child(`${r.ticket} · cycle ${r.head?.cycle ?? "?"} · ${r.branch ?? "?"}`)))
              .child(div().flex_none().text_size(11.5).text_color(color).child(label)))
            .child(h_flex().gap(8).justify_end()
              .child(button(`fs-open-${i}`, "Open", () => { this.openPanel(r.dir, r.worktree); this.close(); }))
              .child(button(`fs-follow-${i}`, open ? "Cancel" : "Follow up", (cx) => { this.following = open ? null : r.dir; this.follow.set_value(""); cx.notify(); })))
            .when(open, (e) => e.child(field(Textarea.new(this.follow).text_size(12)))
              .child(h_flex().justify_end().child(button(`fs-send-${i}`, "Send follow-up", (cx) => this.sendFollow(cx, r), true))));
        }))
        .when(!this.runs.length && !this.error, (e) => e.child(div().text_size(12).text_color(t.dim).child("No forge run in this repo yet.")))
        .child(div().pt(8).text_size(11.5).text_color(t.dim).child(`New run in ${this.repo?.top ?? this.folder ?? ""}`))
        .child(field(div().h(30).px(8).flex().items_center().child(Input.new(this.ticket).h_full().text_size(12))))
        .child(field(Textarea.new(this.goal).text_size(12)))
        .child(h_flex().justify_between().items_center()
          .child(div().text_size(11).text_color(t.dim).child("Agents grill it, TLA+ checks it, then you approve."))
          .child(button("fs-start", "Start", (cx) => this.start(cx), true))));
  }
}
