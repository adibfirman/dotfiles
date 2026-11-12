// claude-usage: Claude Code's usage limits in the top bar, as the statusline used to show them:
// the 5-hour window, the weekly limit of one model (for example Fable) and the weekly limit of
// all models ("Others"). It reads the cache that ~/.claude/statusline.sh writes once a minute
// while a Claude Code session runs, so Herdr never reads the login token or calls the network.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, openOverlay, props, readTextFile, settings, theme } from "herdr";

const MOD = "claude-usage";
const OLD = 5 * 60e3;
const POPUP_W = 300;
const GAP = 6;
// The statusline's 256-color steps 42, 220 and 196.
const GREEN = "#00d787";
const YELLOW = "#ffd700";
const RED = "#ff0000";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const cachePath = () => `${home()}/.claude/.usage-cache.json`;
const clamp = (v) => Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
const tone = (used) => (used < 60 ? GREEN : used < 85 ? YELLOW : RED);
const pad = (n) => String(n).padStart(2, "0");

// 5h first, then the weekly limit of one model, then the weekly limit of all models.
function windows(data) {
  if (!data || typeof data !== "object") return [];
  const limits = Array.isArray(data.limits) ? data.limits : [];
  const find = (kind) => limits.find((l) => l?.kind === kind);
  const session = find("session");
  const scoped = find("weekly_scoped");
  const all = find("weekly_all");
  const out = [];
  const five = session?.percent ?? data.five_hour?.utilization;
  if (typeof five === "number") {
    out.push({ label: "5h", long: "5-hour limit", used: clamp(five), resets: session?.resets_at ?? data.five_hour?.resets_at });
  }
  if (typeof scoped?.percent === "number") {
    const model = scoped.scope?.model?.display_name ?? "Model";
    out.push({ label: model, long: `Weekly ${model} limit`, used: clamp(scoped.percent), resets: scoped.resets_at ?? data.seven_day?.resets_at });
  }
  const week = all?.percent ?? data.seven_day?.utilization;
  if (typeof week === "number") {
    out.push({ label: "Others", long: "Weekly limit, all models", used: clamp(week), resets: all?.resets_at ?? data.seven_day?.resets_at });
  }
  return out;
}

// The statusline's countdown: 2h16m, 45m, 6d10h. Empty when the time is unknown or past.
function left(iso, now = Date.now()) {
  const ms = Date.parse(iso ?? "") - now;
  if (!(ms >= 0)) return "";
  const m = Math.floor(ms / 60e3);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${pad(m % 60)}m`;
  return `${m % 60}m`;
}

const clockAt = (iso) => {
  const d = new Date(iso ?? "");
  return Number.isNaN(d.getTime()) ? "" : `${DAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const ago = (ms) => (ms < 60e3 ? "just now" : ms < 3600e3 ? `${Math.floor(ms / 60e3)} min ago` : `${Math.floor(ms / 3600e3)} h ago`);

export default class ClaudeUsage extends View {
  init(_props, cx) {
    this.list = [];
    this.updated = null;
    this.load(cx);
    cx.timer.every(30e3, (cx) => this.load(cx));
  }

  load(cx) {
    cx.spawn(async (cx) => {
      const path = cachePath();
      const text = await readTextFile(path).catch(() => null);
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_e) {
        data = null;
      }
      // The cache has no time of its own: its file time is when the statusline last fetched.
      const stat = await exec("sh", ["-c", 'if [ "$(uname)" = Darwin ]; then stat -f %m "$1"; else stat -c %Y "$1"; fi', "sh", path]).catch(() => null);
      const seconds = Number(stat?.stdout?.trim());
      this.list = windows(data);
      this.updated = stat?.code === 0 && seconds > 0 ? seconds * 1000 : null;
      cx.notify();
    });
  }

  render() {
    if (props()?.overlay) return this.details();
    const t = theme();
    const now = Date.now();
    const old = !this.updated || now - this.updated > OLD;
    const narrow = this.narrow ?? globalThis.window.viewport_size().width < 1024;
    const color = (w) => (old ? t.dim : tone(w.used));
    const seg = (w) => h_flex().gap(5).items_center().flex_none()
      .child(div().whitespace_nowrap().text_color(color(w)).child(`${w.label}[${w.used}%]`))
      .when(!narrow, (el) => el.child(div().relative().w(48).h(6).bg(t.border)
        .child(div().absolute().left(0).top(0).h_full().w(`${w.used}%`).bg(color(w)))))
      .child(div().whitespace_nowrap().text_color(t.dim).child(left(w.resets, now)));
    const sep = (i) => div().id(`usage-sep-${i}`).flex_none().text_color(t.border).child("│");
    const segs = this.list.map(seg);
    return h_flex().id("root").size_full().items_center().justify_end().bg(t.chrome).overflow_hidden()
      .px(10).gap(narrow ? 10 : 14).text_size(11)
      .on_size_change((_size, cx) => {
        const n = globalThis.window.viewport_size().width < 1024;
        if (n !== this.narrow) {
          this.narrow = n;
          cx.notify();
        }
      })
      .on_mouse_down("left", (e, cx) => {
        this.anchor = e.bounds;
        cx.stop_propagation();
      })
      .on_click(() => this.open())
      .tooltip(this.list.map((w) => `${w.long}: ${w.used}%`).join("\n") || "No Claude usage yet")
      .when(old && Boolean(this.updated), (el) => el.child(div().whitespace_nowrap().text_color(t.dim).child(ago(now - this.updated))))
      .when(!segs.length, (el) => el.child(div().whitespace_nowrap().text_color(t.dim).child("Claude usage: no data")))
      .children(segs.flatMap((s, i) => (i ? [sep(i), s] : [s])));
  }

  open() {
    const b = this.anchor;
    const z = Number(settings()?.zoom) || 1;
    const height = 76 + Math.max(1, this.list.length) * 64;
    const at = b ? { x: Math.max(0, b.x + b.width - (POPUP_W + GAP) * z), y: b.y + b.height + GAP * z } : undefined;
    openOverlay({ mod: MOD, kind: "popup", frame: "none", width: POPUP_W, height, at, props: { details: true } });
  }

  details() {
    const t = theme();
    const now = Date.now();
    const row = (w) => {
      const count = left(w.resets, now);
      const reset = [count && `resets in ${count}`, clockAt(w.resets)].filter(Boolean).join(" · ");
      return v_flex().gap(6)
        .child(h_flex().justify_between().items_end()
          .child(div().text_color(t.foreground).child(w.long))
          .child(div().text_size(18).font_semibold().text_color(tone(w.used)).child(`${w.used}%`)))
        .child(div().relative().w_full().h(6).bg(t.border)
          .child(div().absolute().left(0).top(0).h_full().w(`${w.used}%`).bg(tone(w.used))))
        .child(div().text_size(11.5).text_color(t.dim).child(reset || "no reset time"));
    };
    const status = this.updated ? `Updated ${ago(now - this.updated)} by the Claude Code statusline` : "No data yet: start a Claude Code session";
    return v_flex().w_full().p(14).gap(14).text_size(12).text_color(t.muted)
      .bg(t.popover).border(1).border_color(t.border).rounded(0)
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Claude usage"))
      .children(this.list.map(row))
      .child(div().text_size(11.5).text_color(t.dim).child(status));
  }
}
