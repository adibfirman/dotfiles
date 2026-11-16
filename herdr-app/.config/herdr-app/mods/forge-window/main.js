// forge-window: the parts of a forge run window.
//   part "bar":   the title bar (run title, close).
//   part "agent": shown only when no coordinator terminal is live (the gate, or done); with one live, the window
//                 shows that real terminal instead. It reads the coordinator's screen when there is one.
// The window does not move: every part stops presses (a press that reaches a window drags it).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { props, theme, terminals, closeOverlay, exec, hc, home, settings, setShared } from "herdr";
import { trimPrompt } from "./trim.js";

const forgeBin = () => `${home()}/.local/bin/forge`;

export default class ForgeWindow extends View {
  init(_p, cx) {
    Object.assign(this, { lines: [], coord: null, ticks: 0, loading: false });
    if ((props() ?? {}).part !== "agent") return;
    this.scroll = ScrollHandle.new();
    cx.timer.every(2000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  // The coordinator can change (a phase handoff): look it up every 10 s, read its screen every 2 s.
  refresh(cx) {
    const p = props() ?? {};
    if (this.loading || !p.run) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        if (!this.coord || this.ticks % 5 === 0) {
          const st = await exec(forgeBin(), ["status", "--run", p.run], { timeout: 20_000 }).catch(() => null);
          if (st?.code === 0) this.coord = JSON.parse(st.stdout).coordinator ?? null;
        }
        this.ticks++;
        const term = this.coord?.terminal;
        const live = term && terminals().some((t) => t.address === term && t.state === "live");
        const lines = live ? trimPrompt((await hc(["read", "--lines", "120", term]).catch(() => ({ stdout: "" }))).stdout) : [];
        if (lines.join("\n") !== this.lines.join("\n")) {
          this.lines = lines;
          if (lines.length) this.scroll.scroll_to_item(lines.length - 1);
        }
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    if (p.part === "agent") {
      const term = this.coord?.terminal ? terminals().find((x) => x.address === this.coord.terminal) : null;
      const status = term ? term.status ?? (term.state === "live" ? "idle" : "ended") : "none";
      const color = status === "working" ? t.working : status === "blocked" ? t.blocked : status === "idle" || status === "done" ? t.idle : t.dim;
      const mono = settings().font_family ?? "JetBrains Mono";
      return v_flex().id("fw-agent").size_full().min_h(0).bg(t.background).text_color(t.foreground)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(h_flex().h(30).flex_none().px(12).gap(8).items_center().bg(t.surface).border_b(1).border_color(t.border).text_size(11.5).text_color(t.muted)
          .child(div().w(7).h(7).flex_none().rounded_full().bg(color))
          .child(div().font_semibold().text_color(t.foreground).child("Agent"))
          .child(div().flex_1().min_w(0).truncate().child(this.coord ? `${this.coord.id} · ${status}` : "no coordinator yet")))
        .child(v_flex().id("fw-agent-screen").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).px(12).py(8)
          .font_family(mono).text_size(11.5)
          .children(this.lines.length
            ? this.lines.map((l, i) => div().id(`fw-l-${i}`).min_h(16).truncate().child(l || " "))
            : [div().text_color(t.dim).child(status === "none" || status === "ended" ? "No agent is running now (at the gate, or the run is done)." : "Loading…")]));
    }
    return h_flex().id("fw-bar").size_full().px(14).gap(10).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_size(12.5)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(div().text_color(t.accent).child("⚒"))
      .child(div().font_semibold().child("Forge"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(p.title ?? ""))
      .child(div().id("fw-close").w(26).h(26).flex().items_center().justify_center().rounded(6).text_color(t.muted).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close the window")
        // Closed by you: the sidebar stops reopening it at the next handoff.
        .on_click(() => { setShared("forge.window", null); closeOverlay(p.overlay); }).child("×"));
  }
}
