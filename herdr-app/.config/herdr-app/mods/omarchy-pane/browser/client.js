// Talks to herdr-browser (~/.local/share/herdr-browser): it writes each page's
// state to live/<terminal>.json, and takes commands for the page a terminal
// shows on its local HTTP API.
//
// mods/omarchy-browser/client.js is a copy (a mod can't import from another
// mod's folder): change both.

import { home, readTextFile, watchFolder } from "herdr";

const STATE = () => `${home()}/.local/share/herdr-browser/state`;
export const liveDir = () => `${STATE()}/live`;
let token = null;
let port = null;

export async function readLive(terminal) {
  if (!terminal) return null;
  const text = await readTextFile(`${liveDir()}/${terminal}.json`).catch(() => null);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// One command for the page shown in `terminal`: navigate, back, forward,
// reload, stop, zoom, annotate, note, edit, remove, cancelPick, send, copy, native.
export async function act(terminal, op, args = {}) {
  token = token || (await readTextFile(`${STATE()}/token`).catch(() => null))?.trim();
  if (!token) return false;
  // The helper notes its port (HERDR_BROWSER_PORT moves it).
  port = port || Number(await readTextFile(`${STATE()}/port`).catch(() => "")) || 47616;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/do`, {
      method: "POST",
      headers: { "x-herdr-token": token, "content-type": "application/json" },
      body: JSON.stringify({ terminal, op, ...args }),
    });
    if (r.status === 401 || r.status === 403) token = null;
    return r.ok;
  } catch {
    port = null;
    return false;
  }
}

// Whether the changed paths include this terminal's page (Windows reports
// them with backslashes).
export function touches(paths, terminal) {
  return paths.some((p) => p.replace(/\\/g, "/").endsWith(`/${terminal}.json`));
}

// Calls onChange(paths) each time something in live/ changes, until stopped.
export function watchLive(cx, view, onChange) {
  cx.spawn(async (cx) => {
    for (;;) {
      if (view.closed) return;
      let changed;
      try { changed = await watchFolder(liveDir()); } catch { changed = null; }
      if (view.closed) return;
      if (!changed) {
        // The folder appears once the helper first runs: look again shortly.
        cx.timer.after(3000, (cx) => watchLive(cx, view, onChange));
        return;
      }
      await onChange(changed, cx);
    }
  });
}
