// forge-window: the parts of a forge run window.
//   part "bar":   the title bar: run title, the Coordinator | Chat switch for the left side, close.
//   part "agent": the left side when it has no live terminal to show (no coordinator runs, or the Chat view
//                 has no chat yet): a centered "Start a chat" button (`forge chat --open`). The sidebar then
//                 shows the chat's terminal here.
// Both parts show a coordinator's "blocked: <role> needs <tool>: <command>" (forge status → needs) with what fixes
// it: "Allow for this repo" (or "Force allow" past the deny floor), and "Restart coordinator".
// The left side's view lives in shared "forge.window".view ("coord" or "chat"); the sidebar (forge-runs) reopens
// the window when it changes. The window does not move: every part stops presses (a press that reaches a window
// drags it).
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, closeOverlay, exec, home, shared, setShared, notify } from "herdr";

const forgeBin = () => `${home()}/.local/bin/forge`;
const alpha = (hex, a) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(a * 255).toString(16).padStart(2, "0") : hex);

// Change the left side's view: the sidebar sees it within 2 s and reopens the window in place.
function setView(view) {
  const win = shared("forge.window");
  if (win && win.view !== view) setShared("forge.window", { ...win, view });
}

// The repo or workspace root of a run folder (<main>/.forge/tickets/<ticket>), for forge config --main.
const mainOf = (run) => String(run ?? "").replace(/\/\.forge\/tickets\/[^/]+\/?$/, "");

export default class ForgeWindow extends View {
  init(_p, cx) {
    this.chat = null; // null | "opening" | "error: …"
    this.needs = null; // forge status → needs: a coordinator blocked on a tool
    this.fix = null; // null | "working" | {ok, text}: the last Allow / Restart result
    if (!(props() ?? {}).run) return;
    this.loadNeeds(cx);
    cx.timer.every(5000, (cx) => this.loadNeeds(cx));
  }

  loadNeeds(cx) {
    const p = props() ?? {};
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(forgeBin(), ["status", "--run", p.run], { timeout: 20_000 }).catch(() => null);
        if (r?.code !== 0) return;
        const nd = JSON.parse(r.stdout).needs ?? null;
        if (JSON.stringify(nd) !== JSON.stringify(this.needs)) {
          this.needs = nd;
          cx.notify();
        }
      } finally {
        this.loading = false;
      }
    });
  }

  // Allow (or force-allow) the blocked command for this repo, then start the coordinator again; or only restart.
  unblock(cx, how) {
    const p = props() ?? {};
    const nd = this.needs;
    if (this.fix === "working" || !p.run) return;
    this.fix = "working";
    cx.notify();
    cx.spawn(async (cx) => {
      const run = async (args) => exec(forgeBin(), args, { timeout: 60_000 }).catch((e) => ({ code: 1, stderr: String(e) }));
      const said = (r) => (r.stderr || r.stdout || "").trim().split("\n").pop()?.slice(0, 200) ?? "";
      let done = null;
      if (how !== "restart" && nd?.prefix) {
        const r = await run(["config", how === "force" ? "force" : "allow", "exec", "bash", nd.prefix, "--main", mainOf(p.run)]);
        if (r.code !== 0) done = { ok: false, text: `Could not allow ${nd.prefix}: ${said(r)}` };
      }
      if (!done) {
        const c = await run(["coord", "--run", p.run]);
        done = c.code === 0
          ? { ok: true, text: how === "restart" ? "Coordinator restarted." : `Allowed ${nd?.prefix} for this repo; coordinator restarted.` }
          : { ok: false, text: `Restart failed: ${said(c)}` };
      }
      this.fix = done;
      // The strip goes away once the new coordinator starts, so the result is a toast too.
      notify({ title: done.ok ? "Forge: unblocked" : "Forge: still blocked", body: done.text, level: done.ok ? "success" : "error" });
      cx.notify();
      this.loadNeeds(cx);
    });
  }

  // The red strip: what blocks the run, and the buttons that fix it. compact: one line, for the bar.
  needsStrip(t, compact) {
    const nd = this.needs;
    const working = this.fix === "working";
    const btn = (id, label, how, primary) => div().id(id).h(compact ? 24 : 26).px(10).flex().flex_none().items_center().rounded(6).text_size(11.5)
      .bg(primary ? t.blocked : t.raised).text_color(primary ? t.background : t.foreground)
      .when(!working, (e) => e.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => { cx.stop_propagation(); this.unblock(cx, how); }))
      .child(label);
    const floor = nd.floor ?? "none";
    const allow = floor === "none" ? btn("fw-allow", "Allow for this repo", "allow", true)
      : floor === "force" ? btn("fw-force", "Force allow", "force", true)
      : div().flex_none().text_size(11).text_color(t.dim).tooltip("The deny floor never lifts this command.").child("never allowed");
    const what = `blocked: ${nd.role ?? "an agent"} needs ${nd.tool ?? "a tool"}${nd.command ? `: ${nd.command}` : ""}`;
    const result = this.fix && this.fix !== "working" ? this.fix : null;
    const row = h_flex().id(compact ? "fw-needs-bar" : "fw-needs").gap(8).items_center().min_w(0)
      .child(div().flex_none().text_color(t.blocked).child("◆"))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.blocked).tooltip(nd.text ?? what).child(working ? "Working…" : compact && result && !result.ok ? result.text : what))
      .child(allow)
      .child(btn(compact ? "fw-restart-bar" : "fw-restart", "Restart coordinator", "restart", false));
    if (compact) return row;
    return v_flex().flex_none().gap(4).px(12).py(8).bg(alpha(t.blocked, 0.12)).border_b(1).border_color(alpha(t.blocked, 0.4))
      .child(row)
      .when(Boolean(result), (e) => e.child(div().text_size(11).text_color(result.ok ? t.done : t.blocked).child(result.text)));
  }

  // Start (or reuse) the run chat in its own terminal, and switch the left side to it.
  openChat(cx) {
    const p = props() ?? {};
    if (this.chat === "opening" || !p.run) return;
    this.chat = "opening";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec(forgeBin(), ["chat", "--open", "--run", p.run], { timeout: 60_000 }).catch((e) => ({ code: 1, stderr: String(e) }));
      this.chat = r.code === 0 ? null : `error: ${(r.stderr || r.stdout || "").trim().slice(0, 200)}`;
      if (r.code === 0) setView("chat");
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    if (p.part === "agent") {
      const opening = this.chat === "opening";
      const failed = String(this.chat ?? "").startsWith("error");
      return v_flex().id("fw-agent").size_full().min_h(0).bg(t.background).text_color(t.foreground)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(h_flex().h(30).flex_none().px(12).gap(8).items_center().bg(t.surface).border_b(1).border_color(t.border).text_size(11.5).text_color(t.muted)
          .child(div().w(7).h(7).flex_none().rounded_full().bg(t.dim))
          .child(div().flex_1().min_w(0).truncate().child("No coordinator or chat is running here")))
        .when(Boolean(this.needs), (e) => e.child(this.needsStrip(t, false)))
        .child(v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).px(24)
          .child(div().id("fw-chat").h(32).px(16).flex().items_center().rounded(6).text_size(12.5)
            .bg(t.solid).text_color(t.solid_foreground).when(!opening, (e) => e.cursor_pointer().hover((s) => s.opacity(0.9)).on_click((_e, cx) => this.openChat(cx)))
            .child(opening ? "Starting…" : "Start a chat"))
          .child(div().max_w(420).text_size(11.5).text_color(failed ? t.blocked : t.dim).text_center()
            .child(failed ? this.chat : "Your own Claude, with this run as context. Ask about it, change code, or send a follow-up.")));
    }
    const win = shared("forge.window");
    const view = win?.run === p.run && win?.view === "chat" ? "chat" : "coord";
    const seg = (id, label, on, tip, v) => div().id(id).h(24).px(10).flex().items_center().text_size(11.5)
      .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.muted).tooltip(tip)
      .when(!on, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { setView(v); cx.notify(); }))
      .child(label);
    return h_flex().id("fw-bar").size_full().px(14).gap(10).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_size(12.5)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(div().text_color(t.accent).child("⚒"))
      .child(div().font_semibold().child("Forge"))
      .child(this.needs
        ? h_flex().flex_1().min_w(0).px(8).py(4).rounded(6).bg(alpha(t.blocked, 0.12)).child(this.needsStrip(t, true))
        : div().flex_1().min_w(0).truncate().text_color(t.muted).child(p.title ?? ""))
      .when(Boolean(p.run), (e) => e.child(h_flex().flex_none().rounded(6).overflow_hidden().border_1().border_color(t.border)
        .child(seg("fw-view-coord", "Coordinator", view === "coord", "Left side: the coordinator while one runs", "coord"))
        .child(seg("fw-view-chat", "Chat", view === "chat", "Left side: your chat about this run", "chat"))))
      .child(div().id("fw-close").w(26).h(26).flex().items_center().justify_center().rounded(6).text_color(t.muted).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close the window (cmd-escape)")
        // Closed by you: the sidebar stops reopening it at the next handoff. cmd-escape can bring it back.
        .on_click(() => {
          const w = shared("forge.window");
          if (w?.run) setShared("forge.lastWindow", { run: w.run, view: w.view ?? "coord" });
          setShared("forge.window", null);
          closeOverlay(p.overlay);
        }).child("×"));
  }
}
