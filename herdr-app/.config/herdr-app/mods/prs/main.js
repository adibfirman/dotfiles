// prs: my open pull requests across repos, what each needs next, its agent, and its forge run.
import { View, div } from "gpui-kit";
import * as fs from "fs/promises";
import { v_flex, h_flex } from "gpui-base";
import { theme, panes, exec, readTextFile, writeTextFile, notify, run, appHome, home, window as host } from "herdr";
import { ago, prState, sortPrs, timeline } from "./model.js";
import { failedLog, fetchPrs, openThreads } from "./github.js";

const REFRESH_MS = 120_000;
const alpha = (hex, a) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(a * 255).toString(16).padStart(2, "0") : hex);

export default class Prs extends View {
  init(_props, cx) {
    Object.assign(this, { prs: [], error: null, loading: false, at: null, open: null, busy: null, remotes: new Map(), local: new Map(), config: {} });
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  // ---------------------------------------------------------------- data

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // Ticket links come from an untracked local file, so no company URL lives in dotfiles.
        this.config = JSON.parse((await readTextFile(`${appHome()}/data/prs/config.json`)) ?? "{}");
        let prs;
        try {
          prs = await fetchPrs();
        } catch {
          prs = await fetchPrs(); // GitHub answers this query with a 502 now and then
        }
        this.prs = sortPrs(prs);
        this.error = null;
        this.at = new Date().toISOString();
        await this.matchLocal();
        // What this copy sees, for debugging without a screenshot.
        await fs.mkdir(`${appHome()}/data/prs`, { recursive: true }).catch(() => {});
        await fs.writeFile(`${appHome()}/data/prs/last-state.json`, JSON.stringify({
          at: this.at, prs: this.prs.length, states: this.prs.map((p) => `${p.repo}#${p.number} ${prState(p).label}`),
          local: [...this.local].map(([k, l]) => ({ pr: k, cwd: l.cwd, ahead: l.ahead, forge: l.forge?.phase ?? null, agent: l.pane.status })),
        }, null, 2)).catch(() => {});
      } catch (e) {
        this.error = String(e?.message ?? e);
        await fs.mkdir(`${appHome()}/data/prs`, { recursive: true }).catch(() => {});
        await fs.writeFile(`${appHome()}/data/prs/last-state.json`, JSON.stringify({ at: new Date().toISOString(), error: this.error }, null, 2)).catch(() => {});
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  // Each PR's local pane (same repo and branch), worktree, ahead count, and forge run.
  async matchLocal() {
    const local = new Map();
    for (const p of panes()) {
      if (!p.cwd || !p.branch || !p.terminal) continue;
      if (!this.remotes.has(p.cwd)) {
        const r = await exec("git", ["remote", "get-url", "origin"], { cwd: p.cwd }).catch(() => null);
        const m = /[:/]([^/:]+\/[^/]+?)(\.git)?$/.exec(r?.stdout.trim() ?? "");
        this.remotes.set(p.cwd, m ? m[1].toLowerCase() : null);
      }
      const repo = this.remotes.get(p.cwd);
      const pr = this.prs.find((x) => x.repo.toLowerCase() === repo && x.head === p.branch);
      if (!pr) continue;
      const have = local.get(pr.key);
      if (have && have.pane.status && !p.status) continue; // prefer the pane that runs an agent
      local.set(pr.key, { pane: p, cwd: p.cwd });
    }
    for (const [key, l] of local) {
      const pr = this.prs.find((x) => x.key === key);
      const ahead = await exec("git", ["rev-list", "--count", "@{upstream}..HEAD"], { cwd: l.cwd }).catch(() => null);
      l.ahead = ahead?.code === 0 ? Number(ahead.stdout.trim()) : null; // null: no upstream yet
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: l.cwd }).catch(() => null);
      const main = common?.code === 0 ? common.stdout.trim().replace(/\/\.git\/?$/, "") : null;
      if (main && pr.ticket) {
        const dir = `${main}/.forge/tickets/${pr.ticket}`;
        const head = await readTextFile(`${dir}/HEAD`).catch(() => null);
        if (head) l.forge = { dir, main, ...JSON.parse(head) };
      }
    }
    this.local = local;
  }

  // ---------------------------------------------------------------- actions

  openUrl(url) {
    exec(host().platform === "linux" ? "xdg-open" : "open", [url]);
  }

  push(cx, l) {
    if (this.busy) return;
    this.busy = "pushing";
    cx.notify();
    cx.spawn(async (cx) => {
      const up = await exec("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], { cwd: l.cwd });
      const r = await exec("git", up.code === 0 ? ["push"] : ["push", "-u", "origin", "HEAD"], { cwd: l.cwd, timeout: 120_000 });
      this.busy = null;
      notify({ title: "Push", body: (r.stderr || r.stdout).trim().slice(0, 300) || "Pushed.", level: r.code === 0 ? "success" : "error" });
      this.refresh(cx);
    });
  }

  // A new forge cycle with the failing checks' logs and the open review threads as its input.
  sendToForge(cx, pr, l) {
    if (this.busy || !l?.forge) return;
    this.busy = "sending to forge";
    cx.notify();
    cx.spawn(async (cx) => {
      let ok = false, body;
      try {
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
          parts.push("## Open review threads", "", ...threads.map((t) => `- \`${t.path}:${t.line ?? "?"}\` (${t.author}): ${t.body.replace(/\s+/g, " ").slice(0, 500)}`), "");
        }
        const inbox = `${l.forge.dir}/inbox`;
        const file = `${inbox}/pr-${pr.number}-${Date.now()}.md`;
        await exec("mkdir", ["-p", inbox]);
        await writeTextFile(file, parts.join("\n") + "\n", null);
        const r = await exec(`${home()}/.local/bin/forge`, ["followup", `PR #${pr.number}: ${what.join("; ") || "review feedback"}. Fix it. Details: ${file}`, "--source", "pr", "--run", l.forge.dir], { cwd: l.forge.main, timeout: 120_000 });
        ok = r.code === 0;
        body = ok ? "A forge follow-up is on its way." : (r.stderr || r.stdout).trim();
      } catch (e) {
        body = String(e?.message ?? e);
      }
      this.busy = null;
      notify({ title: "Send to forge", body: body.slice(0, 300), level: ok ? "success" : "error" });
      this.refresh(cx);
    });
  }

  // ---------------------------------------------------------------- view

  render(cx) {
    const t = theme();
    const pr = this.open && this.prs.find((p) => p.key === this.open);
    return v_flex().id("prs").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).overflow_hidden()
      .child(pr ? this.detail(t, pr) : this.list(t));
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
    if (!l) return null;
    const p = l.pane, c = p.status === "working" ? t.working : p.status === "blocked" ? t.blocked : p.status === "done" ? t.done : t.idle;
    return h_flex().gap(6).items_center().text_size(11.5).text_color(t.muted)
      .child(div().w(7).h(7).rounded_full().bg(p.status ? c : t.dim))
      .child(div().truncate().child(`${p.app ?? "terminal"} · ${p.title || p.branch}`));
  }

  list(t) {
    return v_flex().size_full().min_h(0)
      .child(h_flex().h(44).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Pull requests"))
        .child(div().px(6).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).child(String(this.prs.length)))
        .child(div().flex_1())
        .when(this.loading, (e) => e.child(div().text_size(11).text_color(t.dim).child("Loading…")))
        .child(div().id("prs-refresh").px(6).h(24).flex().items_center().rounded(5).text_size(12).text_color(t.muted).cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip(this.at ? `Updated ${ago(this.at)}` : "Refresh").on_click((_e, cx) => this.refresh(cx)).child("↻")))
      .when(Boolean(this.error), (e) => e.child(div().px(14).py(6).text_size(11).text_color(t.blocked).child(this.error)))
      .child(v_flex().id("prs-list").flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(6)
        .children(this.prs.map((pr) => this.row(t, pr)))
        .when(!this.prs.length && !this.loading, (e) => e.child(div().p(12).text_color(t.dim).child(this.error ? "" : "No open pull requests."))));
  }

  row(t, pr) {
    const s = prState(pr), l = this.local.get(pr.key);
    const ci = pr.ci.status === "failed" ? ["✕ CI failed", t.blocked] : pr.ci.status === "running" ? ["◌ CI", t.working] : pr.ci.status === "passed" ? ["✓ CI", t.done] : ["no CI", t.dim];
    return v_flex().id(`pr-${pr.number}-${pr.repo}`).gap(4).p(10).rounded(8).bg(t.surface).border_1().border_color(t.border).cursor_pointer()
      .hover((st) => st.bg(t.hover)).on_click((_e, cx) => { this.open = pr.key; cx.notify(); })
      .child(div().font_semibold().truncate().child(pr.title))
      .child(h_flex().gap(6).text_size(11.5).text_color(t.dim)
        .child(div().truncate().child(`${pr.repo.split("/")[1]} #${pr.number}${pr.ticket ? ` · ${pr.ticket}` : ""}`))
        .child(div().flex_1()).child(div().flex_none().child(ago(pr.updatedAt))))
      .child(h_flex().gap(10).text_size(11.5).items_center()
        .child(div().text_color(ci[1]).child(ci[0]))
        .child(div().text_color(this.color(t, s.kind)).child(s.label))
        .when(Boolean(l?.forge), (e) => e.child(div().text_color(t.accent).child(`forge ${l.forge.phase}`))))
      .when(Boolean(l), (e) => e.child(this.agentRow(t, l)));
  }

  button(t, id, label, f, primary = false) {
    return div().id(id).h(26).px(10).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).hover((s) => s.bg(primary ? t.solid : t.hover))
      .on_click((_e, cx) => f(cx)).child(label);
  }

  detail(t, pr) {
    const l = this.local.get(pr.key), s = prState(pr);
    const canSend = Boolean(l?.forge) && (pr.ci.status === "failed" || pr.unresolved > 0 || pr.reviewDecision === "CHANGES_REQUESTED");
    const ticketUrl = pr.ticket && this.config.ticketUrl ? this.config.ticketUrl.replace("{key}", pr.ticket) : null;
    const section = (title) => div().pt(8).text_size(11.5).text_color(t.dim).child(title);
    return v_flex().size_full().min_h(0)
      .child(h_flex().h(44).flex_none().px(12).items_center().justify_between().border_b(1).border_color(t.border)
        .child(div().id("prs-back").text_size(12).text_color(t.muted).cursor_pointer().on_click((_e, cx) => { this.open = null; cx.notify(); }).child("‹ List"))
        .child(div().id("prs-gh").text_size(12).text_color(t.muted).cursor_pointer().on_click(() => this.openUrl(pr.url)).child("GitHub ↗")))
      .child(v_flex().id("prs-detail").flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(6)
        .child(div().text_size(15).font_semibold().child(pr.title))
        .child(div().text_size(11.5).text_color(t.dim).child(`${pr.repo} #${pr.number}`))
        .child(div().text_size(11.5).text_color(t.muted).child(`${pr.head} → ${pr.base}`))
        .child(div().text_size(12).text_color(this.color(t, s.kind)).child(s.label))
        .when(Boolean(l), (e) => e.child(h_flex().mt(4).p(8).gap(8).items_center().rounded(8).bg(t.raised)
          .child(div().flex_1().min_w(0).child(this.agentRow(t, l)))
          .child(div().id("prs-go").text_size(12).text_color(t.accent).cursor_pointer().on_click(() => run("pane.focus", { pane: l.pane.pane })).child("Go ›"))))
        .child(section("Progress"))
        .children(timeline(pr).map((st, i) => h_flex().id(`step-${i}`).gap(8).items_center().child(this.stepIcon(t, st.status))
          .child(v_flex().min_w(0).child(div().text_size(12.5).child(st.label)).when(Boolean(st.sub), (e) => e.child(div().text_size(11).text_color(t.dim).child(st.sub))))))
        .when(pr.checks.length > 0, (e) => e.child(section(`Checks ${pr.checks.length}`))
          .children(pr.checks.map((c, i) => h_flex().id(`chk-${i}`).gap(8).items_center().when(Boolean(c.url), (r) => r.cursor_pointer().on_click(() => this.openUrl(c.url)))
            .child(this.stepIcon(t, c.status)).child(div().truncate().text_size(12).child(c.name)))))
        .when(Boolean(pr.ticket), (e) => e.child(section("Ticket")).child(div().id("prs-ticket").text_size(12)
          .text_color(ticketUrl ? t.accent : t.foreground).when(Boolean(ticketUrl), (d) => d.cursor_pointer().on_click(() => this.openUrl(ticketUrl))).child(pr.ticket)))
        .when(Boolean(l?.forge), (e) => e.child(section("Forge")).child(div().text_size(12).child(`cycle ${l.forge.cycle} · ${l.forge.phase}${l.forge.paused ? " · paused" : ""}`)))
        .child(section(`Changed files ${pr.files.length}`))
        .child(h_flex().gap(8).text_size(11.5).child(div().text_color(t.done).child(`+${pr.additions}`)).child(div().text_color(t.blocked).child(`−${pr.deletions}`)))
        .children(pr.files.map((f, i) => h_flex().id(`file-${i}`).gap(6).text_size(11.5)
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(f.path))
          .child(div().text_color(t.done).child(`+${f.additions}`)).child(div().text_color(t.blocked).child(`−${f.deletions}`)))))
      .child(h_flex().h(44).flex_none().px(12).gap(8).items_center().justify_end().border_t(1).border_color(t.border)
        .when(Boolean(this.busy), (e) => e.child(div().flex_1().text_size(11.5).text_color(t.working).child(`${this.busy}…`)))
        .when(Boolean(l) && l.ahead !== 0, (e) => e.child(this.button(t, "prs-push", l.ahead === null ? "Push" : `Push ↑${l.ahead}`, (cx) => this.push(cx, l))))
        .when(canSend, (e) => e.child(this.button(t, "prs-forge", "Send to forge", (cx) => this.sendToForge(cx, pr, l), true))));
  }
}
