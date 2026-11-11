// copy-toast: shows a "Copied" toast after a terminal selection is copied.
//
// Herdr copies a terminal selection by itself when the mouse button comes up
// (herdr-app src/terminal.rs, "Copy on select"), but shows no toast. Mods see
// mouse presses, not releases. This mod is a 0px block, so every press in the
// window is a press outside it (on_mouse_down_out). After a left press it reads
// the clipboard every 100 ms. When the text changes, it shows "Copied" and
// stops. It also stops after 30 s or at the next press. It never writes the
// clipboard. Copying the same text again shows no toast.

import { View, div } from "gpui-kit";
import { notify } from "herdr";

const POLL_MS = 100;
const MAX_MS = 30000;

export default class CopyToast extends View {
  init(_props, _cx) {
    this.watch = null;
  }

  stop() {
    this.watch?.cancel();
    this.watch = null;
  }

  onPress(event, cx) {
    if (event.button !== "left") return;
    this.stop();
    const before = cx.read_from_clipboard();
    const started = Date.now();
    this.watch = cx.timer.every(POLL_MS, (cx) => {
      if (cx.read_from_clipboard() !== before) {
        this.stop();
        notify({ title: "Copied", level: "success", timeout: 1500 });
      } else if (Date.now() - started > MAX_MS) {
        this.stop();
      }
    });
  }

  async close(_cx) {
    this.stop();
  }

  render(_cx) {
    return div()
      .id("copy-toast")
      .size_full()
      .on_mouse_down_out((event, cx) => this.onPress(event, cx));
  }
}
