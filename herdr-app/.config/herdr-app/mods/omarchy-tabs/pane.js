// Adapted from Herdr's pane header (Apache-2.0); see NOTICE and LICENSE-APACHE.
// Changes: OMP/Claude session titles, per-pane title selection, full-title tooltip.
import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home } from "herdr";
import { paneTitle } from "./names.js";

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

function button(t, id, asset, command, args) {
  return div().id(id).p(3).rounded(4).text_color(t.dim)
    .hover(s => s.bg(t.hover).text_color(t.foreground))
    .on_click((_event, cx) => { cx.stop_propagation(); run(command, args); })
    .child(svg(`mods/omarchy-tabs/icons/${asset}.svg`).size(14));
}

export function renderPaneHeader(view) {
  const t = theme();
  const p = panes().find(pane => pane.pane === props()?.pane);
  if (!p) return div();
  const name = paneTitle(p);
  const pic = icon(p.program, 14, t.dim);
  const pane = p.pane;
  return h_flex().id(`pane-head-${pane}`).size_full().px(10).gap(8).items_center()
    .bg(t.background).border_b(1).border_color(t.border).text_size(12)
    .on_hover((hovered, cx) => { view.hovered = hovered; cx.notify(); })
    .on_click(() => run("pane.focus", { pane }))
    .when(Boolean(pic), el => el.child(pic))
    .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).tooltip(name).child(name))
    .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
    .when(p.status === "working", el => el.child(svg("mods/omarchy-tabs/icons/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
    .when(p.status === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
    .when(p.status === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
    .when(view.hovered, el => el
      .child(button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
      .child(button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
      .child(button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
      .child(button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
}
