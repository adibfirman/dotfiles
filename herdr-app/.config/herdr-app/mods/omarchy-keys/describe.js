// Plain-English label and type for a key's action, and alt-1..alt-9 style runs folded into one row.

export const GROUPS = ["Spaces", "Tabs", "Panes", "Agents", "Terminal", "Dialogs", "Look", "Other"];

const DIRS = { left: "left", right: "right", up: "up", down: "down" };
const FIXED = {
  "space.next": ["Spaces", "Next space"], "space.prev": ["Spaces", "Previous space"],
  "space.new": ["Spaces", "New space"], "space.rename": ["Spaces", "Rename space"],
  "tab.next": ["Tabs", "Next tab"], "tab.prev": ["Tabs", "Previous tab"],
  "tab.new": ["Tabs", "New tab"], "tab.close": ["Tabs", "Close tab"], "tab.rename": ["Tabs", "Rename tab"],
  "omarchy-tabs.tab-next": ["Tabs", "Next running tab"],
  "omarchy-tabs.tab-prev": ["Tabs", "Previous running tab"],
  "omarchy-tabs.reopen": ["Tabs", "Reopen closed tab"],
  "pane.close": ["Panes", "Close pane"], "pane.zoom": ["Panes", "Zoom pane"],
  "agent.next": ["Agents", "Next agent"], "agent.prev": ["Agents", "Previous agent"],
  "terminal.open": ["Terminal", "New terminal"], "terminal.copy": ["Terminal", "Copy"],
  "terminal.paste": ["Terminal", "Paste"], "terminal.paste_image": ["Terminal", "Paste image"],
  "omarchy-pane.dev": ["Terminal", "Open page in Chrome"], "omarchy-pane.inspect": ["Terminal", "Open DevTools"],
  "app.palette": ["Dialogs", "Command palette"], "app.settings": ["Dialogs", "Settings"], "app.help": ["Dialogs", "Help"],
  "layout.switch": ["Look", "Switch layout"], "omarchy-bar.next-wallpaper": ["Look", "Next wallpaper"],
  "app.zoom_in": ["Look", "Zoom in"], "app.zoom_out": ["Look", "Zoom out"], "app.zoom_reset": ["Look", "Reset zoom"],
};
const DIALOG = { palette: "command palette", "mod-manager": "mod manager", keys: "keybindings", picker: "space picker" };

export function describe(action) {
  if (FIXED[action]) return { group: FIXED[action][0], label: FIXED[action][1] };
  const [cmd, arg = ""] = action.split(/:(.*)/s);
  if (cmd === "space.select") return { group: "Spaces", label: `Go to space ${arg}` };
  if (cmd === "tab.select") return { group: "Tabs", label: `Go to tab ${arg}` };
  if (cmd === "pane.go" && DIRS[arg]) return { group: "Panes", label: `Focus pane ${arg}` };
  if (cmd === "pane.swap" && DIRS[arg]) return { group: "Panes", label: `Swap pane ${arg}` };
  if (cmd === "pane.split" && DIRS[arg]) return { group: "Panes", label: `Split ${arg}` };
  if (cmd === "send") return { group: "Terminal", label: "Send keys" };
  if (cmd === "layout.toggle") return { group: "Look", label: `Show or hide ${arg}` };
  if (cmd === "mod.open") {
    const name = arg.replace(/^omarchy-/, "");
    return { group: "Dialogs", label: `Open ${DIALOG[name] ?? name.replace(/-/g, " ")}` };
  }
  return { group: "Other", label: action };
}

// alt-1 tab.select:1 ... alt-9 tab.select:9 -> one row "alt-1…9", "tab.select:1…9".
export function fold(list) {
  const out = [];
  for (const k of list) {
    const km = k.keys.match(/^(.*-)(\d)$/), am = k.action.match(/^(.*:)(\d)$/);
    const last = out[out.length - 1];
    if (km && am && km[2] === am[2] && last?.run && last.keyBase === km[1] && last.actBase === am[1] && last.to + 1 === +km[2]) {
      last.to = +km[2];
      last.keys = `${km[1]}${last.from}…${last.to}`;
      last.action = `${am[1]}${last.from}…${last.to}`;
      continue;
    }
    out.push(km && am && km[2] === am[2]
      ? { ...k, run: true, keyBase: km[1], actBase: am[1], from: +km[2], to: +km[2] }
      : k);
  }
  return out;
}
