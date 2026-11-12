// The notes of the herdr-browser page being annotated, in the layout's
// right-hand stack (the browser-pane header shows it while annotating), in the
// look of Herdr UI's browser notes: the composer for a pick, numbered notes
// with their screenshots, and Send to agent / Copy.
//
// Which page: shared("browser.notes"), the terminal that shows it.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, shared, run } from "herdr";
import { act, readLive, watchLive, touches } from "./client.js";

export default class BrowserNotes extends View {
  init(_props, cx) {
    this.terminal = null;
    this.live = null;
    this.editing = null; // the id of the note being edited, or "page" for a new note on the whole page
    this.typing = false;
    this.input = InputState.new({ placeholder: "Describe the change" });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.save(cx));
    watchLive(cx, this, async (changed, cx) => {
      if (this.terminal && touches(changed, this.terminal)) await this.reload(cx);
    });
  }

  close() { this.closed = true; }

  async reload(cx) {
    const terminal = this.terminal;
    const live = await readLive(terminal);
    // The panel moved to another page while this was read: drop it.
    if (terminal !== this.terminal) return;
    const pickBefore = this.live?.pick;
    this.live = live;
    // A new pick opens the composer with the keyboard on it.
    if (live?.pick && (!pickBefore || pickBefore.shot !== live.pick.shot || pickBefore.label !== live.pick.label)) {
      this.editing = null;
      this.input.set_value("");
      this.input.focus();
    }
    if (!live?.pick && this.editing === null) this.input.set_value("");
    // The note being edited was removed, or sent with the rest.
    if (typeof this.editing === "number" && !this.note(this.editing)) {
      this.editing = null;
      this.input.set_value("");
    }
    cx.notify();
  }

  note(id) { return this.live?.notes?.find((n) => n.id === id) || null; }

  // Follows the page the header asked for; render notices the change.
  follow(cx) {
    const want = shared("browser.notes") || this.terminal;
    if (want === this.terminal) return;
    this.terminal = want;
    this.editing = null;
    this.live = null;
    cx.spawn(async (cx) => { await this.reload(cx); });
  }

  save(cx) {
    const comment = this.input.value().trim();
    if (!comment) return;
    const editing = this.editing, terminal = this.terminal;
    this.editing = null;
    this.input.set_value("");
    run("pane.focus", { terminal });
    cx.notify();
    // The helper didn't take it (stopped, restarting): the text comes back.
    cx.spawn(async (cx) => {
      const ok = typeof editing === "number"
        ? await act(terminal, "edit", { id: editing, comment })
        : await act(terminal, "note", { comment });
      if (ok || this.terminal !== terminal || this.input.value().trim()) return;
      this.input.set_value(comment);
      this.editing = editing;
      cx.notify();
    });
  }

  cancel(cx) {
    if (this.live?.pick) act(this.terminal, "cancelPick");
    this.editing = null;
    this.input.set_value("");
    run("pane.focus", { terminal: this.terminal });
    cx.notify();
  }

  edit(id, cx) {
    const note = this.note(id);
    if (!note) return;
    this.editing = id;
    this.input.set_value(note.comment || "");
    this.input.focus();
    cx.notify();
  }

  textButton(t, id, label, primary, onClick) {
    return div()
      .id(id)
      .px(8)
      .h(24)
      .flex()
      .flex_none()
      .items_center()
      .rounded(0)
      .cursor_pointer()
      .text_size(12)
      .bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground)
      .hover((s) => s.opacity(0.85))
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .child(label);
  }

  // Screenshots are drawn from browser-shots/ in Herdr's folder, where the
  // helper saves them (image() only reads inside Herdr's folder).
  thumb(t, shot, size) {
    const name = shot.split(/[\\/]/).pop(); // a Windows path has backslashes
    const [w, h] = size || [320, 96];
    const room = Math.max(80, (this.width || 360) - 60);
    const k = Math.min(1, room / w, 96 / h);
    return h_flex().flex_none()
      .child(image(`browser-shots/${name}`).flex_none().w(Math.round(w * k)).h(Math.round(h * k))
        .rounded(0).border_1().border_color(t.border));
  }

  composer(t, live) {
    const editing = typeof this.editing === "number" ? this.note(this.editing) : null;
    const label = editing ? editing.label : live.pick ? live.pick.label : "Whole page";
    const shot = editing ? editing.shot : live.pick?.shot;
    const size = editing ? editing.size : live.pick?.size;
    return v_flex()
      .flex_none()
      .gap(6)
      .p(10)
      .border_b(1)
      .border_color(t.border)
      .child(div().truncate().text_color(t.dim).text_size(12).child(label))
      .when(Boolean(shot), (el) => el.child(this.thumb(t, shot, size)))
      .child(h_flex()
        .id("note-input")
        .h(30)
        .px(10)
        .items_center()
        .rounded(0)
        .border_1()
        .border_color(this.typing ? t.accent : t.border)
        .bg(t.background)
        .cursor_text()
        .on_key_down((e, cx) => { if (e.key === "escape") this.cancel(cx); })
        .child(Input.new(this.input).w_full().text_size(12.5).text_color(t.foreground)))
      .child(h_flex().gap(6).justify_end()
        .child(this.textButton(t, "note-cancel", "Cancel", false, (cx) => this.cancel(cx)))
        .child(this.textButton(t, "note-save", editing ? "Save note" : "Add note", true, (cx) => this.save(cx))));
  }

  row(t, note, i) {
    return h_flex()
      .id(`note-${i}`)
      .flex_none()
      .items_start()
      .gap(8)
      .p(10)
      .border_b(1)
      .border_color(t.border)
      .when(this.editing === note.id, (el) => el.bg(t.selected))
      .child(div().size(18).flex_none().rounded(0).flex().items_center().justify_center()
        .bg(t.ansi3).text_color(t.background).text_size(10.5).font_semibold().child(String(note.number)))
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().truncate().text_color(t.dim).text_size(12).child(note.label))
        .child(div().id(`note-text-${i}`).cursor_text().text_color(note.comment ? t.foreground : t.dim)
          .on_click((_e, cx) => this.edit(note.id, cx))
          .child(note.comment || "Add a note…"))
        .when(Boolean(note.shot), (el) => el.child(this.thumb(t, note.shot, note.size))))
      .child(div().id(`note-x-${i}`).size(18).flex_none().flex().items_center().justify_center().rounded(0)
        .cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.foreground + "14").border_color(t.foreground + "40").text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (this.editing === note.id) this.editing = null;
          act(this.terminal, "remove", { id: note.id });
        })
        .child(svg("mods/omarchy-browser/close.svg").size(12)));
  }

  render(cx) {
    this.follow(cx);
    const t = theme();
    const live = this.live;
    const notes = live?.notes || [];
    const composing = live && (live.pick || this.editing !== null);
    const frame = v_flex().id("browser-notes").on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } }).size_full().min_h(0).rounded(0).overflow_hidden()
      .bg(t.background).text_color(t.foreground).text_size(13);
    if (!live) {
      return frame.child(div().p(12).text_color(t.dim).child("Annotate a browser page to take notes on it."));
    }
    const region = live.mode === "region";
    return frame
      .child(h_flex().flex_none().h(44).px(12).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().child("Notes"))
        .child(this.textButton(t, "notes-region", "Region", region, () => act(this.terminal, "annotate", { on: true, mode: region ? "pick" : "region" })))
        .child(this.textButton(t, "notes-page", "Note on page", false, (cx) => {
          if (live.pick) act(this.terminal, "cancelPick");
          this.editing = "page";
          this.input.set_value("");
          this.input.focus();
          cx.notify();
        })))
      .when(Boolean(composing), (el) => el.child(this.composer(t, live)))
      .child(v_flex().id("notes-list").flex_1().min_h(0).overflow_y_scrollbar()
        .children(notes.map((n, i) => this.row(t, n, i)))
        .when(!notes.length && !composing, (el) => el.child(div().p(12).text_color(t.dim)
          .child(live.annotating
            ? "Click an element, select text, or switch to Region and drag over the page, then describe the change."
            : "Click Annotate in the page's toolbar to take notes on it."))))
      .when(notes.length > 0, (el) => el.child(h_flex().flex_none().gap(6).p(10).border_t(1).border_color(t.border)
        .child(div().flex_1().text_color(t.dim).text_size(12).child(live.owner ? "" : "No agent opened this page"))
        .child(this.textButton(t, "notes-copy", "Copy", !live.owner, () => act(this.terminal, "copy")))
        .when(Boolean(live.owner), (e) => e.child(this.textButton(t, "notes-send", "Send to agent", true, () => act(this.terminal, "send"))))));
  }
}
