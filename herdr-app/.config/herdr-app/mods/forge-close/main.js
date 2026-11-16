// forge-close: cmd-escape toggles the forge run window (keys.json: "cmd-escape": "mod.open:forge-close").
// A key can only run a command, and `overlay.close` closes dialogs and popups, not windows. So the key opens this
// tiny overlay, which acts once and closes itself:
//   - a run window is open: close it like its ×, and remember it in shared "forge.lastWindow";
//   - none is open: ask the sidebar (forge-runs) to open the last one again, through shared "forge.open".
import { View, div } from "gpui-kit";
import { props, shared, setShared, closeOverlay } from "herdr";

export default class ForgeClose extends View {
  init() {
    const win = shared("forge.window");
    if (win?.id) {
      closeOverlay(win.id);
      setShared("forge.lastWindow", { run: win.run, view: win.view ?? "coord" });
      setShared("forge.window", null);
    } else {
      const last = shared("forge.lastWindow");
      if (last?.run) setShared("forge.open", { dir: last.run, view: last.view ?? "coord", at: Date.now() });
    }
    const me = props()?.overlay;
    if (me) closeOverlay(me);
  }

  render() {
    return div();
  }
}
