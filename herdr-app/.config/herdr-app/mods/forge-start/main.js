// forge-start: the dialog behind a space's "+". It reads the space folder's repo and its .forge runs:
// open a run, send it a follow-up, or start a new run in this folder (forge init --here).
// Opened as: openOverlay({ mod: "forge-start", kind: "dialog", props: { space, folder } }).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, closeOverlay, theme, exec, home, writeTextFile, notify, run, spaces, panes, setShared } from "herdr";

const forgeBin = () => `${home()}/.local/bin/forge`;

// Model settings by role group (Q45). A group shows "mixed" when its roles differ.
const GROUPS = [
  ["Coordinators", ["grill-coord", "verify-coord", "exec-coord"]],
  ["Asker, decider", ["asker", "decider"]],
  ["Fact-finders", ["fact-finder"]],
  ["TLA+ writers", ["tla-writer"]],
  ["Planner", ["planner"]],
  ["Units", ["unit"]],
  ["Gates", ["gate-beh", "gate-spec", "gate-sec"]],
  ["Review", ["gate-review"]],
  ["Classifier, commit", ["classifier", "commit"]],
];
const short = (rule) => rule.replace(/^Bash\((.*?):\*\)$/, "$1").replace(/^mcp__/, "mcp:");
const forge = async (args, cwd) => {
  const r = await exec(forgeBin(), args, { cwd, timeout: 120_000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  return { ok: r.code === 0, out: r.stdout, err: (r.stderr || r.stdout || "").trim() };
};

// Show one forge run: the forge graph on the right and the PR view below it, in the run's space.
// Panes already in that tab follow the shared selection instead of opening again.
function showRun(space, dir) {
  setShared("forge.selected", { dir, at: Date.now() });
  if (space) run("space.select", { id: space.id });
  const tab = space?.tabs?.find((x) => x.active)?.id;
  const inTab = panes().filter((p) => p.tab === tab);
  if (!inTab.some((p) => p.mod === "forge")) run("pane.split", { direction: "right", mod: "forge", props: { run: dir } });
  if (!inTab.some((p) => p.mod === "prs")) run("pane.split", { direction: "down", mod: "prs", props: { run: dir } });
}

export default class ForgeStart extends View {
  init(_props, cx) {
    const p = props() ?? {};
    Object.assign(this, { space: p.space ?? null, folder: p.folder ?? null, overlay: p.overlay, repo: null, runs: [], error: null, busy: null, following: null, settings: null, settingsOpen: false, merged: new Set() });
    this.follow = TextareaState.new({ placeholder: "Follow-up: a QA bug, a change, or a review note", rows: 3 });
    this.ticket = InputState.new({ placeholder: "Ticket, like INTR-123 (empty: none)" });
    this.goal = TextareaState.new({ placeholder: "What to build: the goal, the rules, the files", rows: 5 });
    // References: one per line (a doc URL, a Confluence page, a Jira key, a GitHub link, a file or image path).
    // Files dropped on the dialog are added here.
    // Workspace runs (a root that holds repos): which repos the change touches, one per line or comma separated.
    this.repoIn = InputState.new({ placeholder: "Repos, like api, web-app (grill can add more)" });
    this.refs = TextareaState.new({ placeholder: "References, one per line: URL, Confluence page, JIRA-123, file or image path (or drop files here)", rows: 3 });
    cx.spawn(async (cx) => {
      // Settings load on their own, so the defaults show even outside a git repo.
      if (this.folder) {
        const st = await forge(["settings", "--main", this.folder], this.folder);
        if (st.ok && !this.settings) this.settings = JSON.parse(st.out);
        cx.notify();
      }
      try {
        if (!this.folder) throw new Error("This space has no folder.");
        const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: this.folder }).catch(() => ({ code: 1 }));
        if (common.code !== 0) {
          // Not a git repo: a workspace when it holds repos (each repo keeps its own git), else offer git init.
          const kids = await exec("sh", ["-c", 'for d in "$1"/*/; do [ -e "$d.git" ] && basename "$d"; done; true', "forge-start", this.folder]).catch(() => null);
          this.childRepos = (kids?.stdout ?? "").split("\n").filter((x) => x && x !== "worktrees");
          if (!this.childRepos.length) {
            this.notRepo = true;
            throw new Error(`${this.folder} is not a git repo and holds no repos. Forge needs git for commits, diffs, undo, and PRs.`);
          }
          this.workspace = true;
          this.repo = { main: this.folder, top: this.folder };
        } else {
          const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: this.folder });
          this.repo = { main: common.stdout.trim().replace(/\/\.git\/?$/, ""), top: top.stdout.trim() };
        }
        const r = await forge(["runs"], this.repo.main);
        if (!r.ok) throw new Error(r.err);
        this.runs = JSON.parse(r.out).filter((x) => x.main === this.repo.main);
        const st = await forge(["settings", "--main", this.repo.main], this.repo.main);
        if (st.ok) this.settings = JSON.parse(st.out);
        else this.settingsError = st.err;
        cx.notify();
        // A run whose PR is merged continues in a new run (Q44), not as a follow-up on a merged branch.
        for (const x of this.runs.filter((y) => y.repo && y.branch)) {
          const pr = await exec("gh", ["pr", "list", "--repo", x.repo, "--head", x.branch, "--state", "merged", "--json", "number", "--limit", "1"], { timeout: 30_000 }).catch(() => null);
          if (pr?.code === 0 && JSON.parse(pr.stdout || "[]").length) this.merged.add(x.dir);
        }
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  close() {
    closeOverlay(this.overlay);
  }

  // A plain folder (no repos inside): make it a git repo with a first commit of what is there.
  gitInit(cx) {
    this.task(cx, "git init", async () => {
      for (const args of [["init", "-q"], ["add", "-A"], ["commit", "-q", "--allow-empty", "-m", "chore: start forge"]]) {
        const r = await exec("git", args, { cwd: this.folder, timeout: 120_000 });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `git ${args[0]} failed`);
      }
      return `${this.folder} is now a git repo. Press + again to start a run.`;
    });
  }

  // Change settings through the CLI; it writes only the project files in <main>/.forge/.
  config(cx, args) {
    if (this.busy || !this.repo) return;
    this.busy = "saving settings";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await forge(["config", ...args, "--main", this.repo.main], this.repo.main);
      if (r.ok) this.settings = JSON.parse(r.out);
      else this.error = r.err;
      this.busy = null;
      cx.notify();
    });
  }

  editSources(cx) {
    cx.spawn(async () => {
      const r = await forge(["config", "sources-file", "--main", this.repo.main], this.repo.main);
      if (!r.ok) return;
      const file = JSON.parse(r.out).file;
      run("pane.split", { direction: "down", argv: ["sh", "-c", '${EDITOR:-nvim} "$1"', "edit", file] });
      this.close();
    });
  }

  // A new run that starts from a finished run: its approved spec becomes a ref.
  continueFrom(cx, r) {
    cx.spawn(async (cx) => {
      const st = await forge(["status", "--run", r.dir], r.main);
      const spec = st.ok ? JSON.parse(st.out).spec : {};
      const path = spec.approved ?? spec.gate ?? spec.draft;
      if (path) this.refs.set_value([...this.refList().filter((x) => x !== path), path].join("\n"));
      this.goal.set_value(`Continue from ${r.ticket} (${r.title}): `);
      this.following = null;
      cx.notify();
    });
  }

  settingsView(t, button) {
    const s = this.settings;
    if (!s) return div().text_size(11.5).text_color(this.settingsError ? t.blocked : t.dim).child(this.settingsError ? `Settings: ${this.settingsError}` : "Loading settings…");
    const editable = Boolean(this.repo); // project settings live in a repo's .forge/
    const chip = (id, label, on, f) => div().id(id).h(22).px(8).flex().items_center().rounded(5).text_size(11.5)
      .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.muted)
      .when(editable && !this.busy, (e) => e.cursor_pointer().hover((x) => x.bg(t.hover)).on_click((_e, cx) => f(cx))).child(label);
    const rows = GROUPS.map(([label, rs], i) => {
      const known = rs.filter((r) => s.models[r]);
      const values = [...new Set(known.map((r) => s.models[r].value))];
      const value = values.length === 1 ? values[0] : "mixed";
      const project = known.some((r) => s.models[r].from === "project");
      return h_flex().id(`fs-model-${i}`).gap(6).items_center()
        .child(div().w(130).text_size(12).truncate().child(label))
        .children(["opus", "sonnet", "haiku"].map((m) => chip(`fs-m-${i}-${m}`, m, value === m, (cx) => this.config(cx, ["model", ...known.map((r) => `${r}=${m}`)]))))
        .child(div().text_size(11).text_color(project ? t.accent : t.dim).child(project ? "project" : value === "mixed" ? "mixed" : "default"))
        .when(project, (e) => e.child(div().id(`fs-reset-${i}`).text_size(11).text_color(t.muted).cursor_pointer().on_click((_e, cx) => this.config(cx, ["model", ...known.map((r) => `${r}=default`)])).child("reset")));
    });
    const phases = ["grill", "verify", "exec"].map((ph) => {
      const src = s.sources[ph];
      return div().text_size(11.5).text_color(t.muted).child(`${ph}: ${src.allow.map(short).join(", ")}${src.mcp.length ? ` · MCP: ${src.mcp.join(", ")}` : ""}`);
    });
    return v_flex().gap(6).p(10).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(div().text_size(11.5).text_color(t.dim).child(editable ? "Models: from the next agent. Cap: from the next cycle. Saved in .forge/ of this repo." : "The defaults. They can be changed per repo, from a space inside a git repo."))
      .children(rows)
      .child(h_flex().gap(6).items_center().pt(4)
        .child(div().w(130).text_size(12).child("Agents at once"))
        .child(chip("fs-cap-dn", "−", false, (cx) => this.config(cx, ["cap", String(Math.max(1, s.cap.value - 1))])))
        .child(div().w(20).text_size(12).child(String(s.cap.value)))
        .child(chip("fs-cap-up", "+", false, (cx) => this.config(cx, ["cap", String(Math.min(8, s.cap.value + 1))])))
        .child(div().text_size(11).text_color(s.cap.from === "project" ? t.accent : t.dim).child(s.cap.from)))
      .child(div().pt(4).text_size(12).child("Allowed tools"))
      .children(phases)
      .child(div().id("fs-deny").text_size(11.5).text_color(t.dim).tooltip(s.deny.map(short).join("\n")).child(`Deny floor: ${s.deny.length} rules, always on (hover to see)`))
      .when(editable, (e) => e.child(h_flex().justify_end().child(button("fs-edit-sources", "Edit project SOURCES.md", (cx) => this.editSources(cx)))));
  }

  refList() {
    return this.refs.value().split("\n").map((x) => x.trim()).filter(Boolean);
  }

  // Files dropped anywhere on the dialog become references (absolute paths).
  dropped(paths, cx) {
    const have = this.refList();
    this.refs.set_value([...have, ...paths.filter((p) => !have.includes(p))].join("\n"));
    cx.notify();
  }

  // The run's own space when one shows its worktree, else this space.
  openPanel(dir, worktree) {
    showRun(spaces().find((s) => s.folder === worktree) ?? spaces().find((s) => s.id === this.space), dir);
  }

  task(cx, label, work) {
    if (this.busy) return;
    this.busy = label;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const msg = await work();
        notify({ title: `Forge: ${label}`, body: msg, level: "success" });
        this.close();
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.busy = null;
      cx.notify();
    });
  }

  sendFollow(cx, r) {
    const text = this.follow.value().trim();
    if (!text) return;
    this.task(cx, "follow-up", async () => {
      const refs = this.refList().flatMap((x) => ["--ref", x]);
      const res = await forge(["followup", text, "--source", "user", ...refs, "--run", r.dir], r.main);
      if (!res.ok) throw new Error(res.err);
      return `Sent to ${r.ticket}.`;
    });
  }

  start(cx) {
    const goal = this.goal.value().trim();
    if (!goal || !this.repo) return;
    const ticket = this.ticket.value().trim();
    this.task(cx, "new run", async () => {
      const inbox = `${this.repo.main}/.forge/inbox`;
      const file = `${inbox}/${Date.now()}.md`;
      await exec("mkdir", ["-p", inbox]);
      const refs = this.refList();
      const refLines = refs.length ? `refs:\n${refs.map((x) => `  - ${x}`).join("\n")}\n` : "";
      const repos = this.workspace ? this.repoIn.value().split(/[\s,]+/).map((x) => x.trim()).filter(Boolean) : [];
      const repoLines = repos.length ? `repos:\n${repos.map((x) => `  - ${x}`).join("\n")}\n` : "";
      await writeTextFile(file, `---\nticket: ${ticket || "none"}\n${repoLines}${refLines}---\n${goal}\n`, null);
      // A workspace root has no git: forge init sees that and starts a workspace run. A repo runs --here.
      const init = await forge(this.workspace ? ["init", file] : ["init", file, "--here"], this.repo.top);
      if (!init.ok) throw new Error(init.err);
      const st = JSON.parse(init.out);
      const coord = await forge(["coord", "--run", st.run], this.repo.main);
      if (!coord.ok) throw new Error(coord.err);
      this.openPanel(st.run, st.worktree);
      return `${st.ticket}: the grill coordinator is running.`;
    });
  }

  render(cx) {
    const t = theme();
    const name = this.repo ? this.repo.top.split("/").pop() : String(this.folder ?? "").split("/").pop();
    const field = (child) => div().rounded(6).border_1().border_color(t.input).bg(t.background).child(child);
    const button = (id, label, f, primary = false) => div().id(id).h(28).px(12).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).hover((s) => s.bg(primary ? t.solid : t.hover))
      .when(!this.busy, (e) => e.on_click((_e, cx) => f(cx))).child(label);
    const phase = (r) => {
      const h = r.head ?? {};
      return h.phase === "gate" ? ["◆ waiting for you", t.accent] : h.phase === "done" ? ["✓ done", t.done] : [`● ${h.phase ?? "?"}`, t.working];
    };
    return v_flex().id("forge-start").size_full().min_h(0).bg(t.popover).text_color(t.foreground).text_size(13)
      .on_drop((e, cx) => this.dropped(e.paths ?? [], cx))
      .child(h_flex().h(44).flex_none().px(16).items_center().justify_between().border_b(1).border_color(t.border)
        .child(div().font_semibold().child(`Forge · ${name}`))
        .child(div().id("fs-close").text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(() => this.close()).child("×")))
      .child(v_flex().id("fs-body").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(10)
        .when(Boolean(this.error), (e) => e.child(div().text_size(12).text_color(t.blocked).child(this.error)))
        .when(Boolean(this.busy), (e) => e.child(div().text_size(12).text_color(t.working).child(`${this.busy}…`)))
        .when(Boolean(this.notRepo), (e) => e.child(h_flex().justify_end().child(button("fs-git-init", "Make this a git repo", (cx) => this.gitInit(cx), true))))
        .when(Boolean(this.workspace), (e) => e.child(div().text_size(11.5).text_color(t.accent).child(`Workspace: ${this.childRepos.length} repos. A run can change several of them, each in its own worktree under worktrees/<ticket>/.`)))
        .when(!this.notRepo, (e) => e.child(div().text_size(11.5).text_color(t.dim).child(`Runs in this ${this.workspace ? "workspace" : "repo"} ${this.runs.length}`)))
        .children(this.runs.map((r, i) => {
          const [label, color] = phase(r);
          const open = this.following === r.dir;
          return v_flex().id(`fs-run-${i}`).gap(6).p(10).rounded(8).bg(t.surface).border_1().border_color(open ? t.accent : t.border)
            .child(h_flex().gap(8).items_center()
              .child(v_flex().flex_1().min_w(0)
                .child(div().font_semibold().truncate().child(r.title || r.ticket))
                .child(div().text_size(11.5).text_color(t.dim).truncate().child(`${r.ticket} · cycle ${r.head?.cycle ?? "?"} · ${r.branch ?? "?"}`)))
              .child(div().flex_none().text_size(11.5).text_color(color).child(label)))
            .child(h_flex().gap(8).justify_end().items_center()
              .when(this.merged.has(r.dir), (e) => e.child(div().flex_1().text_size(11.5).text_color(t.done).child("PR merged")))
              .child(button(`fs-open-${i}`, "Open", () => { this.openPanel(r.dir, r.worktree); this.close(); }))
              .child(this.merged.has(r.dir)
                ? button(`fs-cont-${i}`, "New run from this", (cx) => this.continueFrom(cx, r))
                : button(`fs-follow-${i}`, open ? "Cancel" : "Follow up", (cx) => { this.following = open ? null : r.dir; this.follow.set_value(""); cx.notify(); })))
            .when(open, (e) => e.child(field(Textarea.new(this.follow).text_size(12)))
              .child(field(Textarea.new(this.refs).text_size(12)))
              .child(h_flex().justify_end().child(button(`fs-send-${i}`, "Send follow-up", (cx) => this.sendFollow(cx, r), true))));
        }))
        .when(!this.runs.length && !this.error && !this.notRepo, (e) => e.child(div().text_size(12).text_color(t.dim).child("No forge run in this repo yet.")))
        .when(!this.notRepo, (e) => e
          .child(div().pt(8).text_size(11.5).text_color(t.dim).child(`New run in ${this.repo?.top ?? this.folder ?? ""}`))
          .child(field(div().h(30).px(8).flex().items_center().child(Input.new(this.ticket).h_full().text_size(12))))
          .when(Boolean(this.workspace), (e2) => e2.child(field(div().h(30).px(8).flex().items_center().child(Input.new(this.repoIn).h_full().text_size(12)))))
          .child(field(Textarea.new(this.goal).text_size(12)))
          .when(!this.following, (e2) => e2.child(field(Textarea.new(this.refs).text_size(12))))
          .child(h_flex().justify_between().items_center()
            .child(div().text_size(11).text_color(t.dim).child("Agents grill it, TLA+ checks it, then you approve."))
            .child(button("fs-start", "Start", (cx) => this.start(cx), true))))
        .child(div().id("fs-settings-toggle").pt(8).text_size(11.5).text_color(t.dim).cursor_pointer().hover((x) => x.text_color(t.foreground))
          .on_click((_e, cx) => { this.settingsOpen = !this.settingsOpen; cx.notify(); })
          .child(`${this.settingsOpen ? "▾" : "▸"} Settings`))
        .when(this.settingsOpen, (e) => e.child(this.settingsView(t, button))));
  }
}
