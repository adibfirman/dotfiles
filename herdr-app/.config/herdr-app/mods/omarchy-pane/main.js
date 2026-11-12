// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "omarchy-pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.
//
// A pane showing a herdr-browser page gets the browser's toolbar instead, in
// the look of Herdr UI's browser tabs: back, forward, reload, the address,
// zoom, Annotate, DevTools (ctrl-alt-i), open-in-Chrome-app (ctrl-alt-o) and
// open-in-browser. Annotating shows the browser-notes
// panel in the layout's right-hand stack.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, InputState, Input } from "gpui-base";
import { panes, props, run, theme, home, exec, layout, shared, setShared, window, focused, nextCommand, readTextFile, watchFolder } from "herdr";
import { act, readLive, watchLive, touches } from "./browser/client.js";

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// What the address field shows: a local page by its path, the rest by URL.
function shown(live) {
  if (!live || live.url === "about:blank") return "";
  return live.local ? live.display : live.url;
}

function findNode(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return findNode(node.root, id);
}

// The system's browser: Windows has no `open`, and Linux distros like Arch only ship `xdg-open`.
function openOutside(url) {
  if (/^[a-z]:[\\/]/i.test(home())) exec("explorer", [url]);
  else exec(window()?.platform === "linux" ? "xdg-open" : "open", [url]);
}

// A real Chrome window for development: smooth scrolling, DevTools and
// extensions, which the streamed page can't give. `setsid -f` detaches it so
// exec's 30 s timeout can't kill a Chrome this call started.
const CHROME = 'for b in google-chrome chromium; do command -v $b >/dev/null && exec setsid -f $b "$@"; done; exit 1';
function openApp(url, ...flags) {
  if (window()?.platform !== "linux") return openOutside(url);
  exec("sh", ["-c", CHROME, "sh", ...flags, `--app=${url}`]).then((r) => { if (r.code) openOutside(url); }, () => openOutside(url));
}
// The flag only takes when this starts Chrome: in a running one, press F12.
const openDev = (url) => openApp(url, "--auto-open-devtools-for-tabs");

// Saving one of these under a local page's folder reloads the page.
const PAGE_FILE = /\.(html?|css|m?js|json|svg|png|jpe?g|gif|webp|md)$/i;
// herdr-browser serves each local folder from its own host name.
const servedBy = (live) => (live?.local ? /^https?:\/\/([^.]+)\.herdr\.localhost/.exec(live.url)?.[1] : null) || null;

const BROWSER = "mods/omarchy-pane/browser";

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.terminal = props()?.terminal || null;
    this.live = null;
    this.flash = null;
    this.typing = false;
    this.address = InputState.new({ placeholder: "Enter an address" });
    this.address.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.address.on("blur", (_e, cx) => {
      this.typing = false;
      this.address.set_value(shown(this.live));
      cx.notify();
    });
    this.address.on("submit", (_e, cx) => {
      const typed = this.address.value().trim();
      if (typed) act(this.terminal, "navigate", { url: typed });
      run("pane.focus", { pane: props()?.pane });
      cx.notify();
    });
    if (!this.terminal) return;
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (!this.live || focused()?.pane !== props()?.pane) continue;
        if (c === "dev" && /^https?:/.test(this.live.url)) openDev(this.live.url);
        if (c === "inspect" && this.live.inspect) openApp(this.live.inspect);
      }
    });
    cx.spawn(async (cx) => { await this.reload(cx); });
    watchLive(cx, this, async (changed, cx) => {
      if (touches(changed, this.terminal)) await this.reload(cx);
    });
  }

  async close() {
    this.closed = true;
    if (!this.live) return;
    this.hideNotes();
    await act(this.terminal, "native", { on: false });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  async reload(cx) {
    const live = await readLive(this.terminal);
    if (this.closed) return; // closing gave the toolbar back: don't take it again
    const before = this.live;
    this.live = live;
    if (!live) { if (before) cx.notify(); return; }
    // A focused field keeps what the user typed, but follows the page while it
    // still shows the old address.
    if (!this.typing || this.address.value() === shown(before)) this.address.set_value(shown(live));
    if (!before && live.url === "about:blank") this.address.focus();
    if (before && live.addressSeq > (before.addressSeq || 0)) {
      this.address.focus();
      const text = this.address.value();
      this.address.set_selected_range({ start: 0, end: text.length });
    }
    if (before && live.toast && live.toast.seq !== before.toast?.seq) {
      const flash = live.toast;
      this.flash = flash;
      cx.timer.after(4000, (cx) => { if (this.flash === flash) { this.flash = null; cx.notify(); } });
    }
    this.follow(cx);
    if (live.annotating && !before?.annotating) this.showNotes();
    if (!live.annotating && before?.annotating) this.hideNotes();
    cx.notify();
    // This header draws the toolbar, so the terminal draws only the page. The
    // helper may be restarting: ask again until it takes.
    if (!live.native && !this.claiming && !this.closed) {
      this.claiming = true;
      const ok = await act(this.terminal, "native", { on: true });
      this.claiming = false;
      // Closed while the claim was on its way: give the toolbar back again.
      if (this.closed) { if (ok) await act(this.terminal, "native", { on: false }); return; }
      if (!ok) cx.timer.after(2000, (cx) => cx.spawn(async (cx) => { if (!this.closed) await this.reload(cx); }));
    }
  }

  // Watches the folder a local page is served from and reloads on save. A
  // page being annotated is left alone: a reload would drop the pick.
  async follow(cx) {
    const host = servedBy(this.live);
    if (host === this.served) return;
    this.served = host;
    this.watch = null;
    if (!host) return;
    const text = await readTextFile(`${home()}/.local/share/herdr-browser/state/folders.json`).catch(() => null);
    let folder = null;
    try { folder = JSON.parse(text)[host]; } catch {}
    // /tmp is everyone's: other programs' files there would reload the page.
    if (!folder || folder === "/tmp" || this.served !== host) return;
    // Only the newest watch reloads: one left from an earlier page ends on its next change.
    const watch = this.watch = {};
    cx.spawn(async () => {
      for (;;) {
        let changed;
        // A tree too large to watch rejects: that page just doesn't auto-reload.
        try { changed = await watchFolder(folder); } catch { return; }
        if (this.closed || this.watch !== watch) return;
        if (this.live?.annotating || !changed.some((p) => p === folder || PAGE_FILE.test(p))) continue;
        act(this.terminal, "reload");
      }
    });
  }

  // The notes live in the layout's right-hand stack while annotating; the
  // panel goes back to what it showed before afterwards.
  showNotes() {
    if (shared("browser.notes") !== this.terminal) {
      const panel = findNode(layout(), "panel");
      const stack = findNode(layout(), "panel-body");
      if (!findNode(layout(), "browser-notes")) return;
      if (!shared("browser.notes")) this.before = { hidden: !!panel?.hidden, active: stack?.active || "files" };
      setShared("browser.notes", this.terminal);
    }
    run("layout.select", { stack: "panel-body", child: "browser-notes" });
    run("layout.show", { id: "panel" });
  }

  hideNotes() {
    if (shared("browser.notes") !== this.terminal) return;
    setShared("browser.notes", null);
    const before = this.before || { hidden: true, active: "files" };
    if (before.active !== "browser-notes") run("layout.select", { stack: "panel-body", child: before.active });
    if (before.hidden) run("layout.hide", { id: "panel" });
  }

  // A tab's only pane has nothing to zoom over.
  alone(p) {
    return panes().filter((other) => other.tab === p.tab).length === 1;
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(0)
      .border_1()
      .border_color(t.surface)
      .text_color(t.dim)
      .hover((s) => s.bg(t.foreground + "14").border_color(t.foreground + "40").text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/omarchy-pane/${icon}.svg`).size(14));
  }

  // A 24 px toolbar button: an icon, or an icon and a label.
  tool(t, id, name, enabled, onClick, label, style) {
    const el = h_flex()
      .id(id)
      .h(24)
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(0)
      .border_1()
      .border_color(t.surface)
      .gap(4)
      .text_color(enabled ? t.foreground : t.dim);
    const sized = label ? el.px(6) : el.w(24);
    const built = sized
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(t.foreground + "14").border_color(t.foreground + "40")).on_click((_e, cx) => {
        cx.stop_propagation();
        onClick(cx);
      }))
      .child(svg(`${BROWSER}/${name}.svg`).size(label ? 13 : 14))
      .when(Boolean(label), (e) => e.child(label));
    return style ? style(built) : built;
  }

  browserHeader(t, p) {
    const live = this.live;
    const pane = p.pane;
    const term = this.terminal;
    const page = live.url && live.url !== "about:blank";
    const armed = live.annotating;
    const notes = live.notes?.length || 0;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(6)
      .gap(4)
      .items_center()
      .bg(t.surface)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .child(this.tool(t, `bh-back-${pane}`, "arrow-left", live.back, () => act(term, "back")))
      .child(this.tool(t, `bh-fwd-${pane}`, "arrow-right", live.forward, () => act(term, "forward")))
      .child(live.loading
        ? this.tool(t, `bh-stop-${pane}`, "close", true, () => act(term, "stop"))
        : this.tool(t, `bh-reload-${pane}`, "refresh", page, () => act(term, "reload")))
      .child(h_flex()
        .id(`bh-address-${pane}`)
        .flex_1()
        .min_w(0)
        .h(24)
        .px(8)
        .items_center()
        .rounded(0)
        .border_1()
        .border_color(this.typing ? t.accent : t.border)
        .bg(t.background)
        .cursor_text()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => cx.stop_propagation())
        .on_key_down((e, cx) => {
          if (e.key !== "escape") return;
          this.address.set_value(shown(this.live));
          run("pane.focus", { pane });
          cx.notify();
        })
        .child(Input.new(this.address).w_full().text_size(12).text_color(t.foreground)))
      .when(Boolean(this.flash), (el) => el.child(div()
        .flex_none()
        .max_w(240)
        .truncate()
        .px(4)
        .text_color(this.flash.error ? t.blocked : t.accent)
        .child(this.flash.message)))
      .when(live.zoom && live.zoom !== 100, (el) => el.child(h_flex()
        .id(`bh-zoom-${pane}`)
        .h(24)
        .px(6)
        .flex_none()
        .items_center()
        .rounded(0)
        .cursor_pointer()
        .text_color(t.foreground)
        .hover((s) => s.bg(t.foreground + "14").border_color(t.foreground + "40"))
        .on_click((_e, cx) => { cx.stop_propagation(); act(term, "zoom", { zoom: 100 }); })
        .child(`${live.zoom}%`)))
      .child(this.tool(t, `bh-annotate-${pane}`, "pencil", page, () => act(term, "annotate", { on: !armed }), "Annotate",
        (el) => (armed ? el.bg(t.accent + "38") : el)
          // Unsent notes wait while the panel is closed: show how many.
          .when(!armed && notes > 0, (e) => e.child(div().h(16).min_w(16).px(4).rounded(0).flex().items_center().justify_center()
            .bg(t.ansi3).text_color(t.background).text_size(10).font_semibold().child(String(notes))))))
      // DevTools on the page shown here; the count is its console errors.
      .child(this.tool(t, `bh-inspect-${pane}`, "bug", Boolean(live.inspect), () => openApp(live.inspect), live.errors ? String(live.errors) : null,
        (el) => (live.errors ? el.text_color(t.blocked) : el)))
      .child(this.tool(t, `bh-dev-${pane}`, "code", page && /^https?:/.test(live.url), () => openDev(live.url)))
      .child(this.tool(t, `bh-open-${pane}`, "external", page && /^https?:/.test(live.url), () => openOutside(live.url)))
      // The pane controls show on hover in room kept for them, so the
      // toolbar doesn't shift under the pointer.
      .child(h_flex().w(101).flex_none().gap(4).items_center()
        .when(p.zoomed, (el) => el.justify_end()
          .child(this.button(t, `ph-z-${pane}`, "unzoom", "pane.zoom", { pane })))
        .when(this.hovered && !p.zoomed, (el) => el
          .child(div().w(1).h(16).mx(2).flex_none().bg(t.border))
          .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
          .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
          .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane }))
          .when(!this.alone(p), (e) => e.child(this.button(t, `ph-z-${pane}`, "zoom", "pane.zoom", { pane })))));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    if (this.live && p.terminal === this.terminal) return this.browserHeader(t, p);
    // The icon names the program; the header says what it works on: its title, else the folder.
    const clean = (p.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
    // A shell's title is often just its terminal address ("t4c"), which says nothing either.
    const own = clean && clean !== p.program?.name && clean !== "Claude Code" && clean !== p.terminal ? clean : "";
    const name = own || folder(p.cwd).split("/").pop() || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd) !== name ? folder(p.cwd) : ""))
      .when(st === "working", el => el.child(svg("mods/omarchy-pane/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(0).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(0).bg(t.done)))
      // A zoomed pane shows only its unzoom button, always.
      .when(p.zoomed, el => el.child(this.button(t, `ph-z-${pane}`, "unzoom", "pane.zoom", { pane })))
      .when(this.hovered && !p.zoomed, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane }))
        .when(!this.alone(p), (e) => e.child(this.button(t, `ph-z-${pane}`, "zoom", "pane.zoom", { pane }))));
  }
}
