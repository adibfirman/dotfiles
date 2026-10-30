# Git Workflow

- Before you start work, ask me: use the current branch, or create a new branch. For a new branch, ask for its name.
- Write commit messages in the same format as the recent commits in the repo.
- MANDATORY: before creating ANY commit, run the `/code-review` skill on the pending changes first. Fix or explicitly report every finding, then commit. Never commit without a completed review — no exceptions for "small" or "trivial" changes.
- When I ask for stacked PRs on GitHub, follow https://github.github.com/gh-stack/.

## Worktrees — always use herdr CLI

- Every time a git worktree is created, use the `herdr` CLI instead of raw `git worktree` commands.
- Create: `herdr worktree create --branch <NAME> [--base <REF>] [--path <PATH>] [--label <TEXT>]`
- Open existing: `herdr worktree open --path <PATH>` / List: `herdr worktree list` / Remove: `herdr worktree remove --workspace <ID>`
- Note: `herdr --skills` does NOT exist (verified 2026-08-12); worktree ops are under `herdr worktree <subcommand>`.
- Pass `--cwd <main checkout path>` (or `--workspace <ID>`) to `herdr worktree list/create/open`; without it herdr fails with `not_git_worktree` (verified 2026-10-23).
