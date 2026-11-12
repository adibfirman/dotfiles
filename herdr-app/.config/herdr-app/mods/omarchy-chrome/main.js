import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px, expanding = narrow();
  if (!expanding) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !expanding);
  run("layout.resize", { id: "sidebar", px: expanding ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
  run("layout.resize", { id: "sidebar-footer", px: expanding ? 84 : 136 });
}

export default class WorkspaceChrome extends View {
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(0).border(1).border_color(t.foreground + "00").bg(t.foreground + "0a").text_color(t.muted).hover(s => s.bg(t.foreground + "14").border_color(t.foreground + "40").text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  // Between the rail and 160px the lists draw the rail stretched; once a drag rests there, snap to the nearer one.
  snap(cx) {
    const width = find(layout(), "sidebar")?.size?.px, rail = window()?.platform === "macos" ? 76 : 44;
    if (this.snapping || !(width > rail && width < 160)) return;
    this.snapping = true;
    cx.timer.after(400, (cx) => {
      this.snapping = false;
      if (find(layout(), "sidebar")?.size?.px !== width) return this.snap(cx);
      setShared("sidebar.collapsed", width < 100);
      run("layout.resize", { id: "sidebar", px: width < 100 ? rail : 160 });
      run("layout.resize", { id: "sidebar-footer", px: width < 100 ? 136 : 84 });
    });
  }
  render(cx) {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      this.snap(cx);
      const row = (id, icon, label, dim, action, short) => h_flex().id(id).h(26).px(6).gap(6).items_center()
        .when(collapsed, el => el.size(30).px(0).justify_center().relative().tooltip(label)).rounded(0).border(1).border_color(t.foreground + "00")
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.foreground + "14").border_color(t.foreground + "40").text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(`mods/omarchy-chrome/${icon}.svg`).size(14).flex_none())
        .when(!collapsed, el => el.tooltip(label).child(div().min_w(0).truncate().child(short ?? label)));
      const settings = row("settings", "settings", "Settings", false, () => run("mod.open", { name: "omarchy-settings" }), "Prefs")
        .when(Boolean(updates().app.ready), el => el.child(div().size(6).rounded(0).bg(t.accent).when(collapsed, d => d.absolute().top(2).right(2))));
      const keys = row("keys", "keyboard", "Keybindings", false, () => run("mod.open", { name: "omarchy-keys" }), "Keys");
      const machine = row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "omarchy-machine-add" }), "Add");
      const base = v_flex().size_full().justify_center().bg(t.chrome).px(collapsed ? 0 : 10).py(collapsed ? 4 : 10).gap(2).text_size(12);
      if (collapsed) return base.items_center().child(settings).child(keys).child(machine);
      const pair = (a, b) => h_flex().gap(2).child(a.flex_1().min_w(0).overflow_hidden()).child(b.flex_1().min_w(0).overflow_hidden());
      return base.child(pair(settings, keys)).child(machine);
    }
    return h_flex().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(12)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(8).items_center().child(div().size(12).flex_none().rounded(0).bg(t.accent)).child(div().font_semibold().text_color(t.foreground).child("herdr"))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/omarchy-chrome/search.svg").size(15), () => run("mod.open", { name: "omarchy-picker" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/omarchy-chrome/sidebar.svg").size(15), toggleSidebar)));
  }
}
