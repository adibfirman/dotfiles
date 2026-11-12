import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

// Pieces ---------------------------------------------------------------

export function heading(t, text) {
  return div().pt(6).pb(8).text_size(12).font_semibold().text_color(t.dim).child(text.toUpperCase());
}

// One setting: what it is on the left, the control on the right.
export function row(t, title, about, control) {
  return h_flex()
    .w_full()
    .gap(16)
    .py(12)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .gap(3)
        .child(div().text_size(14).text_color(t.foreground).child(title))
        .when(Boolean(about), (el) => el.child(div().text_size(12.5).line_height("18px").text_color(t.dim).child(about))),
    )
    .child(div().flex_none().child(control));
}

export function button(t, id, label, onClick) {
  return div()
    .id(id)
    .px(12)
    .py(5)
    .rounded(0)
    .border_1()
    .border_color(t.border)
    .bg(t.raised)
    .cursor_pointer()
    .text_size(13)
    .text_color(t.foreground)
    .hover((s) => s.bg(t.hover))
    .on_click(onClick)
    .child(label);
}

// − value +
export function stepper(t, id, value, onMinus, onPlus) {
  const b = (k, label, f) =>
    div()
      .id(`${id}-${k}`)
      .w(28)
      .h(28)
      .flex()
      .items_center()
      .justify_center()
      .cursor_pointer()
      .text_size(15)
      .text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(f)
      .child(label);
  return h_flex()
    .items_center()
    .rounded(0)
    .border_1()
    .border_color(t.border)
    .bg(t.raised)
    .overflow_hidden()
    .child(b("minus", "\u2212", onMinus))
    .child(div().w(54).text_size(13).text_color(t.foreground).flex().justify_center().child(value))
    .child(b("plus", "+", onPlus));
}

export function toggle(t, id, on, onClick) {
  return div()
    .id(id)
    .w(36)
    .h(20)
    .rounded(0)
    .p(2)
    .cursor_pointer()
    .bg(on ? t.accent : t.hover)
    .flex()
    .when(on, (el) => el.justify_end())
    .on_click(onClick)
    .child(div().w(16).h(16).rounded(0).bg(on ? t.accent_foreground : t.muted));
}
