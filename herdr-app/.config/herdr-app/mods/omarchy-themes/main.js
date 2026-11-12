// Theme switcher, as Omarchy 4's: full screen over the desktop, each theme's
// desktop preview, the chosen one large in the middle. ←/→ move, Enter applies, Esc closes.
// omarchy-bar brings the theme's wallpaper.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { themes, settings, run, theme, props, closeOverlay, appHome, readTextFile, writeTextFile } from "herdr";

const DIR = "mods/omarchy-themes/previews";
// The themes with a preview here (Omarchy's previews/<theme>.webp).
const PREVIEWS = ["catppuccin", "catppuccin-latte", "ethereal", "everforest", "flexoki-light", "gruvbox", "hackerman", "jade-horse",
  "kanagawa", "last-horizon", "lumon", "lupine", "matte-black", "miasma", "nord", "retro-82", "ristretto", "rose-pine",
  "solitude", "starship", "tokyo-night", "vantablack", "white"];

const list = () => themes().filter((x) => PREVIEWS.includes(x.name));

export default class OmarchyThemes extends View {
  init(_props, cx) {
    this.at = Math.max(0, list().findIndex((x) => x.name === settings().theme));
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(100, () => this.handle.focus());
  }

  move(by, cx) {
    const n = list().length;
    this.at = (this.at + by + n) % n;
    cx.notify();
  }

  // A light theme only shows in light mode and a dark one in dark, so the mode follows the pick,
  // as in Omarchy. Written before closing: this overlay's tasks end with it.
  async pick(x) {
    if (x.light === Boolean(settings().dark)) {
      const file = `${appHome()}/settings.json`, raw = await readTextFile(file).catch(() => null);
      let person = {};
      try { person = JSON.parse(raw ?? "{}"); } catch { /* unreadable: start from empty */ }
      await writeTextFile(file, JSON.stringify({ ...person, appearance: x.light ? "light" : "dark" }, null, 2) + "\n", raw).catch(() => null);
    }
    run("app.theme", { name: x.name });
    closeOverlay(props().overlay);
  }

  render() {
    const t = theme(), all = list(), current = settings().theme;
    if (!all.length) return div().size_full();
    const at = Math.min(this.at, all.length - 1), chosen = all[at];
    const near = (by) => all[(at + by + all.length) % all.length];
    // As Omarchy 4: the chosen preview large in the middle, its neighbours as strips
    // fanned out to both sides, fading with distance, over the dimmed desktop.
    // Sizes come in screen px; elements take units that the zoom scales.
    const width = (this.size?.width ?? 1600) / (settings().zoom ?? 1), W = Math.round(width * 0.5), H = Math.round(W * 9 / 16);
    const STRIP = 64, sideH = Math.round(H * 0.88), count = Math.min(6, Math.floor((all.length - 1) / 2), Math.floor((width - W) / 2 / STRIP));
    const preview = (x, w, h) => image(`${DIR}/${x.name}.webp`).w(w).h(h).flex_none();
    const strip = (by) => div().id(`th-strip-${by}`).relative().w(STRIP).h(sideH).flex_none().overflow_hidden()
      .border_l(1).border_r(1).border_color("#000000").cursor_pointer().on_click((_e, cx) => this.move(by, cx))
      .child(div().absolute().top(0).when(by < 0, (e) => e.left(0)).when(by > 0, (e) => e.right(0)).child(preview(near(by), Math.round(W * 0.88), sideH)))
      // Solid, darker with distance: a shade over the strip, not see-through to the window behind.
      .child(div().absolute().inset_0().bg(`#000000${Math.round(0x30 + 0x18 * (Math.abs(by) - 1)).toString(16)}`));
    // Left: -count … -1; right: 1 … count, nearest next to the chosen one.
    const side = (sign) => Array.from({ length: count }, (_, i) => (sign < 0 ? i - count : i + 1)).map(strip);
    return v_flex().id("omarchy-themes").track_focus(this.handle).size_full().gap(28).items_center().justify_center().bg("#000000cc")
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return closeOverlay(props().overlay);
        if (k === "enter") return this.pick(chosen);
        if (k === "right" || k === "down" || k === "tab") this.move(1, cx);
        else if (k === "left" || k === "up") this.move(-1, cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center()
        .children(side(-1))
        .child(div().id("th-chosen").flex_none().mx(10).border_3().border_color(t.accent).cursor_pointer().on_click(() => this.pick(chosen)).child(preview(chosen, W, H)))
        .children(side(1)))
      .child(h_flex().gap(12).items_center()
        .child(div().text_size(30).font_semibold().text_color("#ffffffee").child(chosen.name.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")))
        .when(chosen.name === current, (e) => e.child(div().px(6).border_1().border_color(t.accent).text_size(12).text_color(t.accent).child("current"))));
  }
}
