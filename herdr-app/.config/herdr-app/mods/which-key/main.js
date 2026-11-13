// Which key: the ctrl-s prefix popup. keys.json binds ctrl-s to mod.open:which-key.
// One key runs one action from map.json, then the popup closes. "w" starts repeat
// mode: its keys keep working until Escape or Enter. Escape or an unknown key
// closes the popup and runs nothing. ctrl-s again (keys.json "mod:which-key"
// section) sends a literal ctrl-s to the focused terminal.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, hc, focused, props, closeOverlay, openOverlay, nextCommand, readTextFile, appHome, theme, notify, setShared } from "herdr";

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

// The key text shown for an entry.
function shown(entry) {
  if (entry.display) return entry.display;
  if (entry.digits !== undefined) return `${entry.digits}1..9`;
  return (entry.keys ?? []).join(" / ");
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
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${appHome()}/mods/which-key/map.json`);
        this.map = JSON.parse(text ?? "");
      } catch (err) {
        this.error = `map.json: ${err}`;
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

  render() {
    const t = theme();
    const row = (entry) =>
      h_flex()
        .gap(10)
        .items_center()
        .text_size(12.5)
        .child(div().w(96).flex_none().px(6).py(1).rounded(5).bg(t.raised).text_color(t.accent).child(shown(entry)))
        .child(div().flex_1().truncate().text_color(t.muted).child(entry.label));
    const group = (g) =>
      v_flex().gap(4).child(div().text_size(11).font_semibold().text_color(t.dim).child(g.name.toUpperCase())).children(g.keys.map(row));
    const column = (n) => v_flex().flex_1().gap(14).children(this.map.groups.filter((g) => (g.column ?? 1) === n).map(group));
    let body;
    if (this.error) body = div().text_color(t.blocked).child(this.error);
    else if (!this.map) body = div().text_color(t.dim).child("Loading…");
    else if (this.mode) body = group(this.map.modes[this.mode]);
    else body = h_flex().gap(24).items_start().child(column(1)).child(column(2));
    return v_flex()
      .id("which-key")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .w_full()
      .min_h(0)
      .p(18)
      .gap(14)
      .bg(t.popover)
      .text_size(13)
      .child(
        h_flex()
          .items_center()
          .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(this.mode ? "ctrl-s · repeat mode" : "ctrl-s"))
          .child(div().text_size(11).text_color(t.dim).child(this.mode ? "Esc or Enter to leave" : "Esc to close")),
      )
      .child(body);
  }
}
