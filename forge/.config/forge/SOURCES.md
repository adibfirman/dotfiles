# SOURCES (forge default)

Agents run in bypass mode: every tool, shell command, and MCP server they have
runs, except what is denied. The role prompt says what each agent should use.
`forge spawn` denies, for each agent:

1. the deny floor (`deny-floor.json`), minus the rules this repo lifted for the
   phase ("Lift for this repo"; never the `NEVER_LIFT` rules);
2. the repo's own scripts whose names reach outside (deploy, prod, publish,
   migrate, ...): package.json scripts, `script/` and `scripts/` files, and
   Makefile targets;
3. the `- deny:` entries below, then those of `<main>/.forge/SOURCES.md`.

Every agent loads every MCP server in `~/.claude/mcp-servers.json` and every
claude.ai connector. The floor denies the write tools of Slack and Atlassian by
name (their read tools run) and all of Gmail and Google Calendar.

Format:

- `## <sections>`: phases (`grill`, `verify`, `exec`), `all` (every agent),
  `coordinator` (the `*-coord` roles and `classifier`), or a role name such as
  `gate-review`. Text in parentheses is a comment.
- `- deny: a, b`: a command prefix (`kubectl delete` denies
  `kubectl delete pod x`), a tool rule (`WebFetch`, `Edit(path)`,
  `mcp__server`), or a claude.ai connector by name (`claude.ai Sentry`).
- `- !deny: a` removes `a` that an earlier layer added.
- `- read: path`, `- write: path`: folders outside the worktree, passed as
  `--add-dir`.
- The old allow keys (`tools`, `bash`, `mcp`) are ignored.

## all (one shared worktree: never switch its branch or stash other agents' work)
- deny: git checkout, git switch, git stash

## all (a PR is the user's: only exec-coord edits the open PR of its branch, at cycle end)
- deny: gh pr edit

## exec-coord
- !deny: gh pr edit

## grill, verify, coordinator, planner, gate-beh, gate-spec, gate-sec, gate-review (read only: they report, units change code)
- deny: git add, git commit, git mv, git rm, git merge, git cherry-pick, git revert, git reset, git tag

## grill
- read: ~/.claude/plans
