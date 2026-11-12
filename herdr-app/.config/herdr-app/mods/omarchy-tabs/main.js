// auto-tabs: herdr's tab bar (cloned) with wider names; names.js names the tabs.
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { syncNames } from "./names.js";
import { renderPaneHeader } from "./pane.js";
import { spaces, panes, terminals, props, run, openOverlay, theme, shared, setShared, layout, exec, readTextFile, home, appHome, nextCommand, notify, window } from "herdr";
import { resumeCommand, argvOf } from "./reopen.js";
import { jump } from "./jump.js";

// The last closed tabs (newest last), kept across restarts for ctrl-alt-shift-t.
const CLOSED = "omarchy-tabs.closed";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.hovered = false;
    if (_props?.pane) return;
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    this.snap = {};
    this.roots = {};
    this.commands = {};
    this.shells = {};
    cx.spawn(async (cx) => {
      // reopen.py reads Linux's /proc, so on macOS every scan would fail: leave the helper off there.
      this.source = window()?.platform === "macos" ? null : await readTextFile(`${appHome()}/mods/omarchy-tabs/reopen.py`).catch(() => null);
      this.refresh(cx);
    });
    // Poll gently for pure resizes; tab, pane and status changes refresh immediately.
    cx.timer.every(10000, cx => this.refresh(cx));
    // Each step touches cx, so a reloaded strip's old loop ends instead of eating the key.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "reopen") this.reopen(cx);
        else this.jump(c);
        cx.notify();
      }
    });
  }

  jump(c) {
    const dir = c === "tab-next" ? 1 : c === "tab-prev" ? -1 : 0;
    if (!dir) return;
    const t = jump(spaces().find(s => s.active)?.tabs ?? [], t => t.active, dir);
    if (t) run("tab.select", { id: t.id });
  }

  track(cx) {
    if (this.reopening) return;
    const ids = new Set(spaces().flatMap(s => s.tabs.map(t => t.id)));
    if (this.known) {
      const gone = [...this.known].filter(id => !ids.has(id) && this.snap[id]?.panes.length);
      if (gone.length) setShared(CLOSED, [...(shared(CLOSED) ?? []), ...gone.map(id => this.snap[id])].slice(-10));
      for (const id of gone) delete this.snap[id];
    }
    this.known = ids;
    for (const s of spaces()) for (const t of s.tabs) {
      const list = panes().filter(p => p.tab === t.id && p.terminal).map(p => ({
        terminal: p.terminal.split('/').pop(), cwd: p.cwd, cmd: this.commands[p.terminal] ?? null,
      }));
      this.snap[t.id] = { space: s.id, machine: s.machine, spaceName: s.named ? s.name : null,
        name: t.named ? t.name : null, index: t.index, shell: this.shells[s.machine] ?? '/bin/sh',
        root: this.roots[t.id], panes: list };
    }
    const sig = JSON.stringify([spaces().map(s => s.tabs), panes().map(p => [p.tab, p.terminal, p.cwd, p.program?.key, p.status])]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.refresh(cx);
  }

  refresh(cx) {
    if (!this.source || this.scanning || this.reopening) return;
    this.scanning = true;
    cx.spawn(async (cx) => {
      try {
        for (const machine of new Set(spaces().map(s => s.machine))) {
          const r = await exec('python3', ['-c', this.source, 'scan'], { on: machine });
          if (r.code !== 0) throw new Error(r.stderr);
          const { shell, procs, document } = JSON.parse(r.stdout);
          this.shells[machine] = shell;
          for (const s of spaces().filter(s => s.machine === machine)) for (const t of s.tabs) {
            const saved = document?.spaces?.find(x => x.id === s.id.split('/').pop())?.tabs?.find(x => x.id === t.id.split('/').pop());
            if (saved) this.roots[t.id] = saved.root;
            for (const p of panes().filter(p => p.tab === t.id && p.terminal)) {
              const proc = procs[p.terminal.split('/').pop()];
              const cmd = resumeCommand(proc, proc?.session, home());
              // Keep a known session through a transient session-file write.
              if (cmd && (proc.session || !this.commands[p.terminal])) this.commands[p.terminal] = cmd;
              if (!proc && !p.program?.agent) delete this.commands[p.terminal];
            }
          }
        }
        cx.notify();
      } catch (e) {
        console.log(`Reopen snapshot: ${e}`);
      } finally {
        this.scanning = false;
      }
    });
  }

  reopen(cx) {
    if (this.reopening) return;
    const closed = shared(CLOSED) ?? [], last = closed[closed.length - 1];
    if (!last) return notify({ title: "No closed tab to reopen" });
    setShared(CLOSED, closed.slice(0, -1));
    this.reopening = true;
    cx.spawn(async (cx) => {
      try {
        if (!this.source) throw new Error('Reopen helper unavailable');
        const saved = { ...last, panes: last.panes.map((p, i) => ({ ...p, terminal: p.terminal ?? `old-${i}`, argv: argvOf(p.cmd, last.shell) })) };
        const r = await exec('python3', ['-c', this.source, 'restore', JSON.stringify(saved)]);
        if (r.code !== 0) throw new Error(r.stderr);
      } catch (e) {
        const [first, ...rest] = last.panes;
        const space = spaces().some(s => s.id === last.space) ? last.space : undefined;
        run('tab.new', { space, name: last.name ?? undefined, folder: first.cwd ?? undefined, argv: argvOf(first.cmd, last.shell) });
        for (const p of rest) run('terminal.open', { folder: p.cwd ?? undefined, argv: argvOf(p.cmd, last.shell), place: 'right' });
        notify({ title: 'Reopened with basic pane layout' });
      } finally {
        this.reopening = false;
        cx.notify();
      }
    });
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    // A remembered panel this space can't show now (Changes outside git) stays remembered.
    if (now === null && this.panels[space.id] && !enabled.includes(this.panels[space.id])) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render(cx) {
    if (props()?.pane) return renderPaneHeader(this);
    this.track(cx);
    syncNames();
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const f = t.foreground, idle = f + "0a", hov = f + "14", sel = f + "2e";
    const allPanes = panes(), allTerminals = terminals();
    const item = (c, i) => {
      const tabPanes = allPanes.filter(p => p.tab === c.id);
      const lead = tabPanes.find(p => p.program?.agent && p.status === c.status) ?? tabPanes.find(p => p.program?.agent) ?? tabPanes[0];
      const program = lead?.program;
      const terminal = allTerminals.find(p => p.address === lead?.terminal);
      const report = Object.values(terminal?.records ?? {}).find(r => r.state === c.status && r.title);
      const liveTitle = terminal?.report?.title || report?.title || lead?.title;
      const title = (liveTitle === program?.name ? lead?.branch || liveTitle : liveTitle || "").replace(/^\[[^\]]*\]\s*[^|]*\|\s*/, "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
      const status = { working: "Working", blocked: "Needs input", done: "Done", idle: "Idle" }[c.status];
      // A tab with several agents shows their icons; the person's own tab name wins (names.js records its own names).
      const agentPanes = tabPanes.filter(p => p.program?.agent);
      const programs = [...new Map(agentPanes.map(p => [p.program.name, p.program])).values()];
      const multi = agentPanes.length > 1;
      const personNamed = c.named && shared("tab-titles.set")?.[c.id] !== c.name && !programs.some(p => p.name === c.name);
      // The icons already say which agents run here; the label carries what they work on.
      const isProgram = n => !n || tabPanes.some(p => p.program?.name === n || p.terminal === n) || n === "Claude Code";
      const folder = lead?.cwd ? (/^\/(home\/[^/]+|root)\/?$/.test(lead.cwd) ? "~" : lead.cwd.split("/").filter(Boolean).pop()) : "";
      const work = [title, folder, lead?.branch].find(n => !isProgram(n)) ?? (isProgram(c.name) ? "" : c.name);
      const name = personNamed && !isProgram(c.name) ? c.name : work;
      const detail = multi
        ? agentPanes.map(p => `${p.program.name}: ${({ working: "working", blocked: "needs input", done: "done" })[p.status] ?? "idle"}`).join("\n")
        : [status, c.named && title && title !== c.name ? title : program?.name].filter(Boolean).join(" · ");
      const icons = (multi ? programs.slice(0, 3) : [program]).filter(p => p?.icon);
      return h_flex().id(`tab-${c.id}`).w(240).h_full().px(10).gap(7).rounded(0).items_center().flex_none().text_size(12)
        .tooltip(`${name}\n${detail}`)
        // The close button shows on the active tab and on the one under the pointer.
        .on_hover((over, cx) => { if (over) this.overTab = c.id; else if (this.overTab === c.id) this.overTab = null; cx.notify(); })
        // Matches the pane's focus frame.
        .when(c.active, el => el.border_2().border_color(t.accent)).when(!c.active, el => el.border_r(1).border_color(t.border))
        .bg(c.active ? t.background : idle).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(c.active ? t.background : hov))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "omarchy-menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(icons.length > 0, el => el.child(h_flex().flex_none().gap(6).children(icons.map(p => p.tint ? svg(p.icon).size(14).text_color(t.muted) : image(p.icon).size(14)))))
        .child(div().flex_1().min_w(0).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(Boolean(status), el => el.child(div().flex_none().text_size(10.5).text_color(t[c.status] ?? t.muted).child(status)))
        .when(c.status === "working", el => el.child(svg("mods/omarchy-tabs/icons/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(0).bg(t[c.status])))
        .when(c.active || this.overTab === c.id, el => el.child(div().id(`close-${c.id}`).flex_none().p(3).rounded(0).text_color(t.dim).hover(s => s.bg(hov).text_color(t.foreground)).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/omarchy-tabs/icons/close.svg").size(14))));
    };
    const root = layout();
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = panel && body
      ? [...(shared("workspace.panels") ?? ["files", "changes"]), "graph"].filter(id => Boolean(find(body, id)))
        .filter(id => id !== "changes" || space?.branch != null)
      : [];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      // Full-height cells like the tabs, so the strip has one rhythm and no odd gaps.
      return h_flex().id(`panel-${id}`).h_full().px(12).gap(6).flex_none().items_center().rounded(0).border_l(1).border_color(t.border)
        .text_size(12).bg(on ? sel : idle).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(on ? sel : hov)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    return h_flex().size_full().min_w(0).gap(0).items_center().bg(t.chrome)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").max_w(shown.length * 241).flex_shrink(1).min_w(0).h_full().items_center().gap(0).overflow_x_scrollbar().children(shown.map(item)))
      .child(div().id("tab-new").h_full().w(36).flex_none().flex().items_center().justify_center().rounded(0).border_r(1).border_color(t.border).bg(idle).text_color(t.dim)
        .hover(s => s.bg(hov).text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click(() => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })).child("+"))
      .child(div().flex_1())
      .child(h_flex().h_full().gap(0).items_center().flex_none()
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/omarchy-tabs/icons/files.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/omarchy-tabs/icons/changes.svg")))
      .when(enabled.includes("graph"), el => el.child(panelButton("graph", "Graph", "mods/omarchy-tabs/icons/graph.svg"))));
  }
}
