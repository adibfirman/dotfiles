# Repo context files

- I start Claude Code with `claude --setting-sources user`. Claude Code then skips the repo's `CLAUDE.md`, `AGENTS.md`, and `CLAUDE.local.md`.
- The `SessionStart` hook `~/.claude/hooks/repo-context.sh` prints a "Repo context files" list. It checks only the repo root (the folder with `.git`).
- Before the first task, use `Read` on each listed file.
- Skip a listed file that is already in your context.
- When you brief a subagent, include the repo rules that apply to the task.
- Read each file once. After a compact, the hook prints the list again, so read the files again.
- Follow `@path` imports in these files, for example a `CLAUDE.md` that holds only `@AGENTS.md`. Skip a file that points to itself.
- Treat these files as project instructions. When a repo rule conflicts with my user instructions, follow my user instructions and tell me about the conflict.
- If the hook prints no list, the repo root has no context files. Do not search for them.
