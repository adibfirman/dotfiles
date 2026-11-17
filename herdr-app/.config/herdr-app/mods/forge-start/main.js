// forge-start: the dialog behind the projects "+". You pick a space first; then it reads that space's work folder,
// its repo, and its .forge runs: open a run, or start a new run in this folder (forge init --here --space <id>).
// Follow-ups go through the run chat.
// Opened as: openOverlay({ mod: "forge-start", kind: "dialog", props: { spaces: [{ id, name, folder }] } }).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, openOverlay, closeOverlay, theme, exec, home, writeTextFile, notify, run, setShared, settings as appSettings } from "herdr";

const forgeBin = () => `${home()}/.local/bin/forge`;
const alpha = (hex, a) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(a * 255).toString(16).padStart(2, "0") : hex);

// Model settings by role group (Q45). A group shows "mixed" when its roles differ.
const GROUPS = [
  ["Coordinators", ["grill-coord", "grill-me-coord", "verify-coord", "exec-coord"]],
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
// A `- deny:` value as forge's rule (sources.ts denyRule), to tell this repo's entries from the defaults.
const denyRuleOf = (v) => /^mcp__/.test(v) || /^[A-Z][A-Za-z]*(\(.*\))?$/.test(v) ? v
  : /^claude[._]ai[ _]/i.test(v) ? `mcp__${v.trim().replace(/[^A-Za-z0-9_-]/g, "_")}` : `Bash(${v}:*)`;
// "claude.ai Atlassian" → "claude_ai_Atlassian", the server part of its tool names (as the forge CLI does).
const forge = async (args, cwd) => {
  const r = await exec(forgeBin(), args, { cwd, timeout: 120_000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  return { ok: r.code === 0, out: r.stdout, err: (r.stderr || r.stdout || "").trim() };
};
// stdout as JSON, also when the command exited 1 (forge doctor prints its report either way), else null.
const jsonOf = (r) => {
  try {
    return JSON.parse(r.out);
  } catch {
    return null;
  }
};

export default class ForgeStart extends View {
  init(_props, cx) {
    const p = props() ?? {};
    // Nothing is picked at the start: the run goes to the space you pick, never to the active one on its own.
    Object.assign(this, { spaces: p.spaces ?? [], space: null, folder: null, overlay: p.overlay, repo: null, runs: [], error: null, busy: null, settings: null, settingsOpen: false, merged: new Set() });
    this.ticket = InputState.new({ placeholder: "Ticket, like ABC-123 (empty: none)" });
    this.goal = TextareaState.new({ placeholder: "The goal, the rules, and the files it should touch", rows: 5 });
    // References: one per line (a doc URL, a Confluence page, a Jira key, a GitHub link, a file or image path).
    // Files dropped on the dialog are added here.
    // Workspace runs (a root that holds repos): which repos the change touches, one per line or comma separated.
    this.repoIn = InputState.new({ placeholder: "Repos, like api, web-app (grill can add more)" });
    this.refs = TextareaState.new({ placeholder: "A URL, a Confluence page, JIRA-123, or a file or image path", rows: 3 });
    // Settings → Denied commands: one row per phase to deny one more command, or lift a deny floor rule.
    this.toolIn = Object.fromEntries(["grill", "verify", "exec"].map((ph) => [ph, InputState.new({ placeholder: "kubectl delete" })]));
    // The last refusal per phase ("not a command prefix", "never lift"), shown under the row.
    this.blocked = {};
  }

  // A click on a space chip: forget what the last space loaded, then load this one.
  pick(cx, s) {
    if (this.busy || s.id === this.space) return;
    Object.assign(this, { space: s.id, folder: s.folder ?? null, repo: null, runs: [], error: null, settings: null, settingsError: null, lessons: null, notRepo: false, workspace: false, childRepos: [], merged: new Set(), doc: null });
    cx.notify();
    this.load(cx);
  }

  // The picked space's folder: its repo (or workspace), runs, settings, and lessons. Each pick makes the loads
  // before it stale, so a slow load never writes over a space picked after it.
  load(cx) {
    const token = (this.loadToken = (this.loadToken ?? 0) + 1);
    const stale = () => token !== this.loadToken;
    cx.spawn(async (cx) => {
      // Settings load on their own, so the defaults show even outside a git repo.
      if (this.folder) {
        const st = await forge(["settings", "--main", this.folder], this.folder);
        if (stale()) return;
        if (st.ok && !this.settings) this.settings = JSON.parse(st.out);
        cx.notify();
      }
      try {
        if (!this.folder) throw new Error("This space has no folder.");
        const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: this.folder }).catch(() => ({ code: 1 }));
        if (stale()) return;
        if (common.code !== 0) {
          // Not a git repo: a workspace when it holds repos (each repo keeps its own git), else offer git init.
          const kids = await exec("sh", ["-c", 'for d in "$1"/*/; do [ -e "$d.git" ] && basename "$d"; done; true', "forge-start", this.folder]).catch(() => null);
          if (stale()) return;
          this.childRepos = (kids?.stdout ?? "").split("\n").filter((x) => x && x !== "worktrees");
          if (!this.childRepos.length) {
            this.notRepo = true;
            throw new Error(`${this.folder} is not a git repo and holds no repos. Forge needs git for commits, diffs, undo, and PRs.`);
          }
          this.workspace = true;
          this.repo = { main: this.folder, top: this.folder };
        } else {
          const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: this.folder });
          if (stale()) return;
          this.repo = { main: common.stdout.trim().replace(/\/\.git\/?$/, ""), top: top.stdout.trim() };
        }
        // --removed: also the runs taken off the list whose folder stayed (Restore brings them back).
        const r = await forge(["runs", "--removed"], this.repo.main);
        if (stale()) return;
        if (!r.ok) throw new Error(r.err);
        this.runs = JSON.parse(r.out).filter((x) => x.main === this.repo.main);
        const st = await forge(["settings", "--main", this.repo.main], this.repo.main);
        if (stale()) return;
        if (st.ok) this.settings = JSON.parse(st.out);
        else this.settingsError = st.err;
        const ls = await forge(["lessons", "--main", this.repo.main], this.repo.main);
        if (stale()) return;
        if (ls.ok) this.lessons = jsonOf(ls);
        cx.notify();
        // A run whose PR is merged continues in a new run (Q44), not as a follow-up on a merged branch.
        for (const x of this.runs.filter((y) => y.repo && y.branch && !y.removed)) {
          const pr = await exec("gh", ["pr", "list", "--repo", x.repo, "--head", x.branch, "--state", "merged", "--json", "number", "--limit", "1"], { timeout: 30_000 }).catch(() => null);
          if (stale()) return;
          if (pr?.code === 0 && JSON.parse(pr.stdout || "[]").length) this.merged.add(x.dir);
        }
      } catch (e) {
        if (stale()) return;
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

  // The repo's lessons (.forge/lessons.md): what earlier runs learned about its tools. Editing creates the file.
  editLessons() {
    const file = this.lessons?.file;
    if (!file) return;
    run("pane.split", { direction: "down", argv: ["sh", "-c", '${EDITOR:-nvim} "$1"', "edit", file] });
    this.close();
  }

  // forge doctor: the tools agents need (the check and build commands' programs on the agent PATH, gh auth, docker)
  // before anything starts. Returns the report, or null when this forge has no doctor yet (then nothing blocks).
  async doctor() {
    // In a workspace, only the repos named for this run: another repo's toolchain (or Docker being off) must not
    // stop a run that never touches it.
    const named = this.workspace ? this.repoIn.value().split(/[\s,]+/).map((x) => x.trim()).filter(Boolean) : [];
    const r = await forge(["doctor", "--main", this.repo.main, ...named.flatMap((n) => ["--repo", n.replace(/@.*$/, "")])], this.repo.top);
    const d = jsonOf(r);
    this.doc = d && Array.isArray(d.items) ? d : null;
    return this.doc;
  }

  checkAgain(cx) {
    if (this.busy || !this.repo) return;
    this.busy = "checking tools";
    cx.notify();
    cx.spawn(async (cx) => {
      await this.doctor();
      this.busy = null;
      cx.notify();
    });
  }

  // A new run that starts from an earlier run (live or removed): its best spec and its newest plan become refs.
  continueFrom(cx, r) {
    cx.spawn(async (cx) => {
      const st = await forge(["status", "--run", r.dir], r.main);
      const spec = st.ok ? JSON.parse(st.out).spec : {};
      const paths = [spec.approved ?? spec.gate ?? spec.draft, spec.plan].filter(Boolean);
      if (paths.length) this.refs.set_value([...this.refList().filter((x) => !paths.includes(x)), ...paths].join("\n"));
      this.goal.set_value(`Continue from ${r.ticket} (${r.title}): `);
      cx.notify();
    });
  }

  // A removed run comes back: listed again, its worktrees made again on the kept branches, in the picked space.
  // It starts no agent: open it, then continue in its Chat.
  restore(cx, r) {
    if (this.busy || !this.space || !this.repo) return;
    this.busy = `restoring ${r.ticket}`;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const res = await forge(["restore", "--run", r.dir, "--space", this.space], this.repo.main);
      this.busy = null;
      if (res.ok) notify({ title: `Forge: ${r.ticket} restored`, body: "Open it, then continue in its Chat.", level: "success" });
      else this.error = res.err;
      cx.notify();
      if (res.ok) this.load(cx);
    });
  }

  // Grill: Auto | With me, and Checks: Full | Light | Off. A pick is saved as this repo's default (forge config),
  // and Start passes it to forge init.
  runOptions(t) {
    const s = this.settings;
    const chip = (id, label, on, tip, f) => div().id(id).h(22).px(8).flex().items_center().rounded(5).text_size(11.5)
      .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.muted).tooltip(tip)
      .when(Boolean(this.repo) && !this.busy, (e) => e.cursor_pointer().hover((x) => x.bg(t.hover)).on_click((_e, cx) => f(cx))).child(label);
    const row = (label, items) => h_flex().gap(6).items_center()
      .child(div().w(52).text_size(11.5).font_semibold().text_color(t.muted).child(label))
      .children(items);
    const grill = s?.grill?.value ?? "auto";
    const checks = s?.checks?.value ?? "light";
    return v_flex().gap(6).pt(2)
      .child(row("Grill", [
        chip("fs-grill-auto", "Auto", grill === "auto", "Agents ask and decide; you review the decisions at the gate.", (cx) => this.config(cx, ["grill", "auto"])),
        chip("fs-grill-me", "With me", grill === "me", "You answer each question round in the run window, with your brainstorming rules.", (cx) => this.config(cx, ["grill", "me"])),
      ]))
      .child(row("Checks", [
        chip("fs-checks-full", "Full", checks === "full", "Tests, typecheck, and lint in every unit and every wave.", (cx) => this.config(cx, ["checks", "full"])),
        chip("fs-checks-light", "Light", checks === "light", "Only the changed files' tests and typecheck per wave; the full suite and build once at the end.", (cx) => this.config(cx, ["checks", "light"])),
        chip("fs-checks-off", "Off", checks === "off", "No tests or builds. The PR says checks were not run.", (cx) => this.config(cx, ["checks", "off"])),
      ]));
  }

  // What forge doctor found missing, with the agents' PATH, and a link to check again.
  doctorView(t) {
    const d = this.doc;
    return v_flex().id("fs-doctor").gap(4).p(8).rounded(6).bg(alpha(t.blocked, 0.10)).border_1().border_color(alpha(t.blocked, 0.4))
      .child(h_flex().justify_between().items_center()
        .child(div().text_size(11.5).font_semibold().text_color(t.blocked).child("Missing for the agents"))
        .child(div().id("fs-doctor-again").text_size(11).text_color(t.muted).cursor_pointer().hover((x) => x.text_color(t.foreground))
          .on_click((_e, cx) => this.checkAgain(cx)).child("Check again")))
      .children(d.items.filter((x) => !x.ok).map((x, i) => h_flex().id(`fs-doc-${i}`).gap(6).items_start().text_size(11.5)
        .child(div().flex_none().text_color(t.blocked).child("✕"))
        .child(div().flex_none().font_semibold().text_color(t.foreground).child(String(x.name)))
        .child(div().flex_1().min_w(0).text_color(t.blocked).child(String(x.detail ?? "")))))
      .when(Boolean(d.path), (e) => e.child(div().id("fs-doc-path").text_size(10.5).text_color(t.dim).truncate().tooltip(String(d.path)).child(`Agent PATH: ${d.path}`)));
  }

  // .forge/lessons.md, shown in Settings: one line per block an earlier run got past (the planner, units, and
  // gates read it first).
  lessonsView(t, heading) {
    const l = this.lessons;
    const mono = appSettings()?.font_family ?? "JetBrains Mono";
    const lines = String(l?.text ?? "").split("\n").filter((x) => x.trim());
    return v_flex().gap(4)
      .child(h_flex().justify_between().items_end()
        .child(heading("Lessons"))
        .when(Boolean(l?.file), (e) => e.child(div().id("fs-lessons-edit").text_size(11).text_color(t.muted).cursor_pointer().hover((x) => x.text_color(t.foreground))
          .on_click(() => this.editLessons()).child("Edit"))))
      .child(lines.length
        ? v_flex().id("fs-lessons").max_h(12 * 16 + 12).overflow_y_scrollbar().p(6).rounded(6).bg(t.raised).font_family(mono).text_size(11).text_color(t.dim)
          .children(lines.map((x, i) => div().id(`fs-lesson-${i}`).min_h(16).child(x)))
        : div().text_size(11.5).text_color(t.dim).child(l ? "None yet. A coordinator adds one when it gets past a blocked tool." : "Not loaded."));
  }

  settingsView(t, button) {
    const s = this.settings;
    if (!s) return div().text_size(11.5).text_color(this.settingsError ? t.blocked : t.dim).child(this.settingsError ? `Settings: ${this.settingsError}` : this.space ? "Loading settings…" : "Pick a space to see its settings.");
    const editable = Boolean(this.repo); // project settings live in this repo's or workspace's .forge/
    const chip = (id, label, on, f) => div().id(id).h(22).px(8).flex().items_center().rounded(5).text_size(11.5)
      .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.muted)
      .when(editable && !this.busy, (e) => e.cursor_pointer().hover((x) => x.bg(t.hover)).on_click((_e, cx) => f(cx))).child(label);
    const heading = (text) => div().pt(6).text_size(11.5).font_semibold().text_color(t.muted).child(text);
    const rows = GROUPS.map(([label, rs], i) => {
      const known = rs.filter((r) => s.models[r]);
      const values = [...new Set(known.map((r) => s.models[r].value))];
      const value = values.length === 1 ? values[0] : "mixed";
      const project = known.some((r) => s.models[r].from === "project");
      return h_flex().id(`fs-model-${i}`).gap(6).items_center()
        .child(div().w(130).text_size(12).truncate().child(label))
        .children(["fable", "opus", "sonnet", "haiku"].map((m) => chip(`fs-m-${i}-${m}`, m, value === m, (cx) => this.config(cx, ["model", ...known.map((r) => `${r}=${m}`)]))))
        .child(div().text_size(11).text_color(project ? t.accent : t.dim).child(project ? "project" : value === "mixed" ? "mixed" : "default"))
        .when(project, (e) => e.child(div().id(`fs-reset-${i}`).text_size(11).text_color(t.muted).cursor_pointer().hover((x) => x.text_color(t.foreground))
          .on_click((_e, cx) => this.config(cx, ["model", ...known.map((r) => `${r}=default`)])).child("reset")));
    });
    // Agents run in bypass mode: everything runs except these. Per phase: the default denies (dotfiles SOURCES.md),
    // this repo's own (accent, × removes), and the floor rules this repo lifted (red ⚠, × puts them back).
    const floor = new Set(s.deny);
    const scripts = new Set(s.scripts ?? []);
    const phases = ["grill", "verify", "exec"].map((ph) => {
      const src = s.sources[ph];
      const mine = s.project?.[ph] ?? [];
      const mineRules = new Set(mine.map(denyRuleOf));
      const forced = src.forced ?? [];
      const defaults = src.deny.filter((r) => !floor.has(r) && !scripts.has(r) && !mineRules.has(r) && !/^Bash\(git push (--force|-f|--force-with-lease):\*\)$/.test(r)).map(short);
      const blocked = this.blocked[ph];
      return v_flex().id(`fs-tools-${ph}`).gap(6).p(8).rounded(6).bg(t.background).border_1().border_color(t.border)
        .child(h_flex().gap(8).items_start()
          .child(div().w(52).flex_none().text_size(12).font_semibold().child(ph))
          .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.muted)
            .child(defaults.length ? defaults.join(", ") : "only the deny floor")))
        .when(mine.length > 0, (e) => e.child(h_flex().flex_wrap().gap(6).pl(60)
          .children(mine.map((v, i) => h_flex().id(`fs-mine-${ph}-${i}`).h(22).px(8).gap(6).items_center().rounded(5).bg(alpha(t.accent, 0.14)).text_size(11.5).text_color(t.accent)
            .child(v)
            .when(editable, (c) => c.child(div().id(`fs-rm-${ph}-${i}`).text_color(t.muted).cursor_pointer().hover((x) => x.text_color(t.blocked))
              .tooltip("Remove from this repo: agents may run it again").on_click((_e, cx) => this.config(cx, ["undeny", ph, v])).child("×")))))))
        // Lifted: past the deny floor, this repo and phase only. Red, so it is never missed.
        .when(forced.length > 0, (e) => e.child(h_flex().flex_wrap().gap(6).pl(60)
          .children(forced.map((m, i) => h_flex().id(`fs-forced-${ph}-${i}`).h(22).px(8).gap(6).items_center().rounded(5).bg(alpha(t.blocked, 0.14)).text_size(11.5).text_color(t.blocked)
            .tooltip(`Lifted: ${m.lifts.map(short).join(", ")} runs in ${ph} for this repo`)
            .child(`⚠ lifted: ${m.value}`)
            .when(editable, (c) => c.child(div().id(`fs-unforce-${ph}-${i}`).text_color(t.muted).cursor_pointer().hover((x) => x.text_color(t.foreground))
              .tooltip("Remove: the deny floor applies again").on_click((_e, cx) => this.config(cx, ["unforce", ph, m.key, m.value])).child("×")))))))
        .when(Boolean(blocked), (e) => e.child(h_flex().gap(8).items_center().ml(60).p(6).rounded(5).bg(alpha(t.blocked, 0.10))
          .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.blocked).child(blocked))
          .child(div().id(`fs-blocked-x-${ph}`).text_size(11.5).text_color(t.muted).cursor_pointer().on_click((_e, cx) => { this.blocked[ph] = null; cx.notify(); }).child("×"))))
        .when(editable, (e) => e.child(h_flex().gap(6).items_center().pl(60)
          .child(div().flex_1().h(26).px(8).flex().items_center().rounded(5).border_1().border_color(t.input).bg(t.popover)
            .child(Input.new(this.toolIn[ph]).h_full().text_size(11.5)))
          .child(button(`fs-add-${ph}`, "Deny", (cx) => this.addTool(cx, ph, "deny")))
          .child(button(`fs-lift-${ph}`, "Lift", (cx) => this.addTool(cx, ph, "lift")))));
    });
    return v_flex().gap(8).p(12).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(div().text_size(11.5).text_color(t.dim).child(editable
        ? `Saved in ${this.workspace ? "this workspace's" : "this repo's"} .forge/, kept for every later run here. Models and denies apply from the next agent, the cap from the next cycle.`
        : "The defaults. They can be changed per repo or workspace."))
      .child(heading("Models"))
      .children(rows)
      .child(heading("Agents at once"))
      .child(h_flex().gap(6).items_center()
        .child(chip("fs-cap-dn", "−", false, (cx) => this.config(cx, ["cap", String(Math.max(1, s.cap.value - 1))])))
        .child(div().w(20).flex().justify_center().text_size(12).child(String(s.cap.value)))
        .child(chip("fs-cap-up", "+", false, (cx) => this.config(cx, ["cap", String(Math.min(8, s.cap.value + 1))])))
        .child(div().text_size(11).text_color(s.cap.from === "project" ? t.accent : t.dim).child(s.cap.from)))
      .when(editable, (e) => e.child(this.lessonsView(t, heading)))
      .child(heading("Denied commands"))
      .child(div().text_size(11.5).text_color(t.dim).child("Agents run in bypass mode: every command, tool, and MCP server runs except what is denied here. Deny adds a command for this repo; Lift lets one deny floor rule run in that phase."))
      .children(phases)
      .when((s.ignored ?? []).length > 0, (e) => e.child(div().id("fs-ignored").text_size(11.5).text_color(t.blocked)
        .tooltip(s.ignored.join("\n"))
        .child(`Ignored since bypass mode: ${s.ignored.length} old allow lines in .forge/SOURCES.md (hover to see). They allow nothing; remove them.`)))
      .child(div().id("fs-deny").text_size(11.5).text_color(t.dim).tooltip(s.deny.map((r) => (s.neverLift?.includes(r) ? `${short(r)}  (never liftable)` : short(r))).join("\n"))
        .child(`Deny floor: ${s.deny.length} rules for every phase (hover to see).${scripts.size ? ` This repo's outside scripts: ${scripts.size} rules.` : ""}`))
      .when(editable, (e) => e.child(h_flex().justify_end().child(button("fs-edit-sources", "Edit project SOURCES.md", (cx) => this.editSources(cx)))));
  }

  // Deny one more command for this repo and phase, or lift a deny floor rule ("Lift for this repo").
  addTool(cx, ph, how) {
    const value = this.toolIn[ph].value().trim();
    if (!value || this.busy || !this.repo) return;
    this.toolIn[ph].set_value("");
    this.blocked[ph] = null;
    this.busy = "saving settings";
    cx.notify();
    cx.spawn(async (cx) => {
      const key = /^mcp__|^claude[._]ai[ _]/i.test(value) ? "mcp" : /^[A-Z]/.test(value) ? "tools" : "bash";
      const args = how === "lift" ? ["config", "force", ph, key, value] : ["config", "deny", ph, value];
      const r = await forge([...args, "--main", this.repo.main], this.repo.main);
      if (r.ok) this.settings = JSON.parse(r.out);
      else this.blocked[ph] = r.err.replace(/^refused: /, "");
      this.busy = null;
      cx.notify();
    });
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

  // The run's floating window: the projects list (forge-runs) opens it on shared "forge.open", the same as a click
  // on its row, so one place builds the window.
  openPanel(r) {
    setShared("forge.open", { dir: r.dir, view: "coord", at: Date.now() });
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

  start(cx) {
    const goal = this.goal.value().trim();
    if (!goal || !this.repo || !this.space) return;
    const ticket = this.ticket.value().trim();
    this.task(cx, "new run", async () => {
      // A missing tool found now costs seconds; found in exec it costs an hour of grill, TLA+, and the gate.
      const doc = await this.doctor();
      if (doc && !doc.ok) throw new Error(`Not started: ${doc.items.filter((x) => !x.ok).length} missing for the agents (see the list above Start).`);
      const inbox = `${this.repo.main}/.forge/inbox`;
      // A run without a ticket is named after the file: use the goal's first words, plus a short suffix.
      const slug = goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 4).join("-") || "run";
      const file = `${inbox}/${slug}-${Date.now().toString(36).slice(-4)}.md`;
      await exec("mkdir", ["-p", inbox]);
      const refs = this.refList();
      const refLines = refs.length ? `refs:\n${refs.map((x) => `  - ${x}`).join("\n")}\n` : "";
      const repos = this.workspace ? this.repoIn.value().split(/[\s,]+/).map((x) => x.trim()).filter(Boolean) : [];
      const repoLines = repos.length ? `repos:\n${repos.map((x) => `  - ${x}`).join("\n")}\n` : "";
      await writeTextFile(file, `---\nticket: ${ticket || "none"}\n${repoLines}${refLines}---\n${goal}\n`, null);
      // A workspace root has no git: forge init sees that and starts a workspace run. A repo runs --here.
      // --grill and --checks: the switches above the Start button (also kept as this repo's defaults).
      // --space: the space picked at the top (saved in run.json; the sidebar colors the run with it).
      const opts = ["--grill", this.settings?.grill?.value ?? "auto", "--checks", this.settings?.checks?.value ?? "light", "--space", this.space];
      const init = await forge([...(this.workspace ? ["init", file] : ["init", file, "--here"]), ...opts], this.repo.top);
      if (!init.ok) throw new Error(init.err);
      const st = JSON.parse(init.out);
      const coord = await forge(["coord", "--run", st.run], this.repo.main);
      if (!coord.ok) {
        // The run exists but nothing runs it: delete it whole (--purge), so no dead row or half-made folder stays.
        await forge(["remove", "--purge", "--run", st.run], this.repo.main);
        throw new Error(coord.err);
      }
      // "With me": the run window opens now, so round 1 shows up in front of you. An Auto run opens only when you
      // click its row in projects (a long run should not cover your work).
      if (opts[1] === "me") {
        setShared("forge.open", { dir: st.run, view: "coord", at: Date.now() });
        return `${st.ticket}: the grill coordinator is starting in the run window. Answer its rounds there.`;
      }
      return `${st.ticket}: the grill coordinator is running. Click the run in projects to watch it.`;
    });
  }

  render(cx) {
    const t = theme();
    const name = (this.repo ? this.repo.top.split("/").pop() : String(this.folder ?? "").split("/").pop()) || "pick a space";
    const inputField = (state) => div().h(32).px(10).flex().items_center().rounded(6).border_1().border_color(t.input).bg(t.background)
      .child(Input.new(state).h_full().text_size(12));
    const areaField = (state) => div().px(10).py(8).rounded(6).border_1().border_color(t.input).bg(t.background)
      .child(Textarea.new(state).text_size(12));
    const label = (text, hint) => h_flex().justify_between().items_end().text_size(11.5)
      .child(div().font_semibold().text_color(t.muted).child(text))
      .when(Boolean(hint), (e) => e.child(div().text_color(t.dim).child(hint)));
    const button = (id, text, f, primary = false) => div().id(id).h(28).px(12).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).hover((x) => x.bg(primary ? t.solid : t.hover))
      .when(!this.busy, (e) => e.on_click((_e, cx) => f(cx))).child(text);
    const phase = (r) => {
      const h = r.head ?? {};
      if (r.removed) return ["removed", t.dim];
      return h.phase === "gate" ? ["◆ waiting for you", t.accent] : h.phase === "done" ? ["✓ done", t.done] : [`● ${h.phase ?? "?"}`, t.working];
    };
    const where = this.workspace ? "workspace" : "repo";
    return v_flex().id("forge-start").size_full().min_h(0).bg(t.popover).text_color(t.foreground).text_size(13)
      .on_drop((e, cx) => this.dropped(e.paths ?? [], cx))
      .child(h_flex().h(44).flex_none().px(16).items_center().justify_between().border_b(1).border_color(t.border)
        .child(div().font_semibold().child(`Forge · ${name}`))
        .child(div().id("fs-close").text_color(t.muted).cursor_pointer().hover((x) => x.text_color(t.foreground)).on_click(() => this.close()).child("×")))
      .child(v_flex().id("fs-body").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(14)
          .child(v_flex().gap(6)
            .child(label("Space", this.space ? null : "pick one to start"))
            .child(h_flex().flex_wrap().gap(6)
              .children(this.spaces.map((s, i) => div().id(`fs-space-${i}`).h(24).px(10).flex().items_center().rounded(5).text_size(12)
                .bg(s.id === this.space ? t.selected : t.raised).text_color(s.id === this.space ? t.foreground : t.muted)
                .tooltip(s.folder || "This space has no folder.")
                .when(!this.busy, (e) => e.cursor_pointer().hover((x) => x.bg(t.hover)).on_click((_e, cx) => this.pick(cx, s)))
                .child(s.name || s.id)))
              .when(!this.spaces.length, (x) => x.child(div().text_size(12).text_color(t.dim).child("No spaces yet. Make a space first.")))))
          .when(Boolean(this.error), (e) => e.child(div().p(8).rounded(6).bg(alpha(t.blocked, 0.12)).text_size(12).text_color(t.blocked).child(this.error)))
        .when(Boolean(this.busy), (e) => e.child(div().text_size(12).text_color(t.working).child(`${this.busy}…`)))
        .when(Boolean(this.notRepo), (e) => e.child(h_flex().justify_end().child(button("fs-git-init", "Make this a git repo", (cx) => this.gitInit(cx), true))))
        .when(Boolean(this.workspace), (e) => e.child(div().p(8).rounded(6).bg(alpha(t.accent, 0.10)).text_size(11.5).text_color(t.accent)
          .child(`Workspace with ${this.childRepos.length} repos. A run can change several of them, each in its own worktree under worktrees/<ticket>/<repo>.`)))
        .when(Boolean(this.space) && !this.notRepo, (e) => e
          .child(v_flex().gap(8)
            .child(h_flex().gap(6).items_center()
              .child(div().text_size(12).font_semibold().child(`Runs in this ${where}`))
              .child(div().px(6).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).child(String(this.runs.length))))
            .children(this.runs.map((r, i) => {
              const [state, color] = phase(r);
              return v_flex().id(`fs-run-${i}`).gap(8).p(10).rounded(8).bg(t.surface).border_1().border_color(t.border)
                .child(h_flex().gap(8).items_center()
                  .child(v_flex().flex_1().min_w(0)
                    .child(div().font_semibold().truncate().child(r.title || r.ticket))
                    .child(div().text_size(11.5).text_color(t.dim).truncate().child(`${r.ticket} · cycle ${r.head?.cycle ?? "?"} · ${r.branch ?? (r.repos?.length ? `${r.repos.length} repos` : "?")}`)))
                  .child(div().flex_none().text_size(11.5).text_color(color).child(state)))
                .child(h_flex().gap(8).justify_end().items_center()
                  .when(this.merged.has(r.dir), (x) => x.child(div().flex_1().text_size(11.5).text_color(t.done).child("PR merged")))
                  .when(!r.removed, (x) => x.child(button(`fs-open-${i}`, "Open", () => { this.openPanel(r); this.close(); })))
                  // A removed run (its folder stayed): Restore lists it again, its worktrees made again, in the picked space.
                  .when(Boolean(r.removed), (x) => x.child(button(`fs-restore-${i}`, "Restore", (cx) => this.restore(cx, r))))
                  // Follow-ups go through the run chat (Chat in the run window), the one place for them.
                  .when(Boolean(r.hasSpec), (x) => x.child(button(`fs-cont-${i}`, "New run from this", (cx) => this.continueFrom(cx, r)))));
            }))
            .when(!this.runs.length && !this.error, (x) => x.child(div().text_size(12).text_color(t.dim).child(`No forge run in this ${where} yet.`))))
          .child(v_flex().gap(8).p(12).rounded(8).bg(t.surface).border_1().border_color(t.border)
            .child(h_flex().justify_between().items_center()
              .child(div().text_size(12).font_semibold().child("New run"))
              .child(div().text_size(11).text_color(t.dim).truncate().child(this.repo?.top ?? this.folder ?? "")))
            .child(label("Ticket", "optional"))
            .child(inputField(this.ticket))
            .when(Boolean(this.workspace), (y) => y.child(label("Repos", "comma separated · grill can add more")).child(inputField(this.repoIn)))
            .child(label("What to build"))
            .child(areaField(this.goal))
            .child(label("References", "one per line · or drop files"))
            .child(areaField(this.refs))
            .when(Boolean(this.doc && !this.doc.ok), (y) => y.child(this.doctorView(t)))
            .child(this.runOptions(t))
            .child(h_flex().justify_between().items_center().pt(2)
              .child(div().text_size(11).text_color(t.dim).child(this.settings?.grill?.value === "me" ? "You answer the grill, TLA+ checks it, then you approve." : "Agents grill it, TLA+ checks it, then you approve."))
              .child(button("fs-start", "Start", (cx) => this.start(cx), true)))))
        .child(div().id("fs-settings-toggle").text_size(12).font_semibold().text_color(t.muted).cursor_pointer().hover((x) => x.text_color(t.foreground))
          .on_click((_e, cx) => { this.settingsOpen = !this.settingsOpen; cx.notify(); })
          .child(`${this.settingsOpen ? "▾" : "▸"} Settings`))
        .when(this.settingsOpen, (e) => e.child(this.settingsView(t, button))));
  }
}
