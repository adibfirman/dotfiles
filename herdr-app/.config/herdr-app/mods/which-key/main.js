// Which key: the ctrl-s prefix. keys.json binds ctrl-s to mod.open:which-key.
// Nothing shows: mod.json opens this mod as a 1 px window with no frame, which only holds
// the keyboard for the next key. It is a window, not a popup, because Herdr closes a popup
// on Escape before the mod sees the key. One key runs one action from map.json, then the
// window closes. "w" starts repeat mode: its keys keep working until Escape or Enter.
// Escape or an unknown key closes the window and runs nothing. At the top level, Escape
// also sends "close" to forge-runs, which closes a peek and the forge run window. ctrl-s
// again (keys.json "mod:which-key" section) sends a literal ctrl-s to the focused terminal.

import { View, div } from "gpui-kit";
import { run, hc, focused, props, closeOverlay, openOverlay, nextCommand, readTextFile, appHome, notify, setShared } from "herdr";

// macOS can report a shifted digit as its symbol. Map it back to "shift-<digit>".
const SHIFTED = { "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0" };

// One map.json entry as [keystroke, entry] pairs. "digits" makes 9 keys with args.index 1..9.
function expand(entry) {
  if (entry.digits !== undefined) {
    const out = [];
    for (let n = 1; n <= 9; n++) out.push([`${entry.digits}${n}`, { ...entry, args: { ...(entry.args ?? {}), index: n } }]);
    return out;
  }
  return (entry.keys ?? []).map((k) => [k, entry]);
}

// The keystrokes a key event can match, most exact first.
function candidates(e) {
  const out = [e.keystroke];
  if (e.modifiers.shift && !e.keystroke.startsWith("shift-")) out.push(`shift-${e.key}`);
  const bare = e.keystroke.replace(/^shift-/, "");
  // "shift-?" means "?": a shifted symbol already carries the shift.
  if (bare !== e.keystroke && /^[^a-z0-9]$/i.test(bare)) out.push(bare);
  if (SHIFTED[bare]) out.push(`shift-${SHIFTED[bare]}`);
  if (e.key_char && SHIFTED[e.key_char]) out.push(`shift-${SHIFTED[e.key_char]}`);
  return out;
}

export default class WhichKey extends View {
  init(_props, cx) {
    this.map = null;
    this.error = null;
    this.mode = null;
    this.pending = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(100, () => this.handle.focus());
    // Nothing shows, so a forgotten prefix must not wait for a key forever. At the top level every key closes
    // the window or starts repeat mode, so a window still at the top level after 4 s got no key.
    cx.timer.after(4000, () => {
      if (!this.mode) this.close();
    });
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${appHome()}/mods/which-key/map.json`);
        this.map = JSON.parse(text ?? "");
      } catch (err) {
        this.error = `map.json: ${err}`;
        notify({ title: "Which key", body: this.error, level: "error" });
      }
      // A key pressed before the map loaded runs now.
      if (this.pending) {
        const e = this.pending;
        this.pending = null;
        this.handle_key(e, cx);
      }
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "literal") await this.literal();
        cx.notify();
      }
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  // Sends ctrl-s to the focused terminal, like the prefix pressed twice in terminal herdr.
  async literal() {
    const t = focused()?.terminal;
    // Start hc before close: closing the popup can cancel this task.
    const sent = t ? hc(["keys", t, "ctrl+s"]) : null;
    this.close();
    if (!sent) return;
    const r = await sent;
    if (r.code !== 0) notify({ title: "Which key", body: r.stderr.trim() || "could not send ctrl-s" });
  }

  table() {
    const entries = this.mode ? this.map.modes[this.mode].keys : this.map.groups.flatMap((g) => g.keys);
    return new Map(entries.flatMap(expand));
  }

  act(entry, cx) {
    if (entry.mode) {
      this.mode = entry.mode;
      notify({ title: "ctrl-s: repeat mode", body: "Esc or Enter to leave" });
      return;
    }
    if (!this.mode) this.close();
    if (entry.worktree) {
      const space = focused()?.space;
      openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space, action: entry.worktree } });
    } else if (entry.copy === "terminal") {
      this.copyTerminal(cx);
    } else if (entry.command) {
      run(entry.command, entry.args ?? {});
    }
    // In repeat mode the popup stays open: take the keyboard back after the move.
    if (this.mode) {
      try {
        cx.timer.after(50, () => this.handle.focus());
      } catch {
        this.handle.focus();
      }
    }
  }

  // Copies the focused terminal's hc address (for example t1g), like herdr's prefix+shift+i.
  copyTerminal(cx) {
    const address = focused()?.terminal;
    if (!address) {
      notify({ title: "No terminal to copy", level: "warning" });
      return;
    }
    // Tell copy-toast that this copy shows its own toast.
    setShared("copy-toast.handled", Date.now());
    cx.write_to_clipboard(address);
    notify({ title: "Pane copied", body: address, level: "success" });
  }

  handle_key(e, cx) {
    if (e.key === "escape" && !this.mode) {
      // ctrl-s then escape closes the forge run window. Send before close: closing the popup can cancel this code.
      // With no window open, forge-runs does nothing. A layout without forge-runs must not break Escape.
      try {
        run("forge-runs.close");
      } catch {
        // no forge-runs in this layout
      }
      return this.close();
    }
    if (e.key === "escape" || (this.mode && e.key === "enter")) return this.close();
    if (this.error) return this.close();
    const table = this.table();
    const hit = candidates(e).map((k) => table.get(k)).find(Boolean);
    if (hit) this.act(hit, cx);
    else this.close();
  }

  key(e, cx) {
    if (!this.map && !this.error && e.key !== "escape") this.pending = e;
    else this.handle_key(e, cx);
    cx.stop_propagation();
    cx.notify();
  }

  // Nothing to see: the 1 px window only holds the keyboard for the next key.
  render() {
    return div().id("which-key").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx)).size_full();
  }
}
