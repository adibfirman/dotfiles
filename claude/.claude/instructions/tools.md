# Skills and tools

## General

- MANDATORY: when we dig into code (explore, read, trace, debug, review, or change code), call the `/technical` skill (`Skill(technical)`) first, before starting the work.
- Do not run the Playwright MCP on your own. Ask me first.
- Save screenshots and other files from the Playwright MCP in `~/Downloads/playwright-mcp`. Create the folder if it does not exist.
- For code search or go to definition, delegate to the `coder` subagent. It uses the fff tools.

## MCP Tool Usage

### GitHub

- When you detect a `github.com` URL (issues, PRs, repos, etc.), use the `gh` CLI to fetch information instead of web fetching.
- By default, use only **read-only** `gh` commands: `gh issue view`, `gh pr view`, `gh pr diff`, `gh pr checks`, `gh api`, `gh repo view`, etc.
- Before any `gh` command that creates, merges, closes, or changes something, ask me and wait for my yes.
- Exception: `gh pr edit` for a PR body is a Level 2 cheap action. See "Cheap actions" in `workflow.md`.

### Grafana

- When I name Grafana or paste a Grafana URL, use the `gcx` CLI. Do not use the browser, Playwright, or WebFetch.
- `gcx` is read-only for you. A `gcx` read command is a Level 1 cheap action. See "Cheap actions" in `workflow.md`.
- A read does not change Grafana. Examples: `list`, `get`, `query`, `search`, `status`, `snapshot`, `pull`, `export`, and `gcx api` with GET.
- A write is every other call. Examples: `create`, `update`, `delete`, `upsert`, `push`, `apply`, `acknowledge`, `silence`, `resolve`, and `gcx api` with `-X` other than GET or with `-d`. These are writes too: `gcx login`, `gcx config set`, `gcx config use-context`, `gcx assistant`, and `gcx agent skills install`.
- Never run a write, not even after I say yes. When a task needs a write, stop. Show me the exact command and the reason. I run it myself with `! <command>`.
- Never pass `--insecure-log-http-payload`. It prints tokens into the chat.
- Save files from `snapshot`, `pull`, and `export` in the scratchpad folder.
- The hook `~/.claude/hooks/gcx-guard.sh` blocks every write and every unknown command. When it blocks a call, stop and tell me. Do not try another way, for example `curl` to the Grafana API.
- Do not call `gcx` from a script file or from another program, for example `python3 -c`. Run each `gcx` command directly.
- When the hook blocks a read command that is not in `gcx-commands.txt`, tell me to run `~/.claude/hooks/gcx-commands-gen.sh`.
- When `gcx` says it has no context, or returns 401 or 403, stop and ask me to run `! gcx login --token`.

### Context7 — Live Documentation

- When generating code that uses third-party libraries, ALWAYS use Context7 (`resolve-library-id` → `query-docs`) to fetch current documentation BEFORE writing the code. Do not rely on training data for API signatures, configuration options, or usage patterns.
- If Context7 has no docs for the library, use WebFetch to get the current docs from the internet.

#### When to Use

- Writing code that imports any third-party package
- Configuring frameworks (Next.js, Tailwind, Prisma, etc.)
- Debugging errors from external libraries
- Answering questions about library APIs or features

#### When NOT to Use

- Pure language syntax questions (TypeScript, JavaScript, Python, etc.)
- Project-specific business logic (use codebase search instead)
- Standard library / built-in APIs
