// Claude Code's screen ends with its prompt box: a rule line, the "❯" input, a rule line, then a status line.
// The read-only agent view drops everything from the second-to-last rule line down, and hc's own notes.
export function trimPrompt(text) {
  const lines = String(text ?? "").split("\n").filter((l) => !l.startsWith("[hc]"));
  const rules = lines.map((l, i) => (/^\s*─{8,}\s*$/.test(l) ? i : -1)).filter((i) => i >= 0);
  const cut = rules.length >= 2 ? rules[rules.length - 2] : lines.length;
  const kept = lines.slice(0, cut);
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  return kept;
}
