import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, theme, run, window, props, layout, shared, setShared, focused, home, nextCommand, settings, watchFolder } from "herdr";
import { matchWallpaper, nextWallpaper, desktopDirectory } from "./wallpaper.js";

const own = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Same toggle as omarchy-chrome's header: the rail goes by width.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  const narrow = (width ?? Infinity) < 160;
  if (!narrow) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow);
  run("layout.resize", { id: "sidebar", px: narrow ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

export default class OmarchyBar extends View {
  init(_props, cx) {
    // The bar is in the layout twice; one copy takes the key.
    if (props()?.part !== "left") return;
    // Each step touches cx, so a reloaded bar's old loop ends instead of eating the key.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "next-wallpaper") await nextWallpaper();
        // Settings sends this when "Desktop wallpaper" is switched.
        if (command === "match-wallpaper") await matchWallpaper(settings().theme);
        cx.notify();
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        await watchFolder(desktopDirectory()).catch(() => cx.sleep(60000));
        await cx.sleep(300);
        await matchWallpaper(settings().theme);
        cx.notify();
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        await cx.sleep(60000);
        await matchWallpaper(settings().theme);
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    const part = props()?.part;
    const row = h_flex().id(`omarchy-${part}`).size_full().items_center().bg(t.chrome).text_size(12).text_color(t.muted).overflow_hidden();
    if (part === "right") return this.right(row, t);
    return this.left(row, t);
  }

  left(row, t) {
    const name = settings().theme;
    if (name !== this.theme) {
      this.theme = name;
      matchWallpaper(name);
    }
    const list = spaces();
    const space = list.find((s) => s.active);
    const cwd = focused()?.cwd;
    const here = cwd ? (cwd === home() ? "~" : cwd.split("/").filter(Boolean).pop()) : null;
    const sep = () => div().flex_none().mx(10).text_color(t.border).child("│");
    // macOS draws its window buttons over this corner; leave them room.
    const w = window();
    return row.pl(w?.platform === "macos" && !w.fullscreen ? 76 : 4)
      .on_size_change((_size, cx) => {
        const narrow = globalThis.window.viewport_size().width < 1024;
        if (narrow !== this.narrow) {
          this.narrow = narrow;
          const sizes = narrow
            ? [["bar-left", { weight: 1 }], ["ai-usage", { weight: 2 }], ["bar-right", { px: w?.buttons ? 90 : 0 }]]
            : [["bar-left", { weight: 3 }], ["ai-usage", { weight: 2.5 }], ["bar-right", { px: w?.buttons ? 90 : 0 }]];
          for (const [id, size] of sizes) {
            const current = find(layout(), id)?.size;
            if (current && (current.px !== size.px || current.weight !== size.weight)) run("layout.resize", { id, ...size });
          }
          cx.notify();
        }
      })
      .child(own(div().id("menu").flex_none().size(24).mr(6).flex().items_center().justify_center().cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click(() => run("mod.open", { name: "omarchy-palette" }))
        .text_color(t.accent).child(svg("mods/omarchy-bar/omarchy.svg").size(14))))
      .child(own(div().id("sidebar-toggle").flex_none().w(30).h_full().flex().items_center().justify_center().cursor_pointer().text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(toggleSidebar)
        .child(svg("mods/omarchy-chrome/sidebar.svg").size(14))))
      .child(own(div().id("search").flex_none().w(30).h_full().flex().items_center().justify_center().cursor_pointer().text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => run("mod.open", { name: "omarchy-picker" }))
        .child(svg("mods/omarchy-chrome/search.svg").size(14))))
      .when(Boolean(space), (el) => el.child(sep())
        .child(div().flex_none().text_color(t.foreground).child(space.name))
        // The focused terminal may have moved away from the folder its space was named after.
        .when(Boolean(here) && here !== space.name, (e) => e.child(div().flex_none().ml(8).text_color(t.muted).child(here)))
        .when(Boolean(space.branch), (e) => e.child(div().flex_none().ml(8).text_color(t.dim).child(space.branch)))
        .when(Boolean(space.machine), (e) => e.child(div().flex_none().ml(8).text_color(t.dim).child(`@${space.machine}`))));
  }

  right(row, t) {
    const w = window();
    const btn = (id, icon, cmd, danger) => own(
      div().id(id).flex_none().w(30).h_full().flex().items_center().justify_center().cursor_pointer().text_color(t.dim)
        .hover((s) => s.bg(danger ? t.blocked : t.hover).text_color(danger ? t.background : t.foreground))
        .on_click(() => run(cmd))
        .child(svg(`mods/omarchy-bar/${icon}.svg`).size(14)));
    return row.justify_end()
      .when(Boolean(w?.buttons), (el) => el
        .child(btn("wb-min", "win-min", "window.minimize"))
        .child(btn("wb-max", w.maximized ? "win-restore" : "win-max", "window.maximize"))
        .child(btn("wb-close", "win-close", "window.close", true)));
  }
}
