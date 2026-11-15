// system-monitor: local CPU and memory use as percentages in the top bar, sampled every 5 s on
// macOS and Linux. Each metric is sampled and shown on its own; a failed sample dims the value.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, theme, window } from "herdr";
import { FAILED, colorSource, createGate, initialMetric, linuxCpu, parseMacMem, parseMeminfo, parseTopCpu, reduceAll, segment } from "./sample.js";

// A rejection or a timeout becomes null, which the parsers treat as a failed sample.
const run = (cmd, args) => exec(cmd, args, { timeout: 4000 }).catch(() => null);

export default class SystemMonitor extends View {
  init(_props, cx) {
    this.metrics = { cpu: initialMetric(), mem: initialMetric() };
    // The previous Linux /proc/stat reading; linuxCpu needs null, not undefined, for "none yet".
    this.prev = null;
    this.gate = createGate();
    this.poll(cx);
    cx.timer.every(5e3, (cx) => this.poll(cx));
  }

  poll(cx) {
    // A tick that arrives while a sample is still running is skipped.
    if (!this.gate.tryEnter()) return;
    cx.spawn(async (cx) => {
      try {
        const platform = window()?.platform;
        const apply = (which, sample) => {
          this.metrics = reduceAll(this.metrics, which, sample);
          cx.notify();
        };
        if (platform === "macos") {
          await Promise.all([
            (async () => apply("cpu", parseTopCpu(await run("top", ["-l", "2", "-n", "0", "-s", "1"]))))(),
            (async () => apply("mem", parseMacMem(await run("sh", ["-c", "vm_stat; sysctl -n hw.memsize"]))))(),
          ]);
        } else if (platform === "linux") {
          await Promise.all([
            (async () => {
              const r = linuxCpu(await run("cat", ["/proc/stat"]), this.prev);
              this.prev = r.prev;
              apply("cpu", r.sample);
            })(),
            (async () => apply("mem", parseMeminfo(await run("cat", ["/proc/meminfo"]))))(),
          ]);
        } else {
          apply("cpu", FAILED);
          apply("mem", FAILED);
        }
      } finally {
        this.gate.leave();
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    const { cpu, mem } = this.metrics;
    const seg = (m, label) => div().flex_none().whitespace_nowrap().text_color(colorSource(m, t.dim)).child(segment(label, m));
    return h_flex().id("root").size_full().items_center().justify_center().bg(t.chrome).overflow_hidden()
      .px(10).gap(10).text_size(11)
      .child(seg(cpu, "CPU"))
      .child(div().flex_none().text_color(t.border).child("│"))
      .child(seg(mem, "MEM"));
  }
}
