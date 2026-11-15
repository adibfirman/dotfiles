// prs: forge runs and their pull requests (default), or all my open PRs across repos.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import * as fs from "fs/promises";
import { theme, panes, terminals, exec, readTextFile, writeTextFile, notify, run, appHome, home, shared, props as given, window as host } from "herdr";
import { ago, prState, sortPrs, timeline } from "./model.js";
import { failedLog, fetchPrs, fetchRunPrs, openThreads } from "./github.js";

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

export default class Prs extends View {
  init(_props, cx) {
    let mode = "forge";
    try {
      mode = localStorage.getItem("mode") === "all" ? "all" : "forge";
    } catch {
      /* no storage: default */
    }
    Object.assign(this, { mode, items: [], local: new Map(), error: null, loading: false, at: null, open: null, busy: null, remotes: new Map(), config: {} });
    // props.run (opened for one forge run) or a click on a forge row ("forge.selected") opens that run's detail.
    this.wanted = given()?.run ?? null;
    if (this.wanted) this.mode = "forge";
    this.selAt = shared("forge.selected")?.at ?? null;
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  setMode(mode, cx) {
    if (mode === this.mode) return;
    Object.assign(this, { mode, open: null, items: [] });
    try {
      localStorage.setItem("mode", mode);
    } catch {
      /* per-copy convenience only */
    }
    this.refresh(cx);
  }

  // ---------------------------------------------------------------- data

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const mode = this.mode;
      try {
        // Ticket links come from an untracked local file, so no company URL lives in dotfiles.
        this.config = JSON.parse((await readTextFile(`${appHome()}/data/prs/config.json`)) ?? "{}");
        const items = mode === "forge" ? await this.forgeItems() : await this.allItems();
        if (mode !== this.mode) return; // switched while loading
        this.items = items;
        // The selection is a run folder; a workspace run's rows are "<run>#<repo>": open its first row.
        const hit = this.wanted && items.find((i) => i.key === this.wanted || i.fr?.runDir === this.wanted);
        if (hit) {
          this.open = hit.key;
          this.wanted = null;
        }
        this.error = null;
        this.at = new Date().toISOString();
        this.local = await this.localInfo(items);
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        await this.writeState();
        this.loading = false;
        cx.notify();
      }
    });
  }

  // Forge runs from the registry, each with its newest PR (open, merged, or closed).
  async forgeItems() {
    const r = await exec(forgeBin(), ["runs"], { timeout: 30_000 });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || "forge runs failed");
    // A workspace run shows one row per repo in it; a repo run (or a workspace run with no repo yet) one row.
    const runs = JSON.parse(r.stdout).flatMap((fr) => fr.mode === "workspace" && fr.repos?.length
      ? fr.repos.map((rp) => ({ ...fr, dir: `${fr.dir}#${rp.name}`, runDir: fr.dir, repo: rp.remote, branch: rp.branch, worktree: rp.worktree, repoName: rp.name, title: `${fr.title || fr.ticket} · ${rp.name}` }))
      : [{ ...fr, runDir: fr.dir }]);
    const prs = await twice(() => fetchRunPrs(runs));
    const items = runs.map((fr) => ({ key: fr.dir, fr, pr: prs.get(fr.dir) ?? null }));
    const withPr = sortPrs(items.filter((i) => i.pr).map((i) => i.pr)).map((pr) => items.find((i) => i.pr === pr));
    return [...withPr, ...items.filter((i) => !i.pr)];
  }

  async allItems() {
    return sortPrs(await twice(fetchPrs)).map((pr) => ({ key: pr.key, pr, fr: null }));
  }

  // For each item: its worktree, its agent pane, how far it is ahead, and its forge state.
  async localInfo(items) {
    const local = new Map();
    const shown = panes().filter((p) => p.cwd && p.terminal);
    for (const item of items) {
      let cwd = item.fr?.worktree ?? null;
      if (!cwd && item.pr) cwd = (await this.paneFor(item.pr, shown))?.cwd ?? null;
      if (!cwd) continue;
      // A forge run's agents are its own terminals (label forge=<ticket>/…). Other panes in the same folder
      // (your own sessions) are not the run's agent.
      const inside = item.fr ? [] : shown.filter((p) => p.cwd === cwd || p.cwd.startsWith(`${cwd}/`));
      const pane = inside.find((p) => p.status) ?? inside[0] ?? null;
      const ahead = await exec("git", ["rev-list", "--count", "@{upstream}..HEAD"], { cwd }).catch(() => null);
      // The branch and the repo's default branch: a run on the default branch commits straight to it, so it has no PR.
      const branch = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }).catch(() => null);
      const def = await exec("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd }).catch(() => null);
      const l = {
        cwd, pane, ahead: ahead?.code === 0 ? Number(ahead.stdout.trim()) : null,
        branch: branch?.code === 0 ? branch.stdout.trim() : null,
        base: def?.code === 0 ? def.stdout.trim().replace(/^origin\//, "") : "main",
      };
      if (item.fr) l.forge = { dir: item.fr.runDir ?? item.fr.dir, main: item.fr.main, ticket: item.fr.ticket, ...(item.fr.head ?? {}) };
      else if (item.pr.ticket) {
        const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd }).catch(() => null);
        const main = common?.code === 0 ? common.stdout.trim().replace(/\/\.git\/?$/, "") : null;
        const head = main ? await readTextFile(`${main}/.forge/tickets/${item.pr.ticket}/HEAD`).catch(() => null) : null;
        if (head) l.forge = { dir: `${main}/.forge/tickets/${item.pr.ticket}`, main, ...JSON.parse(head) };
      }
      local.set(item.key, l);
    }
    return local;
  }

  // In the "All" view a PR has no run: find a pane on the same repo (origin remote) and branch.
  async paneFor(pr, shown) {
    for (const p of shown) {
      if (p.branch !== pr.head) continue;
      if (!this.remotes.has(p.cwd)) {
        const r = await exec("git", ["remote", "get-url", "origin"], { cwd: p.cwd }).catch(() => null);
        const m = /[:/]([^/:]+\/[^/]+?)(\.git)?$/.exec(r?.stdout.trim() ?? "");
        this.remotes.set(p.cwd, m ? m[1].toLowerCase() : null);
      }
      if (this.remotes.get(p.cwd) === pr.repo.toLowerCase()) return p;
    }
    return null;
  }

  // What this copy sees, for debugging without a screenshot.
  async writeState() {
    await fs.mkdir(`${appHome()}/data/prs`, { recursive: true }).catch(() => {});
    await fs.writeFile(`${appHome()}/data/prs/last-state.json`, JSON.stringify({
      at: new Date().toISOString(), mode: this.mode, error: this.error,
      items: this.items.map((i) => ({ run: i.fr?.ticket ?? null, pr: i.pr ? `${i.pr.repo}#${i.pr.number} ${prState(i.pr).label}` : null, forge: this.local.get(i.key)?.forge?.phase ?? null })),
    }, null, 2)).catch(() => {});
  }

  // ---------------------------------------------------------------- actions

  openUrl(url) {
    exec(host().platform === "linux" ? "xdg-open" : "open", [url]);
  }

  task(cx, label, work) {
    if (this.busy) return;
    this.busy = label;
    cx.notify();
    cx.spawn(async (cx) => {
      let res;
      try {
        res = await work();
      } catch (e) {
        res = { ok: false, body: String(e?.message ?? e) };
      }
      this.busy = null;
      notify({ title: label.replace(/^./, (c) => c.toUpperCase()), body: String(res.body ?? "").slice(0, 300) || "Done.", level: res.ok ? "success" : "error" });
      this.refresh(cx);
    });
  }

  push(cx, l) {
    this.task(cx, "push", async () => {
      const up = await exec("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], { cwd: l.cwd });
      const r = await exec("git", up.code === 0 ? ["push"] : ["push", "-u", "origin", "HEAD"], { cwd: l.cwd, timeout: 120_000 });
      return { ok: r.code === 0, body: (r.stderr || r.stdout).trim() };
    });
  }

  // A draft PR from the current cycle's exec/PR.md (the title from its first line).
  createPr(cx, item, l) {
    this.task(cx, "create PR", async () => {
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
      const r = await exec("gh", ["pr", "create", "--draft", "--base", base, "--title", first.replace(/^#\s*/, "").trim(), "--body-file", bodyFile], { cwd: l.cwd, timeout: 120_000 });
      return { ok: r.code === 0, body: (r.code === 0 ? r.stdout : r.stderr || r.stdout).trim() };
    });
  }

  // A new forge cycle with the failing checks' logs and the open review threads as its input.
  sendToForge(cx, pr, l) {
    this.task(cx, "send to forge", async () => {
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
      const r = await exec(forgeBin(), ["followup", `PR #${pr.number}: ${what.join("; ") || "review feedback"}. Fix it. Details: ${file}`, "--source", "pr", "--run", l.forge.dir], { cwd: l.forge.main, timeout: 120_000 });
      return { ok: r.code === 0, body: r.code === 0 ? "A forge follow-up is on its way." : (r.stderr || r.stdout).trim() };
    });
  }

  // ---------------------------------------------------------------- view

  render(cx) {
    const t = theme();
    const sel = shared("forge.selected");
    if (sel?.at && sel.at !== this.selAt && !given()?.run) {
      this.selAt = sel.at;
      const hit = this.mode === "forge" && this.items.find((i) => i.key === sel.dir || i.fr?.runDir === sel.dir);
      if (hit) this.open = hit.key;
      else {
        Object.assign(this, { mode: "forge", wanted: sel.dir, open: null });
        this.refresh(cx);
      }
    }
    const item = this.open && this.items.find((i) => i.key === this.open);
    return v_flex().id("prs").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).overflow_hidden()
      // In a run window, a press that reaches the window drags it: stop presses here, so dragging the graph
      // pans it and the window stays where it is. (Inner handlers, like the graph's pan, run first.)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(item ? this.detail(t, item) : this.list(t));
  }

  color(t, kind) {
    return kind === "bad" ? t.blocked : kind === "good" ? t.done : kind === "wait" ? t.working : t.muted;
  }

  stepIcon(t, status) {
    const c = status === "done" || status === "passed" ? t.done : status === "failed" ? t.blocked : status === "running" ? t.working : t.dim;
    const ch = status === "done" || status === "passed" ? "✓" : status === "failed" ? "✕" : status === "running" ? "◌" : "○";
    return div().w(18).h(18).flex_none().flex().items_center().justify_center().rounded_full().bg(alpha(c, 0.18)).text_color(c).text_size(11).child(ch);
  }

  agentRow(t, l) {
    if (l?.forge && !l.pane) {
      // The run's live agents, from their hc labels.
      const mine = terminals().filter((x) => x.state === "live" && String(x.labels?.forge ?? "").startsWith(`${l.forge.ticket ?? ""}/`));
      if (!mine.length) return null;
      const working = mine.filter((x) => x.status === "working").length;
      return h_flex().gap(6).items_center().text_size(11.5).text_color(t.muted)
        .child(div().w(7).h(7).rounded_full().bg(working ? t.working : t.idle))
        .child(div().truncate().child(`${mine.length} forge agent${mine.length > 1 ? "s" : ""}${working ? ` · ${working} working` : ""}`));
    }
    const p = l?.pane;
    if (!p) return null;
    const c = p.status === "working" ? t.working : p.status === "blocked" ? t.blocked : p.status === "done" ? t.done : t.idle;
    return h_flex().gap(6).items_center().text_size(11.5).text_color(t.muted)
      .child(div().w(7).h(7).rounded_full().bg(p.status ? c : t.dim))
      .child(div().truncate().child(`${p.app ?? "terminal"} · ${p.title || p.branch}`));
  }

  chip(t, id, label, on, f) {
    return div().id(id).h(22).px(8).flex().items_center().rounded(5).text_size(11.5).cursor_pointer()
      .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => f(cx)).child(label);
  }

  list(t) {
    const label = this.mode === "forge" ? "Forge runs" : "Pull requests";
    return v_flex().size_full().min_h(0)
      .child(h_flex().h(44).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child(label))
        .child(div().px(6).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).child(String(this.items.length)))
        .child(div().flex_1())
        .child(h_flex().p(2).gap(2).rounded(7).bg(t.raised)
          .child(this.chip(t, "prs-mode-forge", "Forge", this.mode === "forge", (cx) => this.setMode("forge", cx)))
          .child(this.chip(t, "prs-mode-all", "All", this.mode === "all", (cx) => this.setMode("all", cx))))
        .child(div().id("prs-refresh").w(24).h(24).flex().items_center().justify_center().rounded(5).text_size(12).text_color(t.muted).cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip(this.loading ? "Loading…" : this.at ? `Updated ${ago(this.at)}` : "Refresh").on_click((_e, cx) => this.refresh(cx))
          .child(this.loading ? "…" : "↻")))
      .when(Boolean(this.error), (e) => e.child(div().px(14).py(6).text_size(11).text_color(t.blocked).child(this.error)))
      .child(v_flex().id("prs-list").flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(6)
        .children(this.items.map((i) => this.row(t, i)))
        .when(!this.items.length && !this.loading && !this.error, (e) => e.child(div().p(12).text_color(t.dim)
          .child(this.mode === "forge" ? "No forge runs yet. Start one from the Forge panel." : "No open pull requests."))));
  }

  row(t, item) {
    const { pr, fr } = item, l = this.local.get(item.key);
    const card = v_flex().id(`row-${item.key}`).gap(4).p(10).rounded(8).bg(t.surface).border_1().border_color(t.border).cursor_pointer()
      .hover((st) => st.bg(t.hover)).on_click((_e, cx) => { this.open = item.key; cx.notify(); });
    const forge = l?.forge?.phase ? div().text_color(t.accent).child(`forge ${l.forge.phase}${l.forge.paused ? " · paused" : ""}`) : null;
    if (!pr) {
      return card
        .child(div().font_semibold().truncate().child(fr.title || fr.ticket))
        .child(h_flex().gap(6).text_size(11.5).text_color(t.dim)
          .child(div().truncate().child(`${fr.repo?.split("/")[1] ?? "local repo"} · ${fr.ticket}`))
          .child(div().flex_1()).child(div().flex_none().child(ago(fr.created))))
        .child(h_flex().gap(10).text_size(11.5).child(div().text_color(t.muted).child("No PR yet")).when(Boolean(forge), (e) => e.child(forge)))
        .when(Boolean(l?.pane), (e) => e.child(this.agentRow(t, l)));
    }
    const s = prState(pr);
    const ci = pr.ci.status === "failed" ? ["✕ CI failed", t.blocked] : pr.ci.status === "running" ? ["◌ CI", t.working] : pr.ci.status === "passed" ? ["✓ CI", t.done] : ["no CI", t.dim];
    return card
      .child(div().font_semibold().truncate().child(pr.title))
      .child(h_flex().gap(6).text_size(11.5).text_color(t.dim)
        .child(div().truncate().child(`${pr.repo.split("/")[1]} #${pr.number}${pr.ticket ? ` · ${pr.ticket}` : ""}`))
        .child(div().flex_1()).child(div().flex_none().child(ago(pr.updatedAt))))
      .child(h_flex().gap(10).text_size(11.5).items_center()
        .when(pr.state === "OPEN", (e) => e.child(div().text_color(ci[1]).child(ci[0])))
        .child(div().text_color(this.color(t, s.kind)).child(s.label))
        .when(Boolean(forge), (e) => e.child(forge)))
      .when(Boolean(l?.pane), (e) => e.child(this.agentRow(t, l)));
  }

  button(t, id, label, f, primary = false) {
    return div().id(id).h(26).px(10).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).hover((s) => s.bg(primary ? t.solid : t.hover))
      .on_click((_e, cx) => f(cx)).child(label);
  }

  detail(t, item) {
    const { pr, fr } = item, l = this.local.get(item.key);
    const section = (title) => div().pt(8).text_size(11.5).text_color(t.dim).child(title);
    const ticket = pr?.ticket ?? (fr && !fr.ticket.startsWith("local-") ? fr.ticket : null);
    const ticketUrl = ticket && this.config.ticketUrl ? this.config.ticketUrl.replace("{key}", ticket) : null;
    const canSend = Boolean(pr && l?.forge) && pr.state === "OPEN" && (pr.ci.status === "failed" || pr.unresolved > 0 || pr.reviewDecision === "CHANGES_REQUESTED");
    const onBase = Boolean(l?.branch) && l.branch === l.base;
    const canCreate = !pr && Boolean(fr?.repo) && l?.forge?.phase === "done" && !onBase;
    const canPush = Boolean(l) && (pr ? pr.state === "OPEN" : Boolean(fr?.repo)) && l.ahead !== 0;
    const body = v_flex().id("prs-detail").flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(6)
      .child(div().text_size(15).font_semibold().child(pr?.title ?? (fr.title || fr.ticket)))
      .child(div().text_size(11.5).text_color(t.dim).child(pr ? `${pr.repo} #${pr.number}` : `${fr.repo ?? "no GitHub remote"} · ${fr.ticket}`))
      .child(div().text_size(11.5).text_color(t.muted).child(pr ? `${pr.head} → ${pr.base}` : `${fr.branch ?? "?"} · ${fr.worktree}`))
      .when(Boolean(pr), (e) => e.child(div().text_size(12).text_color(this.color(t, prState(pr).kind)).child(prState(pr).label)))
      .when(!pr && onBase, (e) => e.child(div().text_size(12).text_color(t.muted).child(l.ahead ? `On ${l.base}: commits go straight to ${l.base}, so there is no PR. ${l.ahead} not pushed yet.` : `On ${l.base}: commits go straight to ${l.base}, so there is no PR. Everything is pushed.`)))
      .when(Boolean(l?.pane), (e) => e.child(h_flex().mt(4).p(8).gap(8).items_center().rounded(8).bg(t.raised)
        .child(div().flex_1().min_w(0).child(this.agentRow(t, l)))
        .child(div().id("prs-go").text_size(12).text_color(t.accent).cursor_pointer().on_click(() => run("pane.focus", { pane: l.pane.pane })).child("Go ›"))))
      .when(Boolean(l?.forge), (e) => e.child(section("Forge")).child(div().text_size(12).child(`cycle ${l.forge.cycle} · ${l.forge.phase}${l.forge.paused ? " · paused" : ""}`)));
    if (pr) {
      body
        .child(section("Progress"))
        .children(timeline(pr).map((st, i) => h_flex().id(`step-${i}`).gap(8).items_center().child(this.stepIcon(t, st.status))
          .child(v_flex().min_w(0).child(div().text_size(12.5).child(st.label)).when(Boolean(st.sub), (e) => e.child(div().text_size(11).text_color(t.dim).child(st.sub))))))
        .when(pr.checks.length > 0, (e) => e.child(section(`Checks ${pr.checks.length}`))
          .children(pr.checks.map((c, i) => h_flex().id(`chk-${i}`).gap(8).items_center().when(Boolean(c.url), (r) => r.cursor_pointer().on_click(() => this.openUrl(c.url)))
            .child(this.stepIcon(t, c.status)).child(div().truncate().text_size(12).child(c.name)))))
        .child(section(`Changed files ${pr.files.length}`))
        .child(h_flex().gap(8).text_size(11.5).child(div().text_color(t.done).child(`+${pr.additions}`)).child(div().text_color(t.blocked).child(`−${pr.deletions}`)))
        .children(pr.files.map((f, i) => h_flex().id(`file-${i}`).gap(6).text_size(11.5)
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(f.path))
          .child(div().text_color(t.done).child(`+${f.additions}`)).child(div().text_color(t.blocked).child(`−${f.deletions}`))));
    }
    body.when(Boolean(ticket), (e) => e.child(section("Ticket")).child(div().id("prs-ticket").text_size(12)
      .text_color(ticketUrl ? t.accent : t.foreground).when(Boolean(ticketUrl), (d) => d.cursor_pointer().on_click(() => this.openUrl(ticketUrl))).child(ticket)));
    return v_flex().size_full().min_h(0)
      .child(h_flex().h(44).flex_none().px(12).items_center().justify_between().border_b(1).border_color(t.border)
        // Pinned to one run (in a run window): no list to go back to.
        .child(given()?.run
          ? div().text_size(12).font_semibold().child("Pull request")
          : div().id("prs-back").text_size(12).text_color(t.muted).cursor_pointer().on_click((_e, cx) => { this.open = null; cx.notify(); }).child("‹ List"))
        .when(Boolean(pr), (e) => e.child(div().id("prs-gh").text_size(12).text_color(t.muted).cursor_pointer().on_click(() => this.openUrl(pr.url)).child("GitHub ↗"))))
      .child(body)
      .child(h_flex().h(44).flex_none().px(12).gap(8).items_center().justify_end().border_t(1).border_color(t.border)
        .when(Boolean(this.busy), (e) => e.child(div().flex_1().text_size(11.5).text_color(t.working).child(`${this.busy}…`)))
        .when(canPush, (e) => e.child(this.button(t, "prs-push", l.ahead === null ? "Push" : `Push ↑${l.ahead}`, (cx) => this.push(cx, l))))
        .when(canCreate, (e) => e.child(this.button(t, "prs-create", "Create PR", (cx) => this.createPr(cx, item, l), true)))
        .when(canSend, (e) => e.child(this.button(t, "prs-forge", "Send to forge", (cx) => this.sendToForge(cx, pr, l), true))));
  }
}
