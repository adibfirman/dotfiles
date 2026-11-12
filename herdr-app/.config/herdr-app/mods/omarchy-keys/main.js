// Every key binding Herdr has (keys()), grouped by where it works, then by type.
// Click a heading to fold it (remembered); typing a filter shows every match. Esc closes.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keys, theme, shared, props, closeOverlay } from "herdr";
import { GROUPS, describe, fold } from "./describe.js";

// The shown layout's own keys win over global ones, so they come first.
function title(section, layout) {
  if (section === `layout:${layout}`) return "This layout";
  if (section === "global") return "Everywhere";
  if (section === "terminal") return "In a terminal";
  const [kind, name] = section.split(":");
  return kind === "layout" ? `Layout ${name}` : kind === "mod" ? `Mod ${name}` : section;
}

// "ctrl-shift-p" -> ["ctrl", "shift", "p"]; "ctrl--" -> ["ctrl", "-"].
const keyParts = (k) => (k.endsWith("--") ? [...k.slice(0, -2).split("-"), "-"] : k.split("-"));

export default class OmarchyKeys extends View {
  init(_props, cx) {
    this.query = "";
    this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
    this.input = InputState.new({ placeholder: "Filter keys or actions…" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value().trim().toLowerCase(); cx.notify(); });
    this.input.focus();
    cx.timer.after(100, () => this.input.focus());
  }

  toggle(id, cx) {
    if (!this.folded.delete(id)) this.folded.add(id);
    localStorage.setItem("folded", JSON.stringify([...this.folded]));
    cx.notify();
  }

  render() {
    const t = theme(), layout = shared("layout"), q = this.query;
    const all = keys().map((k) => ({ ...k, ...describe(k.action) }))
      .filter((k) => !q || [k.keys, k.action, k.label, k.group].some((v) => v.toLowerCase().includes(q)));
    const own = new Set(all.filter((k) => k.section === `layout:${layout}`).map((k) => k.keys));
    const sections = [...new Set(all.map((k) => k.section))]
      .sort((a, b) => (a === `layout:${layout}` ? -1 : b === `layout:${layout}` ? 1 : 0));
    const mine = `layout:${layout}`;
    const open = (id) => Boolean(q) || !this.folded.has(id);
    const chevron = (id) => svg(`mods/omarchy-chrome/chevron-${open(id) ? "down" : "right"}.svg`).size(11).flex_none();
    const count = (n) => div().text_size(11).text_color(t.dim).child(`${n}`);
    const chip = (p, on) => div().h(20).px(5).flex().items_center().border_1().border_color(on ? t.accent : t.border).bg(on ? t.accent + "1f" : t.raised).text_size(11)
      .text_color(on ? t.accent : t.foreground).child(p);
    const row = (section, k) => {
      // A global key this layout binds too does the layout's action here.
      const shadowed = section === "global" && (own.has(k.keys) || (k.run && own.has(`${k.keyBase}${k.from}`))), on = section === mine;
      return h_flex().id(`k-${section}-${k.keys}`).h(28).flex_none().pl(44).pr(10).gap(12).items_center().hover((s) => s.bg(t.hover))
        .child(h_flex().w(200).flex_none().gap(3).items_center().children(keyParts(k.keys).map((p) => chip(p, on))))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(on ? t.foreground : shadowed ? t.dim : t.muted).child(describe(k.action).label))
        .child(div().flex_none().max_w(200).truncate().text_size(11).text_color(t.dim).child(shadowed ? "overridden here" : k.action));
    };
    const rows = (section) => {
      const list = all.filter((k) => k.section === section);
      return GROUPS.flatMap((g) => {
        const group = fold(list.filter((k) => k.group === g));
        if (!group.length) return [];
        const id = `${section}/${g}`;
        const heading = h_flex().id(`kg-${id}`).h(28).flex_none().pl(27).pr(10).gap(6).items_center().text_size(10.5).text_color(t.dim)
          .cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => this.toggle(id, cx))
          .child(chevron(id)).child(g).child(count(group.length));
        return [heading, ...(open(id) ? group.map((k) => row(section, k)) : [])];
      });
    };
    const size = (section) => all.filter((k) => k.section === section).length;
    const head = (section) => h_flex().id(`ks-${section}`).h(30).flex_none().px(10).gap(6).items_center().text_size(11).font_semibold()
      .text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => this.toggle(section, cx))
      .child(chevron(section)).child(title(section, layout).toUpperCase()).child(count(size(section)));
    // The keys that came with this layout stand apart: an accent block with its own heading.
    const block = (section) => v_flex().id(`kb-${section}`).flex_none().mb(10).border_l(2).border_color(t.accent).bg(t.accent + "0d")
      .child(h_flex().id(`ks-${section}`).h(30).flex_none().px(10).gap(6).items_center().text_color(t.accent)
        .cursor_pointer().on_click((_e, cx) => this.toggle(section, cx))
        .child(chevron(section))
        .child(div().text_size(11).font_semibold().child(`${title(section, layout).toUpperCase()} · CAME WITH ${layout.toUpperCase()}`))
        .child(div().text_size(11).text_color(t.dim).child(`${size(section)} keys`)))
      .children(open(section) ? rows(section) : []);
    return v_flex().id("omarchy-keys").size_full().min_h(0).p(16).gap(10).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(h_flex().h(34).flex_none().px(10).gap(10).items_center().border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/omarchy-keys/keyboard.svg").size(15).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))
        .child(div().text_size(11).text_color(t.dim).child(`${all.length} keys · Esc`)))
      .child(v_flex().id("omarchy-keys-list").flex_1().min_h(0).overflow_y_scrollbar()
        .when(!all.length, (e) => e.child(div().p(10).text_size(12.5).text_color(t.dim).child(`No key matches "${this.query}"`)))
        .children(sections.flatMap((section) => (section === mine ? [block(section)] : [head(section), ...(open(section) ? rows(section) : [])]))));
  }
}
