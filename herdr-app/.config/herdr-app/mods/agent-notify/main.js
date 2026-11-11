// agent-notify: Herdr's toast, plus the same alert in macOS Notification Center.
//
// Based on the `toast` mod shipped with Herdr (herdr-app, Apache License 2.0).
// Changed in this dotfiles repo: init() also sends a toast that has a click
// action (Herdr's own agent alerts: "needs you", "finished") to macOS through
// terminal-notifier. A click on the macOS notification brings Herdr to the
// front and runs the same action with `herdr-app do`. Toasts without an action
// (for example "Copied") stay in the app. The in-app toast is unchanged.
//
// Runs programs: which, terminal-notifier.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, exec } from "herdr";

const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };
const APP_ID = "dev.herdr.app";

// Quotes one word for /bin/sh.
const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// terminal-notifier needs a leading "-" or "[" escaped.
const plain = (s) => (/^[-[]/.test(s) ? `\\${s}` : s);

// A click on the macOS notification runs in a new process with a short PATH,
// so the command needs the full path to herdr-app.
async function herdrApp() {
  const r = await exec("/usr/bin/which", ["herdr-app"]);
  return r.code === 0 ? r.stdout.trim() : "herdr-app";
}

async function toSystem(p) {
  const a = p.action;
  if (!a?.name) return;
  const title = p.title || "Herdr";
  const cli = await herdrApp();
  await exec("terminal-notifier", [
    "-title", plain(title),
    "-message", plain(p.body || title),
    "-group", `herdr:${a.args?.terminal ?? title}`,
    "-activate", APP_ID,
    "-execute", `${sh(cli)} do ${sh(a.name)} ${sh(JSON.stringify(a.args ?? {}))}`,
  ], { timeout: 10000 });
}

export default class AgentNotify extends View {
  init(_props, cx) {
    const p = props() ?? {};
    cx.spawn(async (_cx) => {
      try {
        await toSystem(p);
      } catch (_) {
        // terminal-notifier is missing or failed: the in-app toast still shows.
      }
    });
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    return h_flex()
      .id("toast")
      .size_full()
      .px(18)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .child(p.icon ? image(p.icon).w(18).h(18).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[p.level] ?? "accent"]))
      .child(
        v_flex()
          .flex_1()
          .overflow_hidden()
          .child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(login ? `${login[1]} needs a login: run` : p.title ?? ""))
          .when(!login && Boolean(p.body), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(p.body ?? "")))
          .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(12).text_color(t.muted).child(command))
            .child(div().id("toast-login-copy").flex_none().px(6).py(3).rounded(4).bg(t.raised)
              .text_size(12).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
              .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
              .child(this.copied ? "Copied" : "Copy")))),
      );
  }
}
