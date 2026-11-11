// copy-on-select: copy a terminal selection when the left mouse button comes
// up, like terminal herdr. Written from the gallery recipe "Copy Selected Text
// to Clipboard" (jspoynor/herdr-copy-on-select, RECIPE.md).
//
// Mods see mouse presses, not releases. This mod is a 0px block, so every press
// in the window is a press outside it (on_mouse_down_out). On a left press it
// asks macOS, through one osascript, to wait for the release. Then it runs
// terminal.copy if the press was a drag or a double/triple click.
// Cmd, Ctrl or Option on the press skips it. macOS only.
//
// Runs programs: osascript.

import { View, div } from "gpui-kit";
import { focused, run, notify, exec } from "herdr";

const DRAG_PX = 4; // movement that counts as a drag, not a click
const WATCH_MS = 40;

// JavaScript for Automation: wait until the left button is up, at most about 60 s.
const WAIT_FOR_RELEASE = [
  'ObjC.import("AppKit");',
  "var n = 0;",
  "while (($.NSEvent.pressedMouseButtons & 1) && n < 3000) { delay(0.02); n++; }",
  '"up"',
].join(" ");

export default class CopyOnSelect extends View {
  init(_props, _cx) {
    this.press = 0; // goes up on every press, so an older wait is ignored
  }

  onPress(event, cx) {
    if (event.button !== "left") return;
    const m = event.modifiers;
    if (m.platform || m.control || m.alt) return;

    const press = ++this.press;
    const from = event.position;
    const multiClick = event.click_count >= 2; // word or line selection
    const moved = () => {
      const p = window.mouse_position();
      return Math.abs(p.x - from.x) > DRAG_PX || Math.abs(p.y - from.y) > DRAG_PX;
    };
    let dragged = false;
    const watch = cx.timer.every(WATCH_MS, () => {
      if (moved()) dragged = true;
    });

    cx.spawn(async (_cx) => {
      try {
        await exec("osascript", ["-l", "JavaScript", "-e", WAIT_FOR_RELEASE], { timeout: 65000 });
      } catch (_) {
        // Treat a failed wait as a release.
      }
      watch.cancel();
      if (press !== this.press) return; // a newer press took over
      if (moved()) dragged = true;
      if (!dragged && !multiClick) return;
      if (!focused()?.terminal) return;
      run("terminal.copy");
      notify({ title: "Copied", level: "success", timeout: 1500 });
    });
  }

  render(_cx) {
    return div()
      .id("copy-on-select")
      .size_full()
      .on_mouse_down_out((event, cx) => this.onPress(event, cx));
  }
}
