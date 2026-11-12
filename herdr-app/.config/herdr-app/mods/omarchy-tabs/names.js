// Follows OMP and Claude session titles, otherwise the program or shell folder.
// OMP drops only its π indicator and Braille spinner, preserving title emoji.
// A changed/reset tab name permanently opts that OMP tab out, across reloads.

import { spaces, panes, shared, setShared, run } from "herdr";

// Default launcher names are eligible only before we first manage an OMP tab.
const DEFAULTS = new Set(["Claude Code"]);
const OMP_DEFAULTS = new Set(["omp", "OMP", "Oh My Pi"]);
const KEY = "tab-titles.set"; // tab id -> the last name we gave it
const OMP_KEY = "tab-titles.omp"; // tab id -> true (following), false (manual)

function nameFor(p) {
  if (p.app === "omp") return (p.title ?? "").replace(/^π(?:\s+[\u2800-\u28ff])?\s*/, "");
  // Claude prefixes a spinner or ✳ while working.
  if (p.app === "claude-code") return (p.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  if (!p.program?.shell) return p.program?.name;
  if (!p.cwd) return null;
  return p.cwd === homeOf(p.cwd) ? "~" : p.cwd.split("/").filter(Boolean).pop();
}

// shortcut: assumes /home/<user> or /root homes, read $HOME if remote machines differ.
function homeOf(cwd) {
  return cwd.match(/^\/home\/[^/]+|^\/root/)?.[0];
}

// Pane headers follow their own session, independently of tab naming/opt-out.
export function paneTitle(p) {
  if (p.app === "omp" || p.app === "claude-code") {
    const title = nameFor(p);
    if (title?.trim()) return title;
  }
  return ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
}

export function syncNames() {
  // The checker and disconnected startup have no live layout to synchronize.
  const allSpaces = spaces();
  if (allSpaces.length === 0) return;
  const saved = shared(KEY) ?? {};
  const ours = { ...saved };
  const ompSaved = shared(OMP_KEY) ?? {};
  const omp = { ...ompSaved };
  const tabs = new Map(allSpaces.flatMap(s => s.tabs).map(t => [t.id, t]));
  // Stable priority for split tabs: first OMP, then Claude, then first terminal.
  const pick = new Map();
  for (const p of panes()) {
    if (!p.terminal) continue;
    const cur = pick.get(p.tab);
    const priority = pane => pane.app === "omp" ? 2 : pane.app === "claude-code" ? 1 : 0;
    if (!cur || priority(p) > priority(cur)) pick.set(p.tab, p);
  }
  for (const [id, p] of pick) {
    const tab = tabs.get(id);
    if (!tab || omp[id] === false) continue;
    // Detect an outside rename before considering a simultaneous title change.
    if (omp[id] === true && (!tab.named || ours[id] !== tab.name)) {
      omp[id] = false;
      continue;
    }
    const name = nameFor(p);
    if (!name?.trim()) continue;
    if (p.app === "omp") {
      if (omp[id] === undefined && tab.named && ours[id] !== tab.name &&
          !OMP_DEFAULTS.has(tab.name) && tab.name !== name) {
        omp[id] = false;
        continue;
      }
      omp[id] = true;
      // Record ownership even when the initial name already matches the title.
      ours[id] = name;
      if (tab.name !== name || !tab.named) run("tab.rename", { id: tab.id, name });
      continue;
    }
    if (tab.name === name) continue;
    if (tab.named && !DEFAULTS.has(tab.name) && ours[tab.id] !== tab.name) continue;
    run("tab.rename", { id: tab.id, name });
    ours[tab.id] = name;
  }
  for (const id of Object.keys(ours)) if (!tabs.has(id)) delete ours[id];
  for (const id of Object.keys(omp)) if (!tabs.has(id)) delete omp[id];
  if (JSON.stringify(ours) !== JSON.stringify(saved)) setShared(KEY, ours);
  if (JSON.stringify(omp) !== JSON.stringify(ompSaved)) setShared(OMP_KEY, omp);
}
