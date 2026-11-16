// forge-window: the parts of a forge run window.
//   part "bar":   the title bar: run title, the Coordinator | Chat switch for the left side, close.
//   part "agent": the left side when it has no live terminal to show (no coordinator runs, or the Chat view
//                 has no chat yet): a centered "Start a chat" button (`forge chat --open`). The sidebar then
//                 shows the chat's terminal here.
// The left side's view lives in shared "forge.window".view ("coord" or "chat"); the sidebar (forge-runs) reopens
// the window when it changes. The window does not move: every part stops presses (a press that reaches a window
// drags it).
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, closeOverlay, exec, home, shared, setShared } from "herdr";

const forgeBin = () => `${home()}/.local/bin/forge`;

// Change the left side's view: the sidebar sees it within 2 s and reopens the window in place.
function setView(view) {
  const win = shared("forge.window");
  if (win && win.view !== view) setShared("forge.window", { ...win, view });
}

export default class ForgeWindow extends View {
  init() {
    this.chat = null; // null | "opening" | "error: …"
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
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(p.title ?? ""))
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
