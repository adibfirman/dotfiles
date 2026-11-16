// forge-start: the dialog behind a space's "+". It reads the space folder's repo and its .forge runs:
// open a run, send it a follow-up, or start a new run in this folder (forge init --here).
// Opened as: openOverlay({ mod: "forge-start", kind: "dialog", props: { space, folder } }).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, openOverlay, closeOverlay, theme, exec, home, writeTextFile, notify, run, spaces, terminals, shared, setShared } from "herdr";

const forgeBin = () => `${home()}/.local/bin/forge`;
const alpha = (hex, a) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(a * 255).toString(16).padStart(2, "0") : hex);

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
// "claude.ai Atlassian" → "claude_ai_Atlassian", the server part of its tool names (as the forge CLI does).
const prefixOf = (v) => v.replace(/\(.*$/, "").trim().replace(/[^A-Za-z0-9_-]/g, "_");
const forge = async (args, cwd) => {
  const r = await exec(forgeBin(), args, { cwd, timeout: 120_000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  return { ok: r.code === 0, out: r.stdout, err: (r.stderr || r.stdout || "").trim() };
};

// The Pull request panel shows only when there is something to do with a PR: the run is done, and it is a
// workspace run, or on its own branch, or has commits not pushed yet. A run on the default branch with
// everything pushed has nothing to do (its commits went straight there).
async function wantsPrPanel(f) {
  if (f.head?.phase !== "done") return false;
  if (f.mode === "workspace") return true;
  const git = async (args) => {
    const r = await exec("git", args, { cwd: f.worktree }).catch(() => null);
    return r?.code === 0 ? r.stdout.trim() : null;
  };
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const def = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]))?.replace(/^origin\//, "") ?? "main";
  if (branch !== def) return true;
  return (await git(["rev-list", "--count", "@{upstream}..HEAD"])) !== "0";
}

// The run's live coordinator terminal, or null (at the gate, or when the run is done).
function liveCoord(f) {
  const a = f.coordinator?.terminal;
  return a && terminals().some((t) => t.address === a && t.state === "live") ? a : null;
}

// A forge run opens in one floating window (not a tab). shared "forge.window" tells the sidebar which run is open
// and which coordinator terminal it shows.
async function openRunWindow(f) {
  const title = f.title || f.ticket;
  const prs = await wantsPrPanel(f);
  const term = liveCoord(f);
  // Left: the coordinator's own Claude terminal, to type into as usual. Herdr closes a window when its terminal
  // ends, so at a phase handoff the sidebar reopens it with the next coordinator. With none running (the gate,
  // or done), a panel says so. Right: the forge graph above the PR view.
  // Each part is a framed panel with a gap around it.
  const panel = { background: "background", border: { width: 1, color: "border" }, radius: 8 };
  const layout = { type: "column", background: "chrome", children: [
    { type: "block", size: { px: 40 }, content: { mod: "forge-window", props: { part: "bar", title } } },
    { type: "row", padding: 8, gap: 8, children: [
      { type: "block", size: { weight: 1 }, min: 260, ...panel, content: term ? { terminal: term } : { mod: "forge-window", props: { part: "agent", run: f.dir } } },
      { type: "column", size: { weight: 1 }, min: 420, gap: 8, children: [
        { type: "block", size: { weight: 3 }, min: 220, ...panel, content: { mod: "forge", props: { run: f.dir } } },
        ...(prs ? [{ type: "block", size: { weight: 2 }, min: 100, ...panel, content: { mod: "prs", props: { run: f.dir } } }] : []),
      ] },
    ] },
  ] };
  const id = openOverlay({ kind: "window", key: "forge-run", width: 0.9, height: 0.88, layout });
  setShared("forge.window", { run: f.dir, id, terminal: term });
}

export default class ForgeStart extends View {
  init(_props, cx) {
    const p = props() ?? {};
    Object.assign(this, { space: p.space ?? null, folder: p.folder ?? null, overlay: p.overlay, repo: null, runs: [], error: null, busy: null, following: null, settings: null, settingsOpen: false, merged: new Set() });
    this.follow = TextareaState.new({ placeholder: "Follow-up: a QA bug, a change, or a review note", rows: 3 });
    this.ticket = InputState.new({ placeholder: "Ticket, like ABC-123 (empty: none)" });
    this.goal = TextareaState.new({ placeholder: "The goal, the rules, and the files it should touch", rows: 5 });
    // References: one per line (a doc URL, a Confluence page, a Jira key, a GitHub link, a file or image path).
    // Files dropped on the dialog are added here.
    // Workspace runs (a root that holds repos): which repos the change touches, one per line or comma separated.
    this.repoIn = InputState.new({ placeholder: "Repos, like api, web-app (grill can add more)" });
    this.refs = TextareaState.new({ placeholder: "A URL, a Confluence page, JIRA-123, or a file or image path", rows: 3 });
    // Settings → Allowed tools: one add row per phase (key cycles on click).
    this.toolIn = Object.fromEntries(["grill", "verify", "exec"].map((ph) => [ph, InputState.new({ placeholder: "pnpm lint" })]));
    this.toolKey = { grill: "bash", verify: "bash", exec: "bash" };
    // An entry the deny floor refused, per phase, so the row can offer "Force allow" for it.
    this.blocked = {};
    // MCP servers Claude Code knows here (claude.ai connectors), loaded when a row switches to "mcp".
    this.mcpList = null;
    for (const ph of ["grill", "verify", "exec"]) this.toolIn[ph].on("change", (_e, cx) => { if (this.toolKey[ph] === "mcp") cx.notify(); });
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
        .children(["opus", "sonnet", "haiku"].map((m) => chip(`fs-m-${i}-${m}`, m, value === m, (cx) => this.config(cx, ["model", ...known.map((r) => `${r}=${m}`)]))))
        .child(div().text_size(11).text_color(project ? t.accent : t.dim).child(project ? "project" : value === "mixed" ? "mixed" : "default"))
        .when(project, (e) => e.child(div().id(`fs-reset-${i}`).text_size(11).text_color(t.muted).cursor_pointer().hover((x) => x.text_color(t.foreground))
          .on_click((_e, cx) => this.config(cx, ["model", ...known.map((r) => `${r}=default`)])).child("reset")));
    });
    const KEYS = ["bash", "tools", "mcp", "read", "write"];
    const phases = ["grill", "verify", "exec"].map((ph) => {
      const src = s.sources[ph];
      const mine = s.project?.[ph] ?? [];
      const mineRules = new Set(mine.map((e) => (e.key === "bash" ? `Bash(${e.value}:*)` : e.key === "mcp" ? `mcp__${prefixOf(e.value)}` : e.value)));
      const forced = src.forced ?? [];
      const forcedRules = new Set(forced.map((f) => f.rule));
      const defaults = src.allow.filter((r) => !mineRules.has(r) && !forcedRules.has(r)).map(short);
      const blocked = this.blocked[ph];
      const query = this.toolKey[ph] === "mcp" ? this.toolIn[ph].value().trim().toLowerCase() : null;
      const picks = query !== null && this.mcpList ? this.mcpList.filter((m) => m.connector && (!query || m.name.toLowerCase().includes(query))).slice(0, 8) : [];
      return v_flex().id(`fs-tools-${ph}`).gap(6).p(8).rounded(6).bg(t.background).border_1().border_color(t.border)
        .child(h_flex().gap(8).items_start()
          .child(div().w(52).flex_none().text_size(12).font_semibold().child(ph))
          .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.muted)
            .child(`${defaults.join(", ")}${src.mcp.length ? ` · MCP: ${src.mcp.join(", ")}` : ""}`)))
        .when(mine.length > 0, (e) => e.child(h_flex().flex_wrap().gap(6).pl(60)
          .children(mine.map((m, i) => h_flex().id(`fs-mine-${ph}-${i}`).h(22).px(8).gap(6).items_center().rounded(5).bg(alpha(t.accent, 0.14)).text_size(11.5).text_color(t.accent)
            .child(`${m.key}: ${m.value}`)
            .when(editable, (c) => c.child(div().id(`fs-rm-${ph}-${i}`).text_color(t.muted).cursor_pointer().hover((x) => x.text_color(t.blocked))
              .tooltip("Remove from this repo").on_click((_e, cx) => this.config(cx, ["disallow", ph, m.key, m.value])).child("×")))))))
        // Force-allowed: past the deny floor, this repo and phase only. Red, so it is never missed.
        .when(forced.length > 0, (e) => e.child(h_flex().flex_wrap().gap(6).pl(60)
          .children(forced.map((m, i) => h_flex().id(`fs-forced-${ph}-${i}`).h(22).px(8).gap(6).items_center().rounded(5).bg(alpha(t.blocked, 0.14)).text_size(11.5).text_color(t.blocked)
            .tooltip(`Force-allowed: lifts ${m.lifts.map(short).join(", ")} for ${ph} in this repo`)
            .child(`⚠ ${m.key}: ${m.value}`)
            .when(editable, (c) => c.child(div().id(`fs-unforce-${ph}-${i}`).text_color(t.muted).cursor_pointer().hover((x) => x.text_color(t.foreground))
              .tooltip("Remove: the deny floor applies again").on_click((_e, cx) => this.config(cx, ["unforce", ph, m.key, m.value])).child("×")))))))
        .when(Boolean(blocked), (e) => e.child(h_flex().gap(8).items_center().ml(60).p(6).rounded(5).bg(alpha(t.blocked, 0.10))
          .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.blocked).child(blocked.err))
          .when(blocked.forceable, (c) => c.child(button(`fs-force-${ph}`, "Force allow", (cx) => { this.blocked[ph] = null; this.config(cx, ["force", ph, blocked.key, blocked.value]); })))
          .child(div().id(`fs-blocked-x-${ph}`).text_size(11.5).text_color(t.muted).cursor_pointer().on_click((_e, cx) => { this.blocked[ph] = null; cx.notify(); }).child("×"))))
        .when(editable, (e) => e.child(h_flex().gap(6).items_center().pl(60)
          .child(div().id(`fs-key-${ph}`).h(26).w(56).flex().items_center().justify_center().rounded(5).bg(t.raised).text_size(11.5).cursor_pointer()
            .hover((x) => x.bg(t.hover)).tooltip("Click to change: bash, tools, mcp, read, write")
            .on_click((_e, cx) => { this.toolKey[ph] = KEYS[(KEYS.indexOf(this.toolKey[ph]) + 1) % KEYS.length]; if (this.toolKey[ph] === "mcp") this.loadMcp(cx); cx.notify(); })
            .child(this.toolKey[ph]))
          .child(div().flex_1().h(26).px(8).flex().items_center().rounded(5).border_1().border_color(t.input).bg(t.popover)
            .child(Input.new(this.toolIn[ph]).h_full().text_size(11.5)))
          .child(button(`fs-add-${ph}`, "Add", (cx) => this.addTool(cx, ph)))))
        // MCP: a server from ~/.claude/mcp-servers.json, or a claude.ai connector (pick one; typing filters).
        .when(editable && query !== null, (e) => e.child(v_flex().gap(4).pl(60)
          .child(div().text_size(11).text_color(t.dim).child(this.mcpList ? "A server in ~/.claude/mcp-servers.json, or a claude.ai connector:" : "Loading claude.ai connectors…"))
          .child(h_flex().flex_wrap().gap(6).children(picks.map((m, i) => div().id(`fs-mcp-${ph}-${i}`).h(22).px(8).flex().items_center().rounded(5).bg(t.raised).text_size(11.5).text_color(t.muted)
            .cursor_pointer().hover((x) => x.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { this.toolIn[ph].set_value(m.name); this.addTool(cx, ph); }).child(m.name))))));
    });
    return v_flex().gap(8).p(12).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(div().text_size(11.5).text_color(t.dim).child(editable
        ? `Saved in ${this.workspace ? "this workspace's" : "this repo's"} .forge/, kept for every later run here. Models and tools apply from the next agent, the cap from the next cycle.`
        : "The defaults. They can be changed per repo or workspace."))
      .child(heading("Models"))
      .children(rows)
      .child(heading("Agents at once"))
      .child(h_flex().gap(6).items_center()
        .child(chip("fs-cap-dn", "−", false, (cx) => this.config(cx, ["cap", String(Math.max(1, s.cap.value - 1))])))
        .child(div().w(20).flex().justify_center().text_size(12).child(String(s.cap.value)))
        .child(chip("fs-cap-up", "+", false, (cx) => this.config(cx, ["cap", String(Math.min(8, s.cap.value + 1))])))
        .child(div().text_size(11).text_color(s.cap.from === "project" ? t.accent : t.dim).child(s.cap.from)))
      .child(heading("Allowed tools"))
      .children(phases)
      .child(div().id("fs-deny").text_size(11.5).text_color(t.dim).tooltip(s.deny.map((r) => (s.neverLift?.includes(r) ? `${short(r)}  (never liftable)` : short(r))).join("\n"))
        .child(`Deny floor: ${s.deny.length} rules, wins over anything above (hover to see). Add a blocked entry to get "Force allow" for this repo.`))
      .when(editable, (e) => e.child(h_flex().justify_end().child(button("fs-edit-sources", "Edit project SOURCES.md", (cx) => this.editSources(cx)))));
  }

  // Add one entry. When the deny floor refuses it, keep it so the row can offer "Force allow".
  addTool(cx, ph) {
    const value = this.toolIn[ph].value().trim();
    const key = this.toolKey[ph];
    if (!value || this.busy || !this.repo) return;
    this.toolIn[ph].set_value("");
    this.blocked[ph] = null;
    this.busy = "saving settings";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await forge(["config", "allow", ph, key, value, "--main", this.repo.main], this.repo.main);
      if (r.ok) this.settings = JSON.parse(r.out);
      else if (/deny floor/.test(r.err)) this.blocked[ph] = { key, value, err: `${value} is blocked by the deny floor.`, forceable: ["bash", "tools", "mcp"].includes(key) };
      else this.blocked[ph] = { key, value, err: r.err.replace(/^refused: /, ""), forceable: false };
      this.busy = null;
      cx.notify();
    });
  }

  loadMcp(cx) {
    if (this.mcpList || this.mcpLoading) return;
    this.mcpLoading = true;
    cx.spawn(async (cx) => {
      const r = await forge(["mcp", "list"], this.repo?.main ?? this.folder ?? home());
      this.mcpList = r.ok ? JSON.parse(r.out) : [];
      this.mcpLoading = false;
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

  // The run's floating window (the same one a click on its row in the spaces sidebar opens).
  openPanel(r) {
    openRunWindow(r);
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
      const init = await forge(this.workspace ? ["init", file] : ["init", file, "--here"], this.repo.top);
      if (!init.ok) throw new Error(init.err);
      const st = JSON.parse(init.out);
      const coord = await forge(["coord", "--run", st.run], this.repo.main);
      if (!coord.ok) {
        // The run exists but nothing runs it: remove it, so no dead row stays in the sidebar.
        await forge(["remove", "--run", st.run], this.repo.main);
        throw new Error(coord.err);
      }
      // Remember the space this run was started from: the spaces sidebar shows it there. The forge and prs
      // panes open only when you click the run's row (or Open), not on Start.
      if (this.space) setShared("forge.spaces", { ...(shared("forge.spaces") ?? {}), [st.run]: this.space });
      return `${st.ticket}: the grill coordinator is running. Click its row under the space to watch it.`;
    });
  }

  render(cx) {
    const t = theme();
    const name = this.repo ? this.repo.top.split("/").pop() : String(this.folder ?? "").split("/").pop();
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
      return h.phase === "gate" ? ["◆ waiting for you", t.accent] : h.phase === "done" ? ["✓ done", t.done] : [`● ${h.phase ?? "?"}`, t.working];
    };
    const where = this.workspace ? "workspace" : "repo";
    return v_flex().id("forge-start").size_full().min_h(0).bg(t.popover).text_color(t.foreground).text_size(13)
      .on_drop((e, cx) => this.dropped(e.paths ?? [], cx))
      .child(h_flex().h(44).flex_none().px(16).items_center().justify_between().border_b(1).border_color(t.border)
        .child(div().font_semibold().child(`Forge · ${name}`))
        .child(div().id("fs-close").text_color(t.muted).cursor_pointer().hover((x) => x.text_color(t.foreground)).on_click(() => this.close()).child("×")))
      .child(v_flex().id("fs-body").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(14)
        .when(Boolean(this.error), (e) => e.child(div().p(8).rounded(6).bg(alpha(t.blocked, 0.12)).text_size(12).text_color(t.blocked).child(this.error)))
        .when(Boolean(this.busy), (e) => e.child(div().text_size(12).text_color(t.working).child(`${this.busy}…`)))
        .when(Boolean(this.notRepo), (e) => e.child(h_flex().justify_end().child(button("fs-git-init", "Make this a git repo", (cx) => this.gitInit(cx), true))))
        .when(Boolean(this.workspace), (e) => e.child(div().p(8).rounded(6).bg(alpha(t.accent, 0.10)).text_size(11.5).text_color(t.accent)
          .child(`Workspace with ${this.childRepos.length} repos. A run can change several of them, each in its own worktree under worktrees/<ticket>/<repo>.`)))
        .when(!this.notRepo, (e) => e
          .child(v_flex().gap(8)
            .child(h_flex().gap(6).items_center()
              .child(div().text_size(12).font_semibold().child(`Runs in this ${where}`))
              .child(div().px(6).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).child(String(this.runs.length))))
            .children(this.runs.map((r, i) => {
              const [state, color] = phase(r);
              const open = this.following === r.dir;
              return v_flex().id(`fs-run-${i}`).gap(8).p(10).rounded(8).bg(t.surface).border_1().border_color(open ? t.accent : t.border)
                .child(h_flex().gap(8).items_center()
                  .child(v_flex().flex_1().min_w(0)
                    .child(div().font_semibold().truncate().child(r.title || r.ticket))
                    .child(div().text_size(11.5).text_color(t.dim).truncate().child(`${r.ticket} · cycle ${r.head?.cycle ?? "?"} · ${r.branch ?? (r.repos?.length ? `${r.repos.length} repos` : "?")}`)))
                  .child(div().flex_none().text_size(11.5).text_color(color).child(state)))
                .child(h_flex().gap(8).justify_end().items_center()
                  .when(this.merged.has(r.dir), (x) => x.child(div().flex_1().text_size(11.5).text_color(t.done).child("PR merged")))
                  .child(button(`fs-open-${i}`, "Open", () => { this.openPanel(r); this.close(); }))
                  .child(this.merged.has(r.dir)
                    ? button(`fs-cont-${i}`, "New run from this", (cx) => this.continueFrom(cx, r))
                    : button(`fs-follow-${i}`, open ? "Cancel" : "Follow up", (cx) => { this.following = open ? null : r.dir; this.follow.set_value(""); cx.notify(); })))
                .when(open, (x) => x
                  .child(label("Follow-up", "a QA bug, a change, a review note"))
                  .child(areaField(this.follow))
                  .child(label("References", "one per line · or drop files"))
                  .child(areaField(this.refs))
                  .child(h_flex().justify_end().child(button(`fs-send-${i}`, "Send follow-up", (cx) => this.sendFollow(cx, r), true))));
            }))
            .when(!this.runs.length && !this.error, (x) => x.child(div().text_size(12).text_color(t.dim).child(`No forge run in this ${where} yet.`))))
          .when(!this.following, (x) => x.child(v_flex().gap(8).p(12).rounded(8).bg(t.surface).border_1().border_color(t.border)
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
            .child(h_flex().justify_between().items_center().pt(2)
              .child(div().text_size(11).text_color(t.dim).child("Agents grill it, TLA+ checks it, then you approve."))
              .child(button("fs-start", "Start", (cx) => this.start(cx), true))))))
        .child(div().id("fs-settings-toggle").text_size(12).font_semibold().text_color(t.muted).cursor_pointer().hover((x) => x.text_color(t.foreground))
          .on_click((_e, cx) => { this.settingsOpen = !this.settingsOpen; cx.notify(); })
          .child(`${this.settingsOpen ? "▾" : "▸"} Settings`))
        .when(this.settingsOpen, (e) => e.child(this.settingsView(t, button))));
  }
}
