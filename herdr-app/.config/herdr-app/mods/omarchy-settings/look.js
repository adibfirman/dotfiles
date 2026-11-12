import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Input } from "gpui-base";
import { run, themes, fonts, settings, layouts, shared } from "herdr";
import { heading, row, button, stepper, toggle } from "./controls.js";

const I = (name) => `mods/omarchy-settings/${name}.svg`;

const LOOKS = { main: "Herdr", terminals: "Terminals", win98: "Herdr 98" };
const APPEARANCES = [
  [null, "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

// What the app uses when settings.json names no font (settings.rs).
export const DEFAULT_FONT = "JetBrains Mono";
const DEFAULT_UI_FONT = "Geist";

// Look -----------------------------------------------------------------

// A small drawing of each layout, in the theme's colors (as the welcome draws them).
function preview(t, name) {
  const row = () => div().flex().flex_row();
  const col = () => div().flex().flex_col();
  const term = (bg = t.background, edge = t.border) => div().flex_1().rounded(0).bg(bg).border_1().border_color(edge);
  const line = (w, c = t.dim) => div().h(3).w(w).flex_none().rounded(0).bg(c);
  const lines = (n, c) => col().gap(4).p(5).children([...Array(n)].map((_, i) => line(i % 2 ? 22 : 32, c)));
  const frame = (el) => el.size_full().rounded(0).overflow_hidden().border_1().border_color(t.border).bg(t.surface);
  if (name === "main")
    return frame(row())
      .child(col().w(42).border_r(1).border_color(t.border).child(lines(4)))
      .child(
        col()
          .flex_1()
          .child(row().h(11).gap(2).p(2).border_b(1).border_color(t.border).child(div().w(20).rounded(0).bg(t.accent)).child(div().w(16).rounded(0).bg(t.raised)).child(div().w(16).rounded(0).bg(t.raised)))
          .child(row().flex_1().p(4).gap(3).child(term()).child(term())),
      );
  if (name === "terminals") {
    const card = () => col().flex_1().rounded(0).border_1().border_color("#2c2f34").bg("#17191c").child(row().h(7).px(3).items_center().border_b(1).border_color("#25282c").child(line(14, "#5d6168")));
    return frame(col())
      .bg("#131619")
      .p(4)
      .gap(4)
      .child(row().h(10).gap(3).p(1).rounded(0).bg("#1d1f22").child(div().w(30).rounded(0).bg("#34373c").border_1().border_color("#4a4d53")).child(div().w(30)))
      .child(row().flex_1().gap(4).child(card()).child(card()));
  }
  // A layout of the person's own: a plain frame.
  return frame(col()).child(row().h(11).border_b(1).border_color(t.border)).child(row().flex_1().p(4).child(term()));
}

function layoutPicker(view, t, cx) {
  const current = shared("layout") ?? "main";
  // Shipped looks in the welcome's order, then the person's own; new files show up by themselves.
  const shipped = Object.keys(LOOKS);
  const rank = (n) => (shipped.includes(n) ? shipped.indexOf(n) : shipped.length);
  const names = [...layouts()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  if (names.join("\n") !== view.previewsOf) view.loadPreviews(names, cx);
  return h_flex()
    .w_full()
    .flex_wrap()
    .gap(8)
    .children(
      names.map((name) => {
        const on = name === current;
        return v_flex()
          .id(`st-l-${name}`)
          .w(124)
          .gap(6)
          .p(6)
          .rounded(0)
          .border_2()
          .border_color(on ? t.accent : "#00000000")
          .bg(on ? t.raised : "#00000000")
          .cursor_pointer()
          .hover((s) => s.bg(t.raised))
          .on_click((_e, cx) => {
            run("layout.switch", { name });
            cx.notify();
          })
          .child(
            div()
              .h(62)
              .w_full()
              .child(
                view.previews[name]
                  ? image(view.previews[name]).size_full().rounded(0).border_1().border_color(t.border)
                  : preview(t, name),
              ),
          )
          .child(
            h_flex()
              .gap(5)
              .items_center()
              .child(div().text_size(12.5).text_color(on ? t.foreground : t.muted).child(LOOKS[name] ?? name.charAt(0).toUpperCase() + name.slice(1)))
              .when(on, (el) => el.child(svg(I("check")).size(12).text_color(t.accent))),
          );
      }),
    );
}

function appearancePicker(view, t, cx) {
  const now = view.person.appearance ?? null;
  return h_flex()
    .p(2)
    .gap(2)
    .rounded(0)
    .border_1()
    .border_color(t.border)
    .bg(t.background)
    .children(
      APPEARANCES.map(([value, label]) =>
        div()
          .id(`st-ap-${label}`)
          .px(12)
          .py(4)
          .rounded(0)
          .text_size(13)
          .cursor_pointer()
          .when(now === value, (el) => el.bg(t.raised).text_color(t.foreground).border_1().border_color(t.border))
          .when(now !== value, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
          .on_click((_e, cx) =>
            view.change((p) => {
              if (value === null) delete p.appearance;
              else p.appearance = value;
            }, cx),
          )
          .child(label),
      ),
    );
}

function themePicker(t, light) {
  const s = settings();
  const current = light ? s.theme_light : s.theme_dark;
  return h_flex()
    .w_full()
    .flex_wrap()
    .gap(8)
    .children(
      // A theme named like a layout (themes/win98.json) is that layout's own.
      themes()
        .filter((x) => Boolean(x.light) === light && (x.name === shared("layout") || !layouts().includes(x.name)))
        .map(({ name, colors: c }) => {
        const on = name === current;
        const dot = (color) => div().w(8).h(8).rounded(0).bg(color);
        return v_flex()
          .id(`st-t-${name}`)
          .w(124)
          .gap(6)
          .p(6)
          .rounded(0)
          .border_2()
          .border_color(on ? t.accent : "#00000000")
          .cursor_pointer()
          .hover((s) => s.bg(t.raised))
          .on_click((_e, cx) => {
            run("app.theme", { name });
            cx.notify();
          })
          .child(
            v_flex()
              .h(46)
              .w_full()
              .p(7)
              .gap(6)
              .rounded(0)
              .border_1()
              .border_color(t.border)
              .bg(c.background)
              .child(div().h(4).w(44).rounded(0).bg(c.terminal_foreground))
              .child(h_flex().gap(4).child(dot(c.accent)).child(dot(c.ansi1)).child(dot(c.ansi2)).child(dot(c.ansi3)).child(dot(c.ansi5))),
          )
          .child(
            h_flex()
              .gap(5)
              .items_center()
              .child(div().text_size(12.5).text_color(on ? t.foreground : t.muted).child(name.replace(/-/g, " ")))
              .when(on, (el) => el.child(svg(I("check")).size(12).text_color(t.accent))),
          );
      }),
    );
}

// The font in use, written in itself; a click opens the list.
function fontButton(view, t, which, family) {
  const open = view.picking === which;
  return div()
    .id(`st-f-${which}`)
    .w(220)
    .px(12)
    .py(6)
    .rounded(0)
    .border_1()
    .border_color(open ? t.accent : t.border)
    .bg(t.raised)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => {
      view.picking = open ? null : which;
      view.filter = "";
      view.fontInput.set_value("");
      if (view.picking) view.fontInput.focus();
      else view.handle.focus();
      cx.notify();
    })
    .child(div().font_family(family).text_size(13.5).text_color(t.foreground).child(family));
}

function fontList(view, t, which, def) {
  const q = view.filter.toLowerCase();
  const matches = fonts().filter((f) => f.toLowerCase().includes(q)).slice(0, 200);
  const choose = (name, cx) => {
    view.change((p) => {
      if (name === null) delete p[which];
      else p[which] = name;
    }, cx);
    view.picking = null;
    view.handle.focus();
    cx.notify();
  };
  const item = (id, label, family, onClick) =>
    div()
      .id(id)
      .px(10)
      .py(5)
      .rounded(0)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(onClick)
      .child(div().font_family(family).text_size(13.5).text_color(t.foreground).child(label));
  return v_flex()
    .w_full()
    .mb(8)
    .rounded(0)
    .border_1()
    .border_color(t.border)
    .bg(t.background)
    // Let the child's native scroll run before stopping the page's wheel event.
    .on_scroll_wheel((_e, cx) => cx.stop_propagation())
    .child(
      div()
        .px(12)
        .py(8)
        .border_b(1)
        .border_color(t.border)
        .text_size(13)
        .child(Input.new(view.fontInput).h(28).text_color(t.foreground)),
    )
    .child(
      div()
        .id(`st-fl-${which}`)
        .h(200)
        .p(4)
        .overflow_y_scrollbar()
        .when(!q, (el) => el.child(item(`st-fd-${which}`, `Default (${def})`, def, (_e, cx) => choose(null, cx))))
        .children(matches.map((f, i) => item(`st-fi-${which}-${i}`, f, f, (_e, cx) => choose(f, cx)))),
    );
}

export function look(view, t, cx) {
  const s = settings();
  const p = view.person;
  const own = (key, composed, def) => (p[key] ?? def) !== composed;
  const size = (key, value, d, cx) => view.change((q) => (q[key] = Math.max(8, Math.min(32, (q[key] ?? value) + d))), cx);
  const fontRow = (which, sizeKey, title, family, def, sizeNow) =>
    v_flex()
      .w_full()
      .child(
        row(
          t,
          title,
          own(which, family, def) ? "This layout sets its own; yours shows in the others." : null,
          h_flex()
            .gap(8)
            .items_center()
            .child(fontButton(view, t, which, family))
            // The panels' text follows zoom: they size their rows to it.
            .when(Boolean(sizeKey), (el) => el.child(stepper(t, `st-${sizeKey}`, `${Math.round(sizeNow)}`, (_e, cx) => size(sizeKey, sizeNow, -1, cx), (_e, cx) => size(sizeKey, sizeNow, 1, cx)))),
        ),
      )
      .when(view.picking === which, (el) => el.child(fontList(view, t, which, def)));
  return v_flex()
    .w_full()
    .child(heading(t, "Layout"))
    .child(layoutPicker(view, t, cx))
    .child(div().h(18))
    .child(heading(t, "Theme"))
    .child(row(t, "Appearance", "Light or dark, or as your system is now.", appearancePicker(view, t, cx)))
    .child(div().pt(12).pb(8).text_size(12.5).text_color(t.dim).child("For the layout you're in: each layout keeps its own light and dark theme."))
    .child(div().pb(6).text_size(12.5).font_medium().text_color(t.muted).child("Dark"))
    .child(themePicker(t, false))
    .child(div().pt(10).pb(6).text_size(12.5).font_medium().text_color(t.muted).child("Light"))
    .child(themePicker(t, true))
    .child(
      row(
        t,
        "Desktop wallpaper",
        "Show your desktop's wallpaper instead of the theme's, on GNOME and Windows. Omarchy always does.",
        toggle(t, "st-desktop-wallpaper", p.follow_desktop_wallpaper === true, (_e, cx) =>
          view.change((q) => (q.follow_desktop_wallpaper = q.follow_desktop_wallpaper !== true), cx, () => run("omarchy-bar.match-wallpaper")),
        ),
      ),
    )
    .child(div().h(18))
    .child(heading(t, "Size and fonts"))
    .child(
      row(
        t,
        "Zoom",
        "Everything: terminals, panels, text.",
        h_flex()
          .gap(8)
          .items_center()
          .child(stepper(t, "st-zoom", `${Math.round(s.zoom * 100)}%`, () => run("app.zoom_out"), () => run("app.zoom_in")))
          .child(button(t, "st-zoom-reset", "Reset", () => run("app.zoom_reset"))),
      ),
    )
    .child(fontRow("font", "font_size", "Terminal font", s.font_family, DEFAULT_FONT, s.font_size))
    .child(fontRow("ui_font", null, "Interface font", s.ui_font_family, DEFAULT_UI_FONT));
}
