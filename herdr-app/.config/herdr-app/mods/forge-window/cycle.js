// Pure cycle logic for the run window's bar: no herdr imports, so `node --test` can load it.

/**
 * Why a run's current cycle exists, from `forge status`: { source, text }, or null for the first cycle.
 * source is the pill's word (a counterexample, a follow-up, a gate comment), or null when the cycle has only a reason.
 */
export function cycleNote(st) {
  if (!st || !(st.cycle > 1)) return null;
  const o = st.cycleOpen ?? {};
  const src = { gate: "gate comment", qa: "QA follow-up", pr: "PR follow-up", user: "follow-up" };
  if (String(o.slug ?? "").startsWith("cex")) return { source: "counterexample", text: `From cycle ${st.cycle - 1}: ${o.reason ?? ""}` };
  if (o.followup) return { source: src[o.followup.source] ?? "follow-up", text: String(o.followup.text ?? "") };
  return { source: null, text: o.reason || `started at ${o.start ?? "?"}` };
}
