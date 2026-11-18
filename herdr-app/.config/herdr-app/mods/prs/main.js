// prs: the Pull request tab of a forge run window (props.run). The list shows this run's pull requests: one row per
// repo (a workspace run has several), any state, and a row for a repo with no PR yet. A row opens its detail:
// Overview (the Checks, Comments, and Approvals box, every check on a click, then the activity list), Commits, and
// Files changed.
// The window mounts this mod only while its Pull request tab shows, so the list loads when the tab opens. The detail
// data (commits, files, check times, required checks, reviewers asked) loads when a row opens. The last list, the
// details, and where you were live in shared "prs.cache" for this run: a reopened window draws them at once.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import * as fs from "fs/promises";
import { theme, exec, readTextFile, writeTextFile, notify, appHome, home, shared, setShared, props as given, window as host } from "herdr";
import { activity, ago, bodyParts, checkLine, overview, prState, reviewWord, sortChecks, sortPrs, stateIcon, timeline } from "./model.js";
import { failedLog, fetchPrDetail, fetchRunPrs, openThreads } from "./github.js";

// A Lucide icon from omarchy-chrome/; it takes the text color of its parent.
const ico = (name, size) => svg(`mods/omarchy-chrome/${name}.svg`).size(size).flex_none();

const REFRESH_MS = 120_000;
const forgeBin = () => `${home()}/.local/bin/forge`;
const alpha = (hex, a) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(a * 255).toString(16).padStart(2, "0") : hex);

// One retry: GitHub sometimes answers these queries with a 502.
const twice = async (f) => {
  try {
    return await f();
  } catch {
    return await f();
  }
};

// Push the current branch to the same name on origin and make that its upstream. Always this form: a branch
// made from origin/<base> can track the base, and a plain push would then aim at the base (git refuses).
const pushHead = (cwd) => exec("git", ["push", "-u", "origin", "HEAD"], { cwd, timeout: 120_000 }).catch((e) => ({ code: 1, stderr: String(e?.message ?? e), stdout: "" }));

// A loading placeholder: a grey bar with a lighter band that slides across it and back (a shimmer). w: px, or
// null for the full width.
const shimmer = (t, w, h = 12) => div().h(h).flex_none().relative().overflow_hidden().rounded(4).bg(alpha(t.foreground, 0.06))
  .when(w == null, (e) => e.w_full()).when(w != null, (e) => e.w(w))
  .child(div().absolute().top(0).h(h).w(80).bg(alpha(t.foreground, 0.14)).loop("left", { from: -80, to: 520, period: 1600, easing: "linear" }));

export default class Prs extends View {
  init(_props, cx) {
    this.run = given()?.run ?? null;
    Object.assign(this, { items: [], local: new Map(), error: null, loading: false, at: null, open: null, sub: "overview",
      details: new Map(), detailLoading: null, detailError: null, busy: null, config: {},
      // The checks list (closed at first), and the opened folds of the activity list (resolved threads, older commits).
      checksOpen: false, unfolded: new Set() });
    // The Push or Create PR the user clicked last, per item: { kind, status, cmd, out, result, at }. Shown as a
    // Progress step until a refresh shows the new state (done), or until the next action (failed).
    this.actions = new Map();
    const c = shared("prs.cache");
    if (this.run && c?.run === this.run) {
      Object.assign(this, { items: c.items ?? [], local: new Map(c.local ?? []), at: c.at ?? null, open: c.open ?? null,
        sub: c.sub ?? "overview", details: new Map(c.details ?? []) });
      // A step still "running" in the cache lost its task when the last window closed (a handoff or ×).
      this.actions = new Map((c.actions ?? []).map(([k, a]) => [k, a.status === "running"
        ? { ...a, status: "failed", out: "The window closed while this ran. Check GitHub, then try again." } : a]));
    }
    // A new copy runs no action yet: a lock left by a closed copy goes.
    if (this.run && shared("prs.busy")?.run === this.run) setShared("prs.busy", null);
    if (!this.run) return;
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  // The window goes (a tab switch reopens it): keep where you were for the next window of this run.
  close() {
    if (this.busy) setShared("prs.busy", null);
    this.saveCache();
  }

  // shared "prs.cache": this run's list, details, open row, and sub-tab (one run only). Written only when it changed.
  saveCache() {
    if (!this.run) return;
    const c = { run: this.run, at: this.at, items: this.items, local: [...this.local], open: this.open, sub: this.sub, details: [...this.details], actions: [...this.actions] };
    const key = JSON.stringify(c);
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    setShared("prs.cache", c);
  }

  // ---------------------------------------------------------------- data

  refresh(cx) {
    if (this.loading || !this.run) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // Ticket links come from an untracked local file, so no company URL lives in dotfiles.
        this.config = JSON.parse((await readTextFile(`${appHome()}/data/prs/config.json`)) ?? "{}");
        const items = await this.runItems();
        this.items = items;
        if (this.open && !items.some((i) => i.key === this.open)) this.open = null;
        this.error = null;
        this.at = new Date().toISOString();
        this.local = await this.localInfo(items);
        // A done action has served its purpose once the refreshed data shows it: nothing left to push, or a PR.
        for (const [key, a] of this.actions) {
          if (a.status !== "done") continue;
          const it = items.find((i) => i.key === key);
          if ((a.kind === "push" && this.local.get(key)?.ahead === 0) || (a.kind === "create" && it?.pr)) this.actions.delete(key);
        }
        if (this.open) this.loadDetail(cx, this.open);
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        await this.writeState();
        this.loading = false;
        this.saveCache();
        cx.notify();
      }
    });
  }

  // This run's rows, each with its newest PR (open, merged, or closed). A workspace run gives one row per repo in
  // it; a repo run (or a workspace run with no repo yet) one row. PRs first, most urgent first.
  async runItems() {
    const r = await exec(forgeBin(), ["runs"], { timeout: 30_000 });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || "forge runs failed");
    const fr = JSON.parse(r.stdout).find((x) => x.dir === this.run);
    if (!fr) throw new Error("This run is not in `forge runs`.");
    const rows = fr.mode === "workspace" && fr.repos?.length
      ? fr.repos.map((rp) => ({ ...fr, dir: `${fr.dir}#${rp.name}`, runDir: fr.dir, repo: rp.remote, branch: rp.branch, worktree: rp.worktree, repoName: rp.name, title: `${fr.title || fr.ticket} · ${rp.name}` }))
      : [{ ...fr, runDir: fr.dir }];
    const prs = await twice(() => fetchRunPrs(rows));
    const items = rows.map((x) => ({ key: x.dir, fr: x, pr: prs.get(x.dir) ?? null }));
    const withPr = sortPrs(items.filter((i) => i.pr).map((i) => i.pr)).map((pr) => items.find((i) => i.pr === pr));
    return [...withPr, ...items.filter((i) => !i.pr)];
  }

  // For each row: its worktree, how far it is ahead, its branch and the repo's default branch, and its forge state.
  async localInfo(items) {
    const local = new Map();
    for (const item of items) {
      const cwd = item.fr?.worktree ?? null;
      if (!cwd) continue;
      const git = async (args) => {
        const r = await exec("git", args, { cwd }).catch(() => null);
        return r?.code === 0 ? r.stdout.trim() : null;
      };
      // Commits on no remote branch: right before the first push (no upstream yet) and after it.
      const ahead = await git(["rev-list", "--count", "HEAD", "--not", "--remotes"]);
      // A run on the default branch commits straight to it, so it has no PR.
      const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
      const def = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
      local.set(item.key, {
        cwd, ahead: ahead === null ? null : Number(ahead), branch, base: def ? def.replace(/^origin\//, "") : "main",
        forge: { dir: item.fr.runDir ?? item.fr.dir, main: item.fr.main, ticket: item.fr.ticket, ...(item.fr.head ?? {}) },
      });
    }
    return local;
  }

  // The detail data for one row with a PR: on open, and on each refresh while it is open.
  loadDetail(cx, key) {
    const item = this.items.find((i) => i.key === key);
    if (!item?.pr || this.detailLoading === key) return;
    this.detailLoading = key;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.details.set(key, await twice(() => fetchPrDetail(item.pr)));
        if (this.detailError?.key === key) this.detailError = null;
      } catch (e) {
        this.detailError = { key, text: String(e?.message ?? e) };
      } finally {
        if (this.detailLoading === key) this.detailLoading = null;
        this.saveCache();
        cx.notify();
      }
    });
  }

  openRow(cx, key) {
    this.open = key;
    this.sub = "overview";
    this.checksOpen = false;
    this.unfolded = new Set();
    this.saveCache();
    this.loadDetail(cx, key);
    cx.notify();
  }

  // What this copy sees, for debugging without a screenshot.
  async writeState() {
    await fs.mkdir(`${appHome()}/data/prs`, { recursive: true }).catch(() => {});
    await fs.writeFile(`${appHome()}/data/prs/last-state.json`, JSON.stringify({
      at: new Date().toISOString(), run: this.run, error: this.error,
      items: this.items.map((i) => ({ run: i.fr?.ticket ?? null, pr: i.pr ? `${i.pr.repo}#${i.pr.number} ${prState(i.pr).label}` : null, forge: this.local.get(i.key)?.forge?.phase ?? null })),
    }, null, 2)).catch(() => {});
  }

  // ---------------------------------------------------------------- actions

  // Open a link from PR data in the browser: https only (a check's link comes from the CI workflow).
  openUrl(url) {
    if (!/^https:\/\//i.test(String(url ?? ""))) return;
    exec(host().platform === "linux" ? "xdg-open" : "open", [url]);
  }

  // One action at a time. shared "prs.busy" = { run, label } while it runs: the window's tabs lock, because a tab
  // switch closes this copy, and herdr cancels a closed copy's unfinished task (a Create PR could stop after the push).
  task(cx, label, work) {
    if (this.busy) return;
    this.busy = label;
    setShared("prs.busy", { run: this.run, label });
    cx.notify();
    cx.spawn(async (cx) => {
      let res;
      try {
        res = await work();
      } catch (e) {
        res = { ok: false, body: String(e?.message ?? e) };
      }
      this.busy = null;
      setShared("prs.busy", null);
      this.saveCache();
      notify({ title: label.replace(/^./, (c) => c.toUpperCase()), body: String(res.body ?? "").slice(0, 300) || "Done.", level: res.ok ? "success" : "error" });
      this.refresh(cx);
    });
  }

  // Record the clicked action as a Progress step, run it, then mark it done or failed.
  act(cx, item, kind, cmd, label, work) {
    if (this.busy) return;
    this.actions.set(item.key, { kind, status: "running", cmd, at: Date.now() });
    this.saveCache();
    this.task(cx, label, async () => {
      const res = await work();
      this.actions.set(item.key, { kind, status: res.ok ? "done" : "failed", cmd, out: res.body, result: res.result, at: Date.now() });
      return res;
    });
  }

  push(cx, item, l) {
    const n = l.ahead;
    this.act(cx, item, "push", "git push -u origin HEAD", "push", async () => {
      const r = await pushHead(l.cwd);
      const result = n ? `pushed ${n} commit${n === 1 ? "" : "s"}` : "pushed";
      return { ok: r.code === 0, body: (r.stderr || r.stdout).trim(), result };
    });
  }

  // A draft PR from the current cycle's exec/PR.md (the title from its first line).
  createPr(cx, item, l) {
    this.act(cx, item, "create", "git push -u origin HEAD, then gh pr create --draft", "create PR", async () => {
      const runDir = item.fr.runDir ?? item.fr.dir;
      const cycleDir = `${runDir}/cycles/${item.fr.head.dir}`;
      const own = item.fr.repoName ? await readTextFile(`${cycleDir}/exec/PR-${item.fr.repoName}.md`) : null;
      const text = own ?? (await readTextFile(`${cycleDir}/exec/PR.md`));
      if (!text) return { ok: false, body: "No exec/PR.md in the current cycle yet." };
      const [first, ...rest] = text.split("\n");
      const bodyFile = `${cycleDir}/exec/PR.body-${item.fr.repoName ?? "run"}.md`;
      await writeTextFile(bodyFile, rest.join("\n").trim() + "\n", await readTextFile(bodyFile));
      const meta = JSON.parse((await readTextFile(`${runDir}/run.json`)) ?? "{}");
      const base = item.fr.repoName ? meta.repos?.find((x) => x.name === item.fr.repoName)?.base ?? "main" : meta.base ?? "main";
      // gh needs the branch on GitHub first: push it (a no-op when it is up to date), then name it as the head.
      const pushed = await pushHead(l.cwd);
      if (pushed.code !== 0) return { ok: false, body: `push failed: ${(pushed.stderr || pushed.stdout).trim()}` };
      const head = (await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: l.cwd })).stdout.trim();
      const r = await exec("gh", ["pr", "create", "--draft", "--base", base, "--head", head, "--title", first.replace(/^#\s*/, "").trim(), "--body-file", bodyFile], { cwd: l.cwd, timeout: 120_000 });
      const num = /\/pull\/(\d+)/.exec(r.stdout ?? "")?.[1];
      return { ok: r.code === 0, body: (r.code === 0 ? r.stdout : r.stderr || r.stdout).trim(), result: num ? `PR #${num} opened` : "draft PR opened" };
    });
  }

  // The failing checks' logs and the open review threads, collected into a file and handed to the run chat
  // (the one place for follow-ups): it reads them with the user, who decides what to fix.
  sendToChat(cx, pr, l) {
    this.task(cx, "send to chat", async () => {
      const parts = [`# ${pr.repo}#${pr.number}: ${pr.title}`, "", `Branch \`${pr.head}\` → \`${pr.base}\`. ${pr.url}`, ""];
      const what = [];
      const failed = pr.checks.filter((c) => c.status === "failed");
      if (failed.length) {
        what.push(`CI failed (${failed.map((c) => c.name).join(", ")})`);
        parts.push("## Failed checks", "");
        for (const c of failed) {
          const log = await failedLog(pr, c.url);
          parts.push(`### ${c.name}`, "", c.url ?? "", "", ...(log ? ["```", log, "```", ""] : ["(no log found)", ""]));
        }
      }
      if (pr.unresolved > 0 || pr.reviewDecision === "CHANGES_REQUESTED") {
        const threads = await openThreads(pr);
        what.push(`${threads.length} open review threads`);
        parts.push("## Open review threads", "", ...threads.map((th) => `- \`${th.path}:${th.line ?? "?"}\` (${th.author}): ${th.body.replace(/\s+/g, " ").slice(0, 500)}`), "");
      }
      const inbox = `${l.forge.dir}/inbox`;
      const file = `${inbox}/pr-${pr.number}-${Date.now()}.md`;
      await exec("mkdir", ["-p", inbox]);
      await writeTextFile(file, parts.join("\n") + "\n", null);
      const message = `PR #${pr.number} has ${what.join(" and ") || "review feedback"}, collected in ${file}. Read it, summarize each item, and ask me which ones to fix. Send the follow-up with --source pr only after I say yes.`;
      const r = await exec(forgeBin(), ["chat", "--open", "--run", l.forge.dir, "--message", message], { cwd: l.forge.main, timeout: 120_000 });
      if (r.code !== 0) return { ok: false, body: (r.stderr || r.stdout).trim() };
      // The sidebar's projects list opens the run window with the chat on the left.
      setShared("forge.open", { dir: l.forge.dir, view: "chat", at: Date.now() });
      return { ok: true, body: "The run chat has the PR findings. Answer it there." };
    });
  }

  // ---------------------------------------------------------------- view

  render(cx) {
    const t = theme();
    const item = this.open && this.items.find((i) => i.key === this.open);
    return v_flex().id("prs").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).overflow_hidden()
      // In a run window, a press that reaches the window drags it: stop presses here, so the window stays where it is.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(item ? this.detail(t, item) : this.list(t));
  }

  color(t, kind) {
    return kind === "bad" ? t.blocked : kind === "good" ? t.done : kind === "wait" ? t.working : kind === "merged" ? t.ansi5 ?? t.accent : t.muted;
  }

  stepIcon(t, status) {
    const c = status === "done" || status === "passed" ? t.done : status === "failed" ? t.blocked : status === "running" ? t.working : t.dim;
    const ch = status === "done" || status === "passed" ? "check" : status === "failed" ? "x" : status === "running" ? "loader-circle" : "circle";
    return div().w(18).h(18).flex_none().flex().items_center().justify_center().rounded_full().bg(alpha(c, 0.18)).text_color(c).child(ico(ch, 11));
  }

  button(t, id, label, f, primary = false) {
    return div().id(id).h(26).px(10).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).hover((s) => s.bg(primary ? t.solid : t.hover))
      .on_click((_e, cx) => f(cx)).child(label);
  }

  list(t) {
    const first = this.loading && !this.items.length && !this.error;
    const many = this.items.length > 1;
    return v_flex().size_full().min_h(0)
      .child(h_flex().h(44).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Pull requests"))
        .child(div().px(6).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).child(String(this.items.filter((i) => i.pr).length)))
        .child(div().flex_1())
        .child(div().id("prs-refresh").w(24).h(24).flex().items_center().justify_center().rounded(5).text_size(12).text_color(t.muted).cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip(this.loading ? "Loading…" : this.at ? `Updated ${ago(this.at)}` : "Refresh").on_click((_e, cx) => this.refresh(cx))
          .child(ico(this.loading ? "spinner" : "refresh-cw", 13))))
      .when(Boolean(this.error), (e) => e.child(div().px(14).py(6).text_size(11).text_color(t.blocked).child(this.error)))
      .child(v_flex().id("prs-list").flex_1().min_h(0).overflow_y_scrollbar()
        .when(first, (e) => e.children([0, 1, 2].map((i) => v_flex().id(`prs-skel-${i}`).gap(6).px(14).py(10).border_b(1).border_color(t.border)
          .child(shimmer(t, 260, 13)).child(shimmer(t, 180, 10)))))
        .children(this.items.map((i) => this.row(t, i, many)))
        .when(!this.items.length && !this.loading && !this.error, (e) => e.child(div().p(12).text_color(t.dim).child("This run has no branch for a PR yet."))));
  }

  // One list row, GitHub style: the state icon, the title and labels, then `#number · author opened X ago ·
  // review · checks n/m`, and the comment count on the right. many: show the repo name (a workspace run).
  row(t, item, many) {
    const { pr, fr } = item, l = this.local.get(item.key);
    const line = h_flex().id(`row-${item.key}`).gap(10).px(14).py(9).items_start().border_b(1).border_color(t.border).cursor_pointer()
      .hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.openRow(cx, item.key));
    if (!pr) {
      return line
        .child(div().w(16).h(18).flex_none().flex().items_center().text_color(t.dim).child(ico("circle", 14)))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().font_semibold().truncate().child(fr.title || fr.ticket))
          .child(div().text_size(11.5).text_color(t.dim).truncate()
            .child(`No PR yet · ${fr.repo?.split("/")[1] ?? "local repo"} · ${fr.branch ?? "?"}${l?.ahead ? ` · ${l.ahead} not pushed` : ""}`)));
    }
    const icon = stateIcon(pr);
    const review = pr.state === "OPEN" ? reviewWord(pr) : "";
    const ci = pr.ci.total ? `${pr.ci.passed}/${pr.ci.total}` : "";
    const ciIcon = pr.ci.status === "failed" ? "x" : pr.ci.status === "running" ? "loader-circle" : "check";
    const ciColor = pr.ci.status === "failed" ? t.blocked : pr.ci.status === "running" ? t.working : t.done;
    return line
      .child(div().w(16).h(18).flex_none().flex().items_center().text_color(this.color(t, icon.kind)).tooltip(icon.label).child(ico(icon.icon, 14)))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(div().font_semibold().truncate().child(pr.title))
          .children(pr.labels.map((lb, i) => this.label(t, `lb-${item.key}-${i}`, lb))))
        .child(h_flex().gap(4).items_center().min_w(0).text_size(11.5).text_color(t.dim)
          .child(div().truncate().child(`${many ? `${pr.repo.split("/")[1]} ` : ""}#${pr.number}${pr.author ? ` · ${pr.author}` : ""} opened ${ago(pr.createdAt)}${review ? ` · ${review}` : ""}`))
          .when(Boolean(ci), (e) => e.child(h_flex().flex_none().gap(3).items_center().text_color(ciColor).child("·").child(ico(ciIcon, 11)).child(ci)))))
      .when(pr.comments > 0, (e) => e.child(h_flex().flex_none().gap(4).items_center().text_size(11.5).text_color(t.muted).child(ico("message-square", 12)).child(String(pr.comments))));
  }

  label(t, id, lb) {
    const c = /^[0-9a-f]{6}$/i.test(lb.color ?? "") ? `#${lb.color}` : t.muted;
    return div().id(id).flex_none().px(7).h(18).flex().items_center().rounded(9).text_size(10.5)
      .border_1().border_color(alpha(c, 0.6)).bg(alpha(c, 0.18)).text_color(t.foreground).child(lb.name);
  }

  subTab(t, key, label, count) {
    const on = this.sub === key;
    return h_flex().id(`prs-sub-${key}`).h(34).px(10).gap(6).items_center().text_size(12.5).border_b(2)
      .border_color(on ? t.accent : t.background).text_color(on ? t.foreground : t.muted)
      .when(!on, (e) => e.cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.sub = key; this.saveCache(); cx.notify(); }))
      .child(label)
      .when(count != null, (e) => e.child(div().px(6).rounded(9).bg(t.raised).text_size(11).text_color(t.muted).child(String(count))));
  }

  detail(t, item) {
    const { pr, fr } = item, l = this.local.get(item.key);
    const d = this.details.get(item.key) ?? null;
    const ticket = pr?.ticket ?? (fr && !fr.ticket.startsWith("local-") ? fr.ticket : null);
    const ticketUrl = ticket && this.config.ticketUrl ? this.config.ticketUrl.replace("{key}", ticket) : null;
    const canSend = Boolean(pr && l?.forge) && pr.state === "OPEN" && (pr.ci.status === "failed" || pr.unresolved > 0 || pr.reviewDecision === "CHANGES_REQUESTED");
    const onBase = Boolean(l?.branch) && l.branch === l.base;
    const canCreate = !pr && Boolean(fr?.repo) && l?.forge?.phase === "done" && !onBase;
    const canPush = Boolean(l) && (pr ? pr.state === "OPEN" : Boolean(fr?.repo)) && l.ahead !== 0;
    const icon = pr ? stateIcon(pr) : null;
    const head = v_flex().flex_none().gap(4).px(14).pt(12).pb(8)
      .child(div().text_size(15).font_semibold().child(pr?.title ?? (fr.title || fr.ticket)))
      .child(h_flex().gap(8).items_center().min_w(0).text_size(11.5).text_color(t.dim)
        .when(Boolean(icon), (e) => e.child(h_flex().flex_none().gap(4).items_center().text_color(this.color(t, icon.kind)).child(ico(icon.icon, 12)).child(icon.label)))
        .child(div().truncate().child(pr ? `${pr.repo} #${pr.number}${pr.author ? ` · ${pr.author}` : ""} · ${pr.head} → ${pr.base}` : `${fr.repo ?? "no GitHub remote"} · ${fr.branch ?? "?"}`))
        .when(Boolean(ticket), (e) => e.child(div().flex_none().child("·")).child(div().id("prs-ticket").flex_none()
          .text_color(ticketUrl ? t.accent : t.muted).when(Boolean(ticketUrl), (x) => x.cursor_pointer().on_click(() => this.openUrl(ticketUrl))).child(ticket)))
        .when(pr?.state === "OPEN" && pr.mergeable === "CONFLICTING", (e) => e.child(div().flex_none().text_color(t.blocked).child("· Merge conflict"))));
    const body = v_flex().id("prs-detail").flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(8);
    if (!pr) {
      body.when(onBase, (e) => e.child(div().text_size(12).text_color(t.muted).child(l.ahead
        ? `On ${l.base}: commits go straight to ${l.base}, so there is no PR. ${l.ahead} not pushed yet.`
        : `On ${l.base}: commits go straight to ${l.base}, so there is no PR. Everything is pushed.`)));
      // Progress shows only before a PR: the push and the draft PR to come. With a PR, the Overview tells its story.
      this.steps(t, body, fr?.repo && !onBase ? timeline(null, Date.now(), { ahead: l?.ahead ?? null, base: l?.base ?? "main", action: this.actions.get(item.key) ?? null }) : []);
    } else if (this.sub === "commits") this.commits(t, body, pr, d, item.key);
    else if (this.sub === "files") this.files(t, body, pr, d, item.key);
    else this.overviewTab(t, body, pr, d, item.key);
    return v_flex().size_full().min_h(0)
      .child(h_flex().h(40).flex_none().px(12).items_center().justify_between().border_b(1).border_color(t.border)
        .child(h_flex().id("prs-back").gap(2).items_center().text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.open = null; this.saveCache(); cx.notify(); }).child(ico("chevron-left", 13)).child("List"))
        .when(Boolean(pr), (e) => e.child(h_flex().id("prs-gh").gap(4).items_center().text_size(12).text_color(t.muted).cursor_pointer().on_click(() => this.openUrl(pr.url)).child("GitHub").child(ico("external-link", 12)))))
      .child(head)
      .when(Boolean(pr), (e) => e.child(h_flex().flex_none().px(10).gap(2).border_b(1).border_color(t.border)
        .child(this.subTab(t, "overview", "Overview", null))
        .child(this.subTab(t, "commits", "Commits", d ? d.commitCount : null))
        .child(this.subTab(t, "files", "Files changed", d ? d.fileCount : pr.changedFiles))))
      .child(body)
      .child(h_flex().h(44).flex_none().px(12).gap(8).items_center().justify_end().border_t(1).border_color(t.border)
        .when(Boolean(this.busy), (e) => e.child(div().flex_1().text_size(11.5).text_color(t.working).child(`${this.busy}…`)))
        .when(canPush, (e) => e.child(this.button(t, "prs-push", l.ahead === null ? "Push" : `Push ${l.ahead}`, (cx) => this.push(cx, item, l))))
        .when(canCreate, (e) => e.child(this.button(t, "prs-create", "Create PR", (cx) => this.createPr(cx, item, l), true)))
        .when(canSend, (e) => e.child(div().id("prs-chat-tip").tooltip("Collects the failed checks and open review threads, and opens the run chat with them. You pick what to fix there.")
          .child(this.button(t, "prs-chat", "Send to chat", (cx) => this.sendToChat(cx, pr, l), true)))));
  }

  // The box (Checks, Comments, Approvals, each with a bar, like GitHub's merge box). A click on its Checks part
  // shows every check: failed first, with its run time and a "Required" badge; a click opens the check. Then the
  // activity list.
  overviewTab(t, body, pr, d, key) {
    if (!d && this.detailLoading === key) {
      body.child(h_flex().rounded(8).border_1().border_color(t.border)
          .children([0, 1, 2].map((i) => v_flex().id(`ov-skel-${i}`).flex_1().gap(8).p(10).child(shimmer(t, 110, 12)).child(shimmer(t, null, 4)))))
        .children([0, 1, 2].map((i) => h_flex().id(`chk-skel-${i}`).gap(8).items_center().child(shimmer(t, 18, 18)).child(shimmer(t, 220, 12))));
      return;
    }
    const o = overview(pr, d);
    body.child(h_flex().rounded(8).border_1().border_color(t.border).overflow_hidden()
      .child(this.part(t, "ov-checks", o.checks, false, this.checksOpen))
      .child(this.part(t, "ov-comments", o.comments, true))
      .child(this.part(t, "ov-approvals", o.approvals, true)));
    if (!d && this.detailError?.key === key) body.child(div().text_size(11).text_color(t.blocked).child(`Could not load the details: ${this.detailError.text}`));
    const checks = sortChecks(d?.checks ?? pr.checks);
    body.when(this.checksOpen, (e) => e.child(div().text_size(11.5).text_color(t.dim).child(`${checks.length} check${checks.length === 1 ? "" : "s"}`))
      .children(checks.map((c, i) => h_flex().id(`chk-${i}`).gap(8).items_center().py(2).rounded(4)
        .when(Boolean(c.url), (r) => r.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.openUrl(c.url)))
        .child(this.stepIcon(t, c.status))
        .child(div().flex_none().text_size(12.5).child(c.name))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(checkLine(c)))
        .when(c.required === true, (r) => r.child(div().flex_none().px(7).h(18).flex().items_center().rounded(9).border_1().border_color(t.border)
          .text_size(10.5).text_color(t.muted).child("Required"))))));
    if (d) this.activityList(t, body, pr, d);
  }

  // One part of the Overview box: its title, a line in its color, and a bar of one segment per unit. open (true
  // or false) is only for the Checks part: it gets a chevron, and a click opens or closes the checks list.
  part(t, id, p, divider, open = null) {
    return v_flex().id(id).flex_1().min_w(0).gap(8).p(10).when(divider, (e) => e.border_l(1).border_color(t.border))
      .when(open !== null, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.checksOpen = !this.checksOpen; cx.notify(); }))
      .child(h_flex().gap(6).items_center().min_w(0)
        .when(open !== null, (e) => e.child(div().flex_none().flex().items_center().text_color(t.dim).child(ico(open ? "chevron-down" : "chevron-right", 12))))
        .child(div().flex_none().text_size(12.5).font_semibold().child(p.title))
        .child(div().truncate().text_size(11.5).text_color(this.color(t, p.kind)).child(p.sub)))
      .child(h_flex().h(4).w_full().gap(1).rounded(2).overflow_hidden()
        .children(p.bar.map((k) => div().h_full().flex_1().bg(k === "idle" ? t.raised : this.color(t, k)))));
  }

  // A click handler that opens or closes one fold of the activity list (a resolved thread, a group's older commits).
  fold(key) {
    return (_e, cx) => {
      if (this.unfolded.has(key)) this.unfolded.delete(key);
      else this.unfolded.add(key);
      cx.notify();
    };
  }

  // The activity list under the box: comments, reviews, code threads, and commits on one rail, newest first.
  // Read only: to answer or resolve, use GitHub.
  activityList(t, body, pr, d) {
    const who = (x) => h_flex().gap(6).items_center().min_w(0).text_size(11.5)
      .child(div().flex_none().font_semibold().child(x.author))
      .when(Boolean(x.bot), (e) => e.child(div().flex_none().px(5).rounded(8).border_1().border_color(t.border).text_size(10).text_color(t.muted).child("bot")))
      .child(div().flex_none().text_color(t.dim).child(x.at ? `· ${ago(x.at)}` : ""));
    const badge = (text, color) => div().flex_none().px(7).rounded(9).text_size(10.5).bg(alpha(color, 0.16)).text_color(color).child(text);
    const card = (id) => v_flex().id(id).min_w(0).rounded(8).border_1().border_color(t.border).bg(t.surface).overflow_hidden();
    // A link in a comment opens through openUrl (https only): anyone who can comment on the PR writes this text.
    const md = (id, text) => div().min_w(0).text_size(12).child(TextView.markdown(id, text).on_link_click((url) => this.openUrl(url)));
    // A comment body: markdown, and each <details> block as a line with an arrow that opens on a click (as on
    // GitHub). A block the author marked open starts open.
    const bodyView = (id, list) => v_flex().gap(6).min_w(0).children(list.map((p, k) => {
      if (p.kind === "md") return md(`${id}-${k}`, p.text);
      const key = `dt:${id}-${k}:${p.summary}`;
      const shown = p.open ? !this.unfolded.has(key) : this.unfolded.has(key);
      return v_flex().gap(4).min_w(0)
        .child(h_flex().id(`${id}-${k}-sum`).gap(6).items_center().min_w(0).text_size(12).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click(this.fold(key))
          .child(div().flex_none().flex().items_center().text_color(t.dim).child(ico(shown ? "chevron-down" : "chevron-right", 12)))
          .child(div().min_w(0).truncate().font_semibold().child(p.summary)))
        .when(shown, (e) => e.child(div().pl(18).min_w(0).child(bodyView(`${id}-${k}`, p.parts))));
    }));
    const hunkLine = (h) => h_flex().gap(8).px(10).h(18).text_size(11.5)
      .when(h.sign === "+", (e) => e.bg(alpha(t.done, 0.12))).when(h.sign === "-", (e) => e.bg(alpha(t.blocked, 0.12)))
      .child(div().w(36).flex_none().text_color(t.dim).child(String(h.n)))
      .child(div().w(8).flex_none().text_color(h.sign === "+" ? t.done : h.sign === "-" ? t.blocked : t.dim).child(h.sign))
      .child(div().flex_1().min_w(0).truncate().child(h.text));
    const commitLine = (c) => h_flex().gap(8).items_center().min_w(0).h(18).text_size(12)
      .child(div().min_w(0).truncate().child(c.title))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(c.at ? `· ${ago(c.at)}` : ""))
      .child(div().flex_1())
      .child(div().flex_none().text_size(11).text_color(t.dim).child(c.oid.slice(0, 7)));
    const items = activity(pr, d);
    const rows = items.map((it, i) => {
      const id = `act-${i}`;
      let icon = "message-square", color = t.muted, content;
      if (it.kind === "comment" || it.kind === "review") {
        const word = it.kind === "review" && it.state === "APPROVED" ? "Approved" : it.kind === "review" && it.state === "CHANGES_REQUESTED" ? "Changes requested" : null;
        if (word === "Approved") { icon = "circle-check"; color = t.done; }
        if (word === "Changes requested") { icon = "circle-alert"; color = t.blocked; }
        content = card(`${id}-card`)
          .child(h_flex().px(10).py(6).gap(6).items_center().min_w(0).child(who(it)).child(div().flex_1())
            .when(Boolean(word), (e) => e.child(badge(word, color))))
          .when(Boolean(it.body), (e) => e.child(div().px(10).py(8).border_t(1).border_color(t.border).child(bodyView(`${id}-md`, bodyParts(it.body)))));
      } else if (it.kind === "thread") {
        const key = `th:${it.path}:${it.lines}:${it.at}`;
        const closed = it.resolved && !this.unfolded.has(key);
        icon = "file-text";
        color = it.resolved ? t.muted : t.blocked;
        content = card(`${id}-card`)
          .child(h_flex().id(`${id}-head`).px(10).py(6).gap(6).items_center().min_w(0).text_size(11.5)
            .when(it.resolved, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(this.fold(key))
              .child(div().flex_none().flex().items_center().text_color(t.dim).child(ico(closed ? "chevron-right" : "chevron-down", 12))))
            .child(div().min_w(0).truncate().text_color(t.muted).child(it.path))
            .child(div().flex_none().text_color(t.dim).child(it.lines))
            .child(div().flex_1())
            .child(badge(it.resolved ? "resolved" : "unresolved", it.resolved ? t.muted : t.blocked)))
          .when(!closed && it.hunk.length > 0, (e) => e.child(v_flex().py(4).border_t(1).border_color(t.border).children(it.hunk.map(hunkLine))))
          .when(!closed, (e) => e.children(it.comments.map((c, j) => v_flex().gap(4).px(10).py(8).border_t(1).border_color(t.border)
            .child(who(c)).child(bodyView(`${id}-md-${j}`, bodyParts(c.body))))));
      } else if (it.kind === "commits") {
        const [newest, ...rest] = it.commits;
        const key = `cm:${newest.oid}`;
        const shown = this.unfolded.has(key);
        icon = "circle-dot";
        content = v_flex().gap(2).min_w(0)
          .child(commitLine(newest))
          .when(rest.length > 0, (e) => e.child(div().id(`${id}-more`).text_size(11.5).text_color(t.muted).cursor_pointer()
            .hover((s) => s.text_color(t.foreground)).on_click(this.fold(key))
            .child(shown ? `Hide ${rest.length} older commit${rest.length === 1 ? "" : "s"}` : `${rest.length} more commit${rest.length === 1 ? "" : "s"}`)))
          .when(shown, (e) => e.children(rest.map(commitLine)));
      } else {
        icon = "git-pull-request";
        color = t.done;
        content = h_flex().gap(6).items_center().h(18).text_size(11.5)
          .child(div().flex_none().font_semibold().child(it.author))
          .child(div().flex_none().text_color(t.dim).child(`opened the pull request${it.at ? ` · ${ago(it.at)}` : ""}`));
      }
      // The rail: the entry's icon, then a line down to the next entry.
      return h_flex().id(id).items_stretch().gap(10).min_w(0)
        .child(v_flex().w(18).flex_none().items_center()
          .child(div().w(18).h(18).flex_none().flex().items_center().justify_center().rounded_full().bg(alpha(color, 0.18)).text_color(color).child(ico(icon, 11)))
          .when(i < items.length - 1, (e) => e.child(div().w(1).flex_1().bg(t.border))))
        .child(div().flex_1().min_w(0).pb(12).child(content));
    });
    body.child(v_flex().id("prs-activity").pt(6).children(rows));
  }

  // The Commits and Files tabs before their data: five shimmer rows, or the error.
  pending(t, body, key) {
    if (this.detailLoading !== key && this.detailError?.key === key) {
      body.child(div().text_size(11.5).text_color(t.blocked).child(`Could not load the details: ${this.detailError.text}`));
      return;
    }
    body.children([0, 1, 2, 3, 4].map((i) => v_flex().id(`row-skel-${i}`).gap(6).py(4).child(shimmer(t, 260, 12)).child(shimmer(t, 150, 10))));
  }

  commits(t, body, pr, d, key) {
    if (!d) return this.pending(t, body, key);
    if (!d.commits.length) {
      body.child(div().text_color(t.dim).child("No commits."));
      return;
    }
    body.children(d.commits.map((c, i) => v_flex().id(`cm-${i}`).gap(2).py(6).px(4).rounded(4).border_b(1).border_color(t.border).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(() => this.openUrl(`${pr.url}/commits/${c.oid}`))
      .child(div().text_size(12.5).truncate().child(c.title))
      .child(div().text_size(11).text_color(t.dim).child(`${c.author}${c.at ? ` · ${ago(c.at)}` : ""} · ${c.oid.slice(0, 7)}`))))
      .when(d.commitCount > d.commits.length, (e) => e.child(div().text_size(11).text_color(t.dim).child(`Showing ${d.commits.length} of ${d.commitCount}. The rest are on GitHub.`)));
  }

  files(t, body, pr, d, key) {
    if (!d) return this.pending(t, body, key);
    body.child(h_flex().gap(8).text_size(11.5)
        .child(div().text_color(t.dim).child(`${d.fileCount} file${d.fileCount === 1 ? "" : "s"}`))
        .child(div().text_color(t.done).child(`+${pr.additions}`)).child(div().text_color(t.blocked).child(`−${pr.deletions}`)))
      .children(d.files.map((f, i) => h_flex().id(`file-${i}`).gap(6).py(2).text_size(11.5)
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(f.path))
        .child(div().text_color(t.done).child(`+${f.additions}`)).child(div().text_color(t.blocked).child(`−${f.deletions}`))))
      .when(d.fileCount > d.files.length, (e) => e.child(div().text_size(11).text_color(t.dim).child(`Showing ${d.files.length} of ${d.fileCount}. The rest are on GitHub.`)));
  }

  // Progress, only before a PR: the push and the draft PR to come. A clicked Push or Create PR shows as its step
  // (the command, the result, the error, the full output on hover).
  steps(t, body, steps) {
    body.when(steps.length > 0, (e) => e.child(div().pt(6).text_size(11.5).text_color(t.dim).child("Progress"))
      .children(steps.map((st, i) => h_flex().id(`step-${i}`).gap(8).items_center().child(this.stepIcon(t, st.status))
        .child(v_flex().id(`step-text-${i}`).min_w(0).when(Boolean(st.tip), (x) => x.tooltip(st.tip.slice(0, 2000)))
          .child(div().text_size(12.5).child(st.label))
          .when(Boolean(st.sub), (x) => x.child(div().text_size(11).truncate().text_color(st.status === "failed" ? t.blocked : t.dim).child(st.sub)))))));
  }
}
