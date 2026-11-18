// forge-runs: the "projects" section of the sidebar. Every forge run on this machine, one row each (its tooltip
// names the space it belongs to). Click opens the run window (a popup over the main area); right-click
// offers Rename and Remove; the "+" in the header opens the Start dialog, where you pick the space.
// The run window follows its run: when the terminal it should show changes, the window is reopened in place.
// Its right side has Graph | Pull request tabs; a tab click (shared "forge.window".tab) reopens it with the other mod.
// It also posts a notification when a run needs you or moves on (gate, blocked node, a coordinator blocked on a
// tool, your turn in a "With me" grill, done, a wave committed, a TLA+ counterexample), and publishes the run
// list in shared "forge.runs".

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, terminals, openOverlay, closeOverlay, notify, exec, theme, shared, setShared, layout, home, checking, nextCommand, run } from "herdr";

// A Lucide icon from omarchy-chrome/; it takes the text color of its parent.
const ico = (name, size) => svg(`mods/omarchy-chrome/${name}.svg`).size(size).flex_none();

const forgeBin = () => `${home()}/.local/bin/forge`;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width (the same rule as the spaces list).
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

const live = (a) => (a && terminals().some((t) => t.address === a && t.state === "live") ? a : null);
// The run's live coordinator terminal, or null (at the gate, or when the run is done).
const liveCoord = (f) => live(f.coordinator?.terminal);
// The run's chat (forge chat), when it runs and no coordinator does.
const liveChat = (f) => live(f.chat?.terminal);
// What the left side of the run window shows. View "coord": the coordinator, else the chat, else a panel.
// View "chat": the chat, else a panel (with "Start a chat").
const leftTerminal = (f, view) => (view === "chat" ? liveChat(f) : liveCoord(f) ?? liveChat(f));
const viewOf = (v) => (v === "chat" ? "chat" : "coord");
// The right side's tab: "graph" (the forge graph) or "pr" (the Pull request list and detail).
const tabOf = (x) => (x === "pr" ? "pr" : "graph");
// Blocked node ids: `forge runs` gives them at the top level (older CLIs only in HEAD).
const blockedOf = (f) => f.blocked ?? f.head?.blocked ?? [];
// A coordinator's "blocked: <role> needs <tool>: <command>" that nothing has acted on yet (forge runs → needs).
const needsOf = (f) => (f.needs && typeof f.needs === "object" ? f.needs : null);
// A terminal's agent status as terminals() reports it (a string, or {state}).
const statusOf = (a) => {
  const t = a ? terminals().find((x) => x.address === a) : null;
  const s = t?.status;
  return typeof s === "object" ? s?.state ?? null : s ?? null;
};
// The run's live coordinator terminal for its row: the one `forge runs` names, else any live coordinator labeled
// for this ticket (`forge runs` is polled every 8 s, so at a handoff the new one shows here first).
const rowCoord = (f) => liveCoord(f) ?? terminals().find((t) => t.state === "live" && typeof t.labels?.forge === "string"
  && t.labels.forge.startsWith(`${f.ticket}/`) && /-coord-\d+$/.test(t.labels.forge))?.address ?? null;

// What a run's row shows: the phase and blocks first, then the coordinator's live status. you: the run waits for
// you; note: a line for the tooltip; mark: the name of its icon in omarchy-chrome/.
function runState(f, t) {
  const h = f.head ?? {};
  const blocked = blockedOf(f).length + (needsOf(f) ? 1 : 0);
  const show = (mark, color, you, note = "") => ({ mark, color, you, blocked, note });
  if (blocked) return show("circle-alert", t.blocked, true);
  if (h.phase === "gate") return show("circle-alert", t.accent, true);
  if (h.phase === "done") return show("check", t.done, false);
  const coord = rowCoord(f);
  if (!coord) return show("circle", t.dim, false, h.paused ? "" : "stopped: Restart in the run window");
  const st = statusOf(coord);
  // No status yet: the agent is starting.
  if (st === "working" || st == null) return show("circle-dot", t.working, false);
  if (st === "blocked") return show("circle-alert", t.blocked, true, "the coordinator waits for an answer in its terminal");
  const label = terminals().find((x) => x.address === coord)?.labels?.forge ?? "";
  if (/grill-me-coord-\d+$/.test(label)) return show("circle-alert", t.accent, true, "your turn in the grill");
  return show("circle", t.dim, false, "coordinator idle: open the run window");
}

// A forge run opens in one floating window (not a tab). shared "forge.window" tells this list which run is open,
// which terminal it shows (terminal), the left view and right tab the bar asks for (view, tab), and the ones the
// window shows now (shownView, shownTab). Nothing here waits on a shell call: the window shows at once, and each
// mod in it loads its own data.
function openRunWindow(f, view, tab) {
  const win0 = shared("forge.window");
  const mine = win0?.run === f.dir;
  const v = viewOf(view ?? (mine ? win0?.view : null));
  const tb = tabOf(tab ?? (mine ? win0?.tab : null));
  const title = f.title || f.ticket;
  const term = leftTerminal(f, v);
  // Left: the coordinator's own Claude terminal (or the run's chat), to type into as usual. Herdr closes a window
  // when its terminal ends, so at a phase handoff this list reopens it with the next one. With none running,
  // a panel says so. Right: the Graph | Pull request tabs above one framed panel. A window cannot switch a block
  // in place (layout.select reaches only the main layout), so a tab click reopens the window with the other mod;
  // each mod draws its cached data first, so the switch shows no empty frame.
  const panel = { background: "background", border: { width: 1, color: "border" }, radius: 8 };
  const right = tb === "pr" ? { mod: "prs", props: { run: f.dir } } : { mod: "forge", props: { run: f.dir } };
  const win = { type: "column", background: "chrome", children: [
    { type: "block", size: { px: 40 }, content: { mod: "forge-window", props: { part: "bar", title, run: f.dir } } },
    { type: "row", padding: 8, gap: 8, children: [
      { type: "block", size: { weight: 1 }, min: 260, ...panel, content: term ? { terminal: term } : { mod: "forge-window", props: { part: "agent", run: f.dir } } },
      { type: "column", size: { weight: 1 }, min: 420, gap: 6, children: [
        { type: "block", size: { px: 32 }, content: { mod: "forge-window", props: { part: "tabs", run: f.dir } } },
        { type: "block", size: { weight: 1 }, min: 220, ...panel, content: right },
      ] },
    ] },
  ] };
  // No key: Herdr saves the spot of a keyed window, so one stray drag kept the window off center. Without a key
  // every open is centered, and Herdr does not replace the open window: close it here first. Its id can be stale
  // (Herdr closes a window whose terminal ends).
  if (win0?.id) {
    try {
      closeOverlay(win0.id);
    } catch {
      // already closed
    }
  }
  const id = openOverlay({ kind: "window", width: 0.9, height: 0.88, layout: win });
  setShared("forge.window", { run: f.dir, id, terminal: term, view: v, tab: tb, shownView: v, shownTab: tb });
}

// Closes the run window like its ×: forge.lastWindow keeps the run, and a cleared forge.window stops the reopen
// at the next handoff. The id can be stale (Herdr closes a window whose terminal ends).
function closeRunWindow() {
  const win = shared("forge.window");
  if (!win?.id) return;
  try {
    closeOverlay(win.id);
  } catch {
    // already closed
  }
  if (win.run) setShared("forge.lastWindow", { run: win.run, view: win.view ?? "coord" });
  setShared("forge.window", null);
}

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// The folder a space works in: where most of its panes are (agent panes 2, shells 1). Its stored folder
// only breaks a tie or fills in for an empty space: a space made from one repo can live in another.
// A shell in <root>/.forge (where forge keeps its runs) works in <root>.
const outOfForge = (cwd) => cwd.replace(/\/\.forge(\/.*)?$/, "");
function workFolder(w, ps) {
  const tabs = new Set((w.tabs ?? []).map((x) => x.id));
  const score = new Map();
  for (const p of ps) if (tabs.has(p.tab) && p.cwd) {
    const cwd = outOfForge(p.cwd);
    score.set(cwd, (score.get(cwd) ?? 0) + (p.status ? 2 : 1));
  }
  if (w.folder) score.set(w.folder, (score.get(w.folder) ?? 0) + 0.5);
  let best = null, top = 0;
  for (const [folder, n] of score) if (n > top) [best, top] = [folder, n];
  return best ?? place(w, ps);
}

// Which one space a run belongs to: the space saved in run.json (forge init --space, an id or a name), else the
// one older runs recorded in shared "forge.spaces", else the space most in the run's folder (agent panes 2,
// shells 1, the space's own folder 1).
function ownerOf(f, sp, ps) {
  const saved = f.space ? sp.find((s) => s.id === f.space || s.name === f.space) : null;
  if (saved) return saved.id;
  const recorded = (shared("forge.spaces") ?? {})[f.dir];
  if (recorded && sp.some((s) => s.id === recorded)) return recorded;
  const inside = (cwd) => cwd === f.worktree || (cwd ?? "").startsWith(`${f.worktree}/`);
  let best = null, bestScore = 0;
  for (const s of sp) {
    const tabs = new Set((s.tabs ?? []).map((x) => x.id));
    const score = ps.filter((p) => tabs.has(p.tab) && inside(p.cwd)).reduce((n, p) => n + (p.status ? 2 : 1), 0) + (s.folder === f.worktree ? 1 : 0);
    if (score > bestScore) [best, bestScore] = [s.id, score];
  }
  return best;
}

export default class ForgeRuns extends View {
  init(_props, cx) {
    this.forge = [];
    this.prev = null; // the last poll's state per run, for the notifications
    this.turn = new Map(); // each forge chat's and coordinator's last status, per terminal address
    this.openAt = shared("forge.open")?.at ?? null; // a request from before this mod loaded is not acted on
    this.renameIn = InputState.new({ placeholder: "Title" });
    this.renameIn.on("submit", (_e, cx) => this.saveRename(cx));
    this.renameIn.on("blur", (_e, cx) => { if (this.renaming) { this.renaming = null; cx.notify(); } });
    this.loadForge(cx);
    cx.timer.every(8000, (cx) => this.loadForge(cx));
    cx.timer.every(2000, (cx) => this.followWindow(cx));
    // "forge-runs.close": ctrl-s then escape, sent by the which-key popup. One press closes a peek and the run
    // window: overlay.close closes the top dialog or popup (a peek is one), and it cannot tell if one was open.
    // The short wait lets the which-key popup close first, so overlay.close does not take that popup.
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) !== "close") continue;
        const closeAll = () => {
          run("overlay.close");
          closeRunWindow();
        };
        try {
          cx.timer.after(60, closeAll);
        } catch {
          closeAll();
        }
      }
    });
  }

  // The open run window follows its run: when the terminal it should show changes (a phase handoff, the gate, the
  // end, a chat opened or ended), reopen it (centered). Herdr closes a window whose terminal ends, so this also
  // brings it back after a handoff. Only the window's × (it clears forge.window) stops this.
  followWindow(cx) {
    this.openRequested(cx);
    this.finished();
    // The row marks follow each coordinator's live status: redraw when one changes.
    const marks = JSON.stringify(this.forge.map((f) => { const c = rowCoord(f); return [f.dir, c, statusOf(c)]; }));
    if (marks !== this.marks) {
      this.marks = marks;
      cx.notify();
    }
    const win = shared("forge.window");
    if (!win?.run || this.following) return;
    this.following = true;
    cx.spawn(async () => {
      try {
        const r = await exec(forgeBin(), ["runs"], { timeout: 20000 }).catch(() => null);
        if (r?.code !== 0) return;
        const f = JSON.parse(r.stdout).find((x) => x.dir === win.run);
        const now = shared("forge.window");
        if (f && now?.run === win.run && leftTerminal(f, viewOf(now.view)) !== (now.terminal ?? null)) await openRunWindow(f, now.view);
      } finally {
        this.following = false;
      }
    });
  }

  loadForge(cx) {
    cx.spawn(async (cx) => {
      const r = await exec(forgeBin(), ["runs"], { timeout: 20000 }).catch(() => null);
      if (r?.code !== 0) return;
      const next = JSON.parse(r.stdout);
      this.announce(next);
      const key = JSON.stringify(next.map((f) => [f.dir, f.title, f.head?.phase, f.head?.cycle, f.head?.paused, blockedOf(f), needsOf(f)?.at ?? null, f.coordinator?.terminal, f.chat?.terminal, f.progress?.committed]));
      this.forge = next;
      this.openWaiting = false;
      this.publish();
      if (key === this.forgeKey) return;
      this.forgeKey = key;
      cx.notify();
    });
  }

  // shared "forge.runs": the list with each run's owning space, for the agents list's forge groups.
  publish() {
    const sp = spaces(), ps = panes();
    const list = this.forge.map((f) => ({ dir: f.dir, ticket: f.ticket, title: f.title || f.ticket, space: ownerOf(f, sp, ps) }));
    const key = JSON.stringify(list);
    if (key === this.published) return;
    this.published = key;
    setShared("forge.runs", list);
  }

  // shared "forge.open" = {dir, view, at}: another mod (the PR panel, the agents list, cmd-escape) asks for a run window.
  openRequested(cx) {
    const o = shared("forge.open");
    if (!o?.at || o.at === this.openAt) return;
    const f = this.forge.find((x) => x.dir === o.dir);
    // A run started a moment ago is not in the list until the next poll: keep the request for up to 30 s.
    if (!f && Date.now() - o.at < 30_000) {
      if (!this.openWaiting) {
        this.openWaiting = true;
        this.loadForge(cx);
      }
      return;
    }
    this.openAt = o.at;
    this.openWaiting = false;
    if (f) openRunWindow(f, o.view);
  }

  // setShared re-renders every mod, so render calls this: a request in "forge.open" (the agents list, the PR panel,
  // the Start dialog, cmd-escape) or a tab or view change in "forge.window" (the window's bar) acts at once, not on
  // the next 2 s tick. It runs after the frame, not inside it. A run not in the list yet is left to openRequested
  // on the timer, which loads the list first.
  sharedChanged() {
    if (checking()) return;
    const o = shared("forge.open");
    if (o?.at && o.at !== this.openAt) {
      const f = this.forge.find((x) => x.dir === o.dir);
      if (f) {
        this.openAt = o.at;
        openRunWindow(f, o.view);
      }
      return;
    }
    const w = shared("forge.window");
    if (!w?.run) return;
    if (tabOf(w.tab) === tabOf(w.shownTab) && viewOf(w.view) === viewOf(w.shownView)) return;
    const f = this.forge.find((x) => x.dir === w.run);
    if (f) openRunWindow(f, w.view, w.tab);
  }

  // A click switches to the run's space, else to the active one: every notification needs an action, because
  // agent-notify sends only those to the system (while Herdr is not in front).
  tell(f, text, level = "info", action = null) {
    const sp = spaces();
    const space = ownerOf(f, sp, panes()) ?? sp.find((s) => s.active)?.id ?? sp[0]?.id;
    notify({ title: `${f.title || f.ticket}: ${text}`, level, ...(action ? { action } : space ? { action: { name: "space.select", args: { id: space } } } : {}) });
  }

  // Compare this poll with the last one. Never on the first poll, and never for a run seen for the first time.
  announce(next) {
    const snap = (f) => ({ phase: f.head?.phase ?? null, cycle: f.head?.cycle ?? null, dir: f.head?.dir ?? "", blocked: blockedOf(f), committed: f.progress?.committed ?? [], needs: needsOf(f)?.at ?? null });
    // After a reload this.prev is empty: compare with the poll saved in shared state, so no event is lost.
    const saved = shared("forge.lastPoll");
    const prev = this.prev ?? (saved && typeof saved === "object" ? new Map(Object.entries(saved)) : null);
    this.prev = new Map(next.map((f) => [f.dir, snap(f)]));
    const keep = JSON.stringify(Object.fromEntries(this.prev));
    if (keep !== this.savedPoll) {
      this.savedPoll = keep;
      setShared("forge.lastPoll", Object.fromEntries(this.prev));
    }
    if (!prev) return;
    for (const f of next) {
      const was = prev.get(f.dir), now = this.prev.get(f.dir);
      if (!was) continue;
      if (now.phase === "gate" && was.phase !== "gate") this.tell(f, "spec ready, approve or comment", "warning");
      for (const n of now.blocked) if (!was.blocked.includes(n)) this.tell(f, `${n} blocked, retry or skip`, "error");
      if (now.needs && now.needs !== (was.needs ?? null)) {
        const nd = needsOf(f);
        this.tell(f, `blocked, ${nd.role ?? "an agent"} needs ${nd.tool ?? nd.command ?? "a tool"}`, "error");
      }
      if (now.phase === "done" && was.phase !== "done") this.tell(f, "done, push and create the PR", "success");
      const waves = f.progress?.waves;
      for (const k of now.committed) if (!was.committed.includes(k)) this.tell(f, `wave ${k} committed${waves ? ` of ${waves}` : ""}`, "success");
      if (now.cycle !== was.cycle && /^\d+-cex/.test(now.dir)) this.tell(f, "TLA+ found a problem, back to grill", "warning");
    }
  }

  // A forge chat or coordinator finished its turn (working → idle or done): Herdr alerts only for agents in panes,
  // and these run in the background. Not while that terminal is on screen in the run window. Nodes and classifiers
  // report to their coordinator, so they are left out. A "With me" grill coordinator that stops waits for the user.
  finished() {
    const shown = shared("forge.window")?.terminal ?? null;
    const seen = new Set();
    for (const t of terminals()) {
      const label = t.labels?.forge;
      if (typeof label !== "string" || t.state !== "live") continue;
      const id = label.split("/").pop();
      const chat = label.endsWith("/chat");
      if (!chat && !/-coord-\d+$/.test(id)) continue;
      seen.add(t.address);
      const st = statusOf(t.address);
      const was = this.turn.get(t.address);
      this.turn.set(t.address, st);
      if (was !== "working" || !(st === "idle" || st === "done" || st === "blocked") || t.address === shown) continue;
      const f = this.forge.find((x) => x.ticket === label.split("/")[0]);
      if (!f) continue;
      const text = id.startsWith("grill-me-coord") ? "your turn in the grill" : chat ? "chat finished" : `${id.replace(/-\d+$/, "")} finished`;
      this.tell(f, text, id.startsWith("grill-me-coord") ? "warning" : "info", { name: "terminal.peek", args: { terminal: t.address } });
    }
    for (const a of [...this.turn.keys()]) if (!seen.has(a)) this.turn.delete(a);
  }

  // Rename: `forge rename` changes only the title this list shows (not the ticket or the folder).
  saveRename(cx) {
    const dir = this.renaming;
    const title = this.renameIn.value().trim();
    this.renaming = null;
    cx.notify();
    if (!dir || !title) return;
    cx.spawn(async (cx) => {
      const r = await exec(forgeBin(), ["rename", title, "--run", dir], { timeout: 20000 }).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
      if (r.code !== 0) notify({ title: "Forge: rename failed", body: String(r.stderr || r.stdout || "").trim().slice(0, 300), level: "error" });
      this.forgeKey = null;
      this.loadForge(cx);
    });
  }

  // Remove a run: `forge remove` ends its agents and chat, takes it off the list, and removes the worktrees forge
  // made. The .forge folder (context, spec, history) and the branches stay.
  removeRun(f, cx) {
    this.confirm = null;
    this.menuFor = null;
    cx.spawn(async (cx) => {
      const r = await exec(forgeBin(), ["remove", "--run", f.dir], { timeout: 60000 }).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
      if (r.code !== 0) {
        notify({ title: "Forge: remove failed", body: String(r.stderr || r.stdout || "").trim().slice(0, 300), level: "error" });
        return;
      }
      const win = shared("forge.window");
      if (win?.run === f.dir) {
        closeOverlay(win.id);
        setShared("forge.window", null);
      }
      if (shared("forge.lastWindow")?.run === f.dir) setShared("forge.lastWindow", null);
      const owners = { ...(shared("forge.spaces") ?? {}) };
      delete owners[f.dir];
      setShared("forge.spaces", owners);
      let out = {};
      try {
        out = JSON.parse(r.stdout || "{}");
      } catch {
        /* printed text: no details */
      }
      const removed = out.worktrees?.removed ?? [];
      const skipped = out.worktrees?.skipped ?? [];
      const body = [
        `${f.ticket}: the .forge folder and the branches stay.`,
        removed.length ? `Worktrees removed: ${removed.length}.` : "",
        ...skipped.map((x) => `Kept ${x.path}: ${x.reason}`),
      ].filter(Boolean).join("\n");
      notify({ title: "Forge: run removed", body, level: skipped.length ? "warning" : "success" });
      this.forgeKey = null;
      this.loadForge(cx);
    });
  }

  // The header's "+": the Start dialog. You pick the space there, then open a run or start one in it. Each space
  // comes with its work folder.
  start() {
    const ps = panes();
    const list = spaces().map((s) => ({ id: s.id, name: s.name, folder: workFolder(s, ps) }));
    openOverlay({ mod: "forge-start", kind: "dialog", width: 540, height: 640, props: { spaces: list } });
  }

  row(f, t, owners, sp, collapsed) {
    const h = f.head ?? {};
    // Waiting for you: the gate, a node blocked by the retry cap (Retry or Skip in the run window), a coordinator
    // blocked on a tool (Lift or Restart in the run window), or your turn in a "With me" grill.
    const nd = needsOf(f);
    const { mark, color, note } = runState(f, t);
    const open = shared("forge.window")?.run === f.dir;
    const owner = sp.find((s) => s.id === owners.get(f.dir));
    const tip = `${f.ticket} · ${owner ? `space ${owner.name}` : "no space"} · cycle ${h.cycle ?? "?"} · ${h.phase ?? "?"}${h.paused ? " · paused" : ""}${blockedOf(f).length ? ` · ${blockedOf(f).length} blocked: Retry or Skip in the run window` : ""}${nd ? ` · blocked: ${nd.role ?? "an agent"} needs ${nd.tool ?? nd.command}: Lift or Restart in the run window` : ""}${note ? ` · ${note}` : ""}`;
    if (collapsed) {
      return div().id(`run-${f.dir}`).size(30).flex_none().flex().items_center().justify_center().border(1)
        .border_color(open ? t.accent : t.border).text_color(color).tooltip(`${f.title || f.ticket} · ${tip}`)
        .hover((s) => s.bg(t.foreground + "14")).on_click(() => openRunWindow(f)).child(ico(h.paused ? "pause" : mark, 14));
    }
    return h_flex().id(`run-${f.dir}`).h(24).flex_none().px(8).gap(7).items_center().text_size(12)
      .text_color(open ? t.foreground : t.muted).when(open, (e) => e.bg(t.accent + "26").border_l(2).border_color(t.accent))
      .cursor_pointer().hover((s) => s.bg(t.foreground + "14").text_color(t.foreground))
      .tooltip(tip)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        // With the menu open, a click closes it; otherwise it opens the run window.
        if (this.menuFor === f.dir || this.confirm === f.dir) { this.menuFor = null; this.confirm = null; cx.notify(); return; }
        if (this.renaming !== f.dir) openRunWindow(f);
      })
      // Right-click: Rename and Remove, at the row's right end.
      .on_mouse_down("right", (_e, cx) => { this.menuFor = this.menuFor === f.dir ? null : f.dir; this.confirm = null; cx.notify(); })
      .child(div().flex_none().flex().items_center().text_color(color).child(ico(h.paused ? "pause" : mark, 12)))
      .child(this.renaming === f.dir
        ? div().flex_1().min_w(0).h(20).px(4).flex().items_center().rounded(4).border_1().border_color(t.accent).bg(t.background)
            .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); this.renaming = null; cx.notify(); } })
            .child(Input.new(this.renameIn).h_full().text_size(12))
        : div().flex_1().min_w(0).truncate().child(f.title || f.ticket))
      .children(this.menuItems(f, t));
  }

  // The row's right end: empty, or (after a right-click) Rename and Remove, then remove/keep to confirm. The row
  // icon and the tooltip show the state, so the row has no status word.
  menuItems(f, t) {
    const link = (id, text, color, tip, act) => div().id(id).flex_none().px(4).rounded(4).text_size(10.5).text_color(color)
      .hover((s) => s.bg(t.foreground + "14").text_color(t.foreground)).tooltip(tip)
      .on_click((_e, cx) => { cx.stop_propagation(); act(cx); }).child(text);
    if (this.confirm === f.dir) return [
      link(`run-rm-yes-${f.dir}`, "remove", t.blocked, "Ends its agents and chat, and removes the worktrees forge made. The .forge folder (context, spec, history) and the branches stay. A worktree with uncommitted changes is kept.", (cx) => this.removeRun(f, cx)),
      link(`run-rm-no-${f.dir}`, "keep", t.dim, "Keep this run", (cx) => { this.confirm = null; this.menuFor = null; cx.notify(); }),
    ];
    if (this.menuFor === f.dir) return [
      link(`run-rename-${f.dir}`, "rename", t.muted, "Change the title this list shows", (cx) => {
        this.menuFor = null;
        this.renaming = f.dir;
        this.renameIn.set_value(f.title || f.ticket);
        this.renameIn.focus();
        cx.notify();
      }),
      link(`run-remove-${f.dir}`, "remove", t.blocked, "Remove this run (asks again)", (cx) => { this.confirm = f.dir; cx.notify(); }),
    ];
    return [];
  }

  render() {
    Promise.resolve().then(() => this.sharedChanged());
    const t = theme();
    const collapsed = narrow();
    const sp = spaces(), ps = panes();
    const owners = new Map(this.forge.map((f) => [f.dir, ownerOf(f, sp, ps)]));
    const plus = div().id("runs-new").size(22).flex_none().flex().items_center().justify_center().rounded(0).border(1).border_color(t.foreground + "00")
      .hover((s) => s.bg(t.foreground + "14").border_color(t.foreground + "40").text_color(t.foreground)).on_click(() => this.start())
      .tooltip("Forge: start a run (pick the space in the dialog)")
      .child(svg("mods/omarchy-chrome/plus.svg").size(14));
    return v_flex().size_full().min_h(0).bg(t.chrome).pt(10).text_size(12)
      .child(h_flex().h(26).flex_none().when(collapsed, (el) => el.justify_center()).when(!collapsed, (el) => el.pl(18).pr(10).justify_between()).items_center().text_size(11).text_color(t.dim)
        .when(!collapsed, (el) => el.child(`projects ${this.forge.length}`))
        .child(plus))
      .child(v_flex().id("runs-list").flex_1().min_h(0).px(collapsed ? 0 : 10).pt(6).pb(10).gap(collapsed ? 6 : 2).when(collapsed, (el) => el.items_center()).overflow_y_scrollbar().mode("always")
        .when(!this.forge.length && !collapsed, (el) => el.child(div().px(8).text_size(12).text_color(t.dim).child("No runs. Use + to start one.")))
        .children(this.forge.map((f) => this.row(f, t, owners, sp, collapsed))));
  }
}
