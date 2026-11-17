// worktree-delete: the dialog behind a worktree row's trash button in the spaces list. It shows what a delete
// loses (the changed files, with +/- lines) and refuses while a pane is open in the worktree or a forge run works
// in it. Delete removes the folder and its git record; the branch stays. herdr removes the worktrees it knows (its
// workspace goes too), git the rest. Changes not committed need the red "Delete with N changes" (--force).
// Opened as: openOverlay({ mod: "worktree-delete", kind: "dialog", props: { path, branch } }).
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme, exec, home, panes, notify, setShared } from "herdr";

const MAX = 50;
const inside = (cwd, dir) => cwd === dir || (cwd ?? "").startsWith(`${dir}/`);
const alpha = (hex, a) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(a * 255).toString(16).padStart(2, "0") : hex);

// git status --porcelain and git diff --numstat HEAD -> [{ status, file, add, del }]. A new file is "new" with no
// counts; a binary file shows "-" counts, as git prints them.
async function changes(path) {
  const st = await exec("git", ["--no-optional-locks", "status", "--porcelain"], { cwd: path });
  if (st.code !== 0) throw new Error((st.stderr || "git status failed").trim());
  const num = await exec("git", ["diff", "--numstat", "HEAD"], { cwd: path });
  const counts = new Map();
  for (const line of (num.code === 0 ? num.stdout : "").split("\n").filter(Boolean)) {
    const [add, del, ...rest] = line.split("\t");
    counts.set(rest.join("\t"), { add, del });
  }
  return st.stdout.split("\n").filter(Boolean).map((line) => {
    const code = line.slice(0, 2);
    const file = line.slice(3).replace(/^.* -> /, "");
    const status = code === "??" ? "new" : code.includes("D") ? "D" : code.includes("A") ? "A" : code.includes("R") ? "R" : "M";
    const c = counts.get(file);
    return { status, file, add: c?.add ?? null, del: c?.del ?? null };
  });
}

// Why the worktree cannot go now, or null: a pane open in it, or a forge run working in it.
async function blocker(path) {
  if (panes().some((p) => inside(p.cwd, path))) return "A space or pane is open in it. Close it first.";
  const fr = await exec(`${home()}/.local/bin/forge`, ["runs"], { cwd: path }).catch(() => null);
  const runs = fr?.code === 0 ? JSON.parse(fr.stdout || "[]") : [];
  const used = runs.find((f) => f.worktree === path || (f.repos ?? []).some((x) => x.worktree === path));
  return used ? `Forge run ${used.ticket} works in it. Remove the run in projects first.` : null;
}

export default class WorktreeDelete extends View {
  init(_props, cx) {
    const p = props() ?? {};
    Object.assign(this, { path: p.path, branch: p.branch ?? "", overlay: p.overlay, rows: null, blocked: null, error: null, busy: false });
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.load(cx);
  }

  // What a delete would lose, and whether something still uses the worktree.
  load(cx) {
    cx.spawn(async (cx) => {
      try {
        this.blocked = await blocker(this.path);
        this.rows = await changes(this.path);
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  close() {
    closeOverlay(this.overlay);
  }

  // Checked again first: when the list changed since it showed, the new list shows and Delete waits for another click.
  remove(cx) {
    if (this.busy || this.blocked || !this.rows) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let done = false;
      try {
        this.blocked = await blocker(this.path);
        const now = await changes(this.path);
        const same = JSON.stringify(now) === JSON.stringify(this.rows);
        this.rows = now;
        if (this.blocked) return;
        if (!same) {
          this.error = "The changes moved since this opened. Check the list, then delete again.";
          return;
        }
        const force = now.length ? ["--force"] : [];
        const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: this.path });
        const repo = common.stdout.trim().replace(/\/\.git\/?$/, "");
        const herdr = `${home()}/.local/bin/herdr`;
        const list = await exec(herdr, ["worktree", "list", "--cwd", repo, "--json"]).catch(() => null);
        let ws = null;
        try {
          ws = (JSON.parse(list?.stdout || "{}").result?.worktrees ?? []).find((x) => x.path === this.path)?.open_workspace_id ?? null;
        } catch {}
        const rm = ws
          ? await exec(herdr, ["worktree", "remove", "--workspace", ws, ...force])
          : await exec("git", ["worktree", "remove", ...force, this.path], { cwd: repo });
        if (rm.code !== 0) {
          this.error = (rm.stderr || rm.stdout || "remove failed").trim();
          return;
        }
        setShared("spaces.lookAgain", Date.now());
        notify({ title: `Worktree ${this.branch} deleted`, body: `${this.path}. The branch stays.`, level: "success" });
        done = true;
        this.close();
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        this.busy = false;
        if (!done) cx.notify();
      }
    });
  }

  render(cx) {
    const t = theme();
    const rows = this.rows ?? [];
    const n = rows.length;
    const ready = this.rows !== null && !this.blocked && !this.busy;
    const tone = { M: t.working, A: t.done, new: t.done, D: t.blocked, R: t.accent };
    const button = (id, label, bg, fg, on, f) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1().border_color(id === "wd-no" ? t.input : bg).bg(bg).text_color(fg)
      .when(on, (e) => e.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => f(cx)))
      .when(!on, (e) => e.opacity(0.4))
      .child(label);
    return v_flex()
      .id("worktree-delete")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        // Enter deletes only when nothing is lost; with changes, the red button needs a click.
        if (e.key === "escape") this.close();
        else if (e.key === "enter" && this.rows?.length === 0) this.remove(cx);
        else return;
        cx.stop_propagation();
      })
      .size_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .rounded(8)
      .bg(t.popover)
      .text_size(13)
      .child(h_flex().items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(`Delete worktree ${this.branch}?`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_color(t.muted).child(`Deletes ${this.path} and its git record. The branch ${this.branch} stays.`))
      .when(this.rows === null && !this.error, (e) => e.child(div().text_color(t.dim).child("Checking…")))
      .when(Boolean(this.blocked), (e) => e.child(div().p(8).rounded(6).bg(alpha(t.blocked, 0.12)).text_color(t.blocked).child(this.blocked)))
      .when(n > 0, (e) => e
        .child(div().text_color(t.blocked).child(`${n} file${n === 1 ? "" : "s"} changed and not committed. They will be lost:`))
        .child(v_flex().id("wd-files").flex_1().min_h(0).overflow_y_scrollbar().p(6).rounded(6).bg(t.raised).text_size(11.5)
          .children(rows.slice(0, MAX).map((r, i) => h_flex().id(`wd-f-${i}`).gap(8).items_center()
            .child(div().w(28).flex_none().text_color(tone[r.status] ?? t.muted).child(r.status))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.file))
            .when(r.add !== null, (x) => x
              .child(div().flex_none().text_color(t.done).child(`+${r.add}`))
              .child(div().flex_none().text_color(t.blocked).child(`−${r.del}`)))))
          .when(n > MAX, (x) => x.child(div().text_color(t.dim).child(`and ${n - MAX} more`)))))
      .when(this.rows !== null && n === 0 && !this.blocked, (e) => e.child(div().text_color(t.dim).child("No changes: only the folder goes.")))
      .when(Boolean(this.error), (e) => e.child(div().text_color(t.blocked).child(this.error)))
      .when(n === 0, (e) => e.child(div().flex_1()))
      .child(h_flex().justify_end().gap(8).text_size(12)
        .child(button("wd-no", "Cancel", t.raised, t.foreground, true, () => this.close()))
        .child(n > 0
          ? button("wd-yes", this.busy ? "Deleting…" : `Delete with ${n} change${n === 1 ? "" : "s"}`, t.blocked, t.solid_foreground, ready, (cx) => this.remove(cx))
          : button("wd-yes", this.busy ? "Deleting…" : "Delete", t.solid, t.solid_foreground, ready, (cx) => this.remove(cx))));
  }
}
