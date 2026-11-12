// alt-shift-left/right: the next tab with a working or blocked agent; when no other tab has one, the plain next.
const RUNNING = new Set(["working", "blocked"]);

export function jump(list, isCur, dir) {
  const n = list.length;
  const from = list.findIndex(isCur);
  const order = [];
  for (let k = 1; k <= n; k++) {
    const i = from < 0 ? (dir > 0 ? k - 1 : n - k) : (from + dir * k + n * n) % n;
    if (i !== from) order.push(list[i]);
  }
  return order.find(x => RUNNING.has(x.status)) ?? order[0] ?? null;
}
