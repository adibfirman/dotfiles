# SOURCES (forge default)

What each forge agent may use. `forge spawn` reads this file, then a toolchain
preset from the repo (package.json scripts, go.mod), then the optional project
file `<main>/.forge/SOURCES.md`. The deny floor (`deny-floor.json`) always wins.

Format:

- `## <sections>`: phases (`grill`, `verify`, `exec`), `all` (every agent), or
  `coordinator` (the `*-coord` roles). Text in parentheses is a comment.
- `- <key>: a, b`: keys are `tools`, `bash`, `mcp`, `read`, `write`.
- `- !<key>: a` removes `a` that an earlier layer added.
- `bash` entries are command prefixes: `git log` allows `git log -n 5`.
- MCP tools go in parentheses with spaces: `- mcp: sentry(search_issues get_issue_details)`.
  A bare name allows every tool of that server. Server definitions come from
  `~/.claude/mcp-servers.json`.
- `read` and `write` paths outside the worktree become `--add-dir`. Each agent
  can always write its own phase folder and read the run folder.

## all
- tools: Read, Grep, Glob
- bash: hc send, git status, git diff, git log, git show, git blame

## coordinator (grill-coord, verify-coord, exec-coord)
- tools: Write
- bash: forge append, forge spawn, forge status, hc read, hc wait, hc get, hc ls, hc interrupt

## grill (read only)
- tools: Write, WebFetch, WebSearch
- bash: gh pr view, gh pr diff, gh issue view, gh run view, gh repo view
- mcp: context7, fff
- read: ~/.claude/plans

## verify
- tools: Write, Edit
- bash: forge tlc

## exec (write)
- tools: Edit, Write
- bash: git add, git commit, git mv, git rm
- mcp: context7, fff
