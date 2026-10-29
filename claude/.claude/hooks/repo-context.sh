#!/usr/bin/env bash
# SessionStart hook: list the context files at the repo root (CLAUDE.md, AGENTS.md, CLAUDE.local.md).
# Claude Code runs with --setting-sources user, so it does not load these files itself.
# Print paths only: hook output is capped at 10,000 characters.

cwd=$(jq -r '.cwd // empty' 2>/dev/null)
[ -n "$cwd" ] || cwd=$PWD
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || root=$cwd

found=""
for f in CLAUDE.md AGENTS.md CLAUDE.local.md; do
  [ -f "$root/$f" ] || continue
  found="${found}- $root/$f ($(wc -l < "$root/$f" | tr -d ' ') lines)
"
done
[ -n "$found" ] || exit 0

echo "Repo context files at the repo root (not auto-loaded, see 'Repo context files' in ~/.claude/instructions/repo-context.md):"
printf '%s' "$found"
