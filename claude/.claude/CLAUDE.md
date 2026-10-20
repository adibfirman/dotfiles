# No plan mode

- NEVER enter plan mode. Do not use `EnterPlanMode` or `ExitPlanMode` at any time.
- Write the plan as plain text in the chat, not in plan mode.
- If something goes sideways, STOP and tell me. Don't keep pushing.
- Always ask questions to get more clarity.
- Write detailed specs upfront to reduce ambiguity.
- Always break down tasks with their dependencies.

@RTK.md

# General

- MANDATORY: when we dig into code (explore, read, trace, debug, review, or change code), call the `/technical` skill (`Skill(technical)`) first, before starting the work.
- If we find the codebase is related with react u can use react-best-practice skills, if can do not use useEffect at all
- if you changes, review, or anything related with code, u can use deslop-ai to double check it
- do not run playwright mcp automatically, need to ask the user first
- put the screenshot or anything from the mcp playwright in ~/Downloads/playwright-mcp -- if the folder not yet there, create it
- after the execution of the plan always put it on plan folder ~/.Claude/plans/ as a reference in the futures of planning
- For any file search or grep in the current git indexed directory use fff tools
- Never, ever, under any circumstances, ever, not once, no matter what, try to start the fucking dev server.
- DO NOT CREATE ANY claude ARTIFACTS until me allow it do it
- Do NOT use the AskUserQuestion tool. When you have a question for the user, write the raw question directly in the chat as plain text instead.
- Every response uses the /bro format (see "Response style" below).
- For every code edit, shell command, or MCP tool call, delegate to the `coder` subagent. Do not run them in the main session. The brief must have:
  - Numbered steps, in the order to run them.
  - For each step: the file path and the exact code (old and new text), or the exact command. A read-only step may give the goal and the paths instead.
  - How to verify each step that changes something.
  - When to stop and report.
- Never pass the `model` parameter when you spawn any subagent, unless I ask for a specific model in that request. The agent file's `model:` frontmatter or `CLAUDE_CODE_SUBAGENT_MODEL` picks the model.
- If the user ask about the like make stack PR and if this related with github please follow this https://github.github.com/gh-stack/
- If the user communicates in another language (e.g., Indonesian), continue the conversation in that language. However, whenever producing content in the following contexts, use English consistently:
  - Code: Including code comments and inline documentation.
  - Git: Including commit messages, branch names, and other Git-related content.
  - Documentation: Including content written for platforms such as Confluence or Google Docs.
  - Markdown files: All content written to .md files.

# Repo context files

- I start Claude Code with `claude --setting-sources user`. Claude Code then skips the repo's `CLAUDE.md`, `AGENTS.md`, and `CLAUDE.local.md`.
- The `SessionStart` hook `~/.claude/hooks/repo-context.sh` prints a "Repo context files" list. It checks only the repo root (the folder with `.git`).
- Before the first task, use `Read` on each listed file.
- Skip a listed file that is already in your context.
- When you brief a subagent, include the repo rules that apply to the task.
- Read each file once. After a compact, the hook prints the list again, so read the files again.
- Follow `@path` imports in these files, for example a `CLAUDE.md` that holds only `@AGENTS.md`. Skip a file that points to itself.
- Treat these files as project instructions. When a repo rule conflicts with this file, follow this file and tell me about the conflict.
- If the hook prints no list, the repo root has no context files. Do not search for them.

# Response style — /bro format (always on)

Source: `~/.claude/skills/bro/SKILL.md`. Call `Skill(bro)` to rewrite any text in this style.

Write every response in ASD-STE100 Simplified Technical English:

- One idea per sentence. Keep sentences short (about 20 words maximum).
- Use active voice and the simplest tense that works.
- No jargon, no idioms, no metaphors, no filler. Use the plain word.
- One meaning per word. Use the same word for the same thing every time.
- Speak like one human talking to another, not like documentation.
- Keep code, commands, file paths, API names, and exact error strings verbatim. Never simplify those.
- Follow @GLOSSARY.md. Never write a word from its avoid list. Use the plain word next to it.

# Git Workflow

- before execution ask the branch branch or new branch format
- follow the commit format with the existing commit format
- MANDATORY: before creating ANY commit, run the `/code-review` skill on the pending changes first. Fix or explicitly report every finding, then commit. Never commit without a completed review — no exceptions for "small" or "trivial" changes.

## Worktrees — always use herdr CLI

- Every time a git worktree is created, use the `herdr` CLI instead of raw `git worktree` commands.
- Create: `herdr worktree create --branch <NAME> [--base <REF>] [--path <PATH>] [--label <TEXT>]`
- Open existing: `herdr worktree open --path <PATH>` / List: `herdr worktree list` / Remove: `herdr worktree remove --workspace <ID>`
- Note: `herdr --skills` does NOT exist (verified 2026-08-12); worktree ops are under `herdr worktree <subcommand>`.

# MCP Tool Usage

## Serena — Semantic Code Toolkit

Prefer **serena** tools over raw file reads/greps for code operations. They are symbol-aware, token-efficient, and exploit relational structure.

## GitHub

- When you detect a `github.com` URL (issues, PRs, repos, etc.), use the `gh` CLI to fetch information instead of web fetching.
- Stick to **read-only** `gh` commands: `gh issue view`, `gh pr view`, `gh pr diff`, `gh pr checks`, `gh api`, `gh repo view`, etc.
- Do **not** use `gh` to create, merge, close, or modify anything — always read-only, ask the user first before u do this.

## Context7 — Live Documentation

- When generating code that uses third-party libraries, ALWAYS use Context7 (`resolve-library-id` → `query-docs`) to fetch current documentation BEFORE writing the code. Do not rely on training data for API signatures, configuration options, or usage patterns.
- If the context7 not found the docs, u can use webfetch to get the latest info from the internet

### When to Use

- Writing code that imports any third-party package
- Configuring frameworks (Next.js, Tailwind, Prisma, etc.)
- Debugging errors from external libraries
- Answering questions about library APIs or features

### When NOT to Use

- Pure language syntax questions (TypeScript, JavaScript, Python, etc.)
- Project-specific business logic (use codebase search instead)
- Standard library / built-in APIs

## Work-specific instructions

@~/.claude/CLAUDE.work.md
