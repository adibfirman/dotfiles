# SOURCES (forge default)

What each forge agent may use. `forge spawn` reads this file, then a toolchain
preset from the repo (package.json scripts, go.mod), then the optional project
file `<main>/.forge/SOURCES.md`. The deny floor (`deny-floor.json`) always wins.

Format:

- `## <sections>`: phases (`grill`, `verify`, `exec`), `all` (every agent),
  `coordinator` (the `*-coord` roles and `classifier`), or a role name such as
  `gate-review`. Role sections come last, so they can remove what a phase
  section added. Text in parentheses is a comment.
- `- <key>: a, b`: keys are `tools`, `bash`, `mcp`, `read`, `write`.
- `- !<key>: a` removes `a` that an earlier layer added.
- `bash` entries are command prefixes: `git log` allows `git log -n 5`.
- MCP tools go in parentheses with spaces: `- mcp: sentry(search_issues get_issue_details)`.
  A bare name allows every tool of that server. Server definitions come from
  `~/.claude/mcp-servers.json`.
- `read` and `write` paths outside the worktree become `--add-dir`.
- Every agent can read the run folder and write its own output folder (the
  phase folder; the cycle folder for coordinators) without a line here. A role
  with no `Edit` or `Write` in `tools` can write nothing else.

## all
- tools: Read, Grep, Glob
- bash: hc send, git status, git diff, git log, git show, git blame

## coordinator (grill-coord, grill-me-coord, verify-coord, exec-coord, classifier: they delegate, never change code)
- bash: forge append, forge spawn, forge status, forge coord, forge reconcile, forge followup, forge repo, forge refs list, forge allowed, forge history
- bash: hc read, hc wait, hc get, hc ls, hc interrupt
- !tools: Edit, Write
- !bash: git add, git commit, git mv, git rm

## grill (read only)
- tools: WebFetch, WebSearch
- bash: gh pr view, gh pr diff, gh issue view, gh run view, gh repo view
- mcp: context7, fff
- read: ~/.claude/plans

## verify
- bash: forge tlc

## exec (write)
- tools: Edit, Write
- bash: git add, git commit, git mv, git rm
- mcp: context7, fff

## gate-beh, gate-spec, gate-sec, gate-review (read only: they report, units fix)
- !tools: Edit, Write
- !bash: git add, git commit, git mv, git rm

## planner (plans, does not change code)
- !tools: Edit, Write
- !bash: git add, git commit, git mv, git rm
