# Skills and tools

## General

- MANDATORY: when we dig into code (explore, read, trace, debug, review, or change code), call the `/technical` skill (`Skill(technical)`) first, before starting the work.
- Browser automation is Level 3. Do not run `playwright-cli` or the Claude in Chrome tools on your own. Ask me first, then run it through `coder`.
- Save screenshots and videos from `playwright-cli` in `~/Downloads/playwright-cli`. Create the folder if it does not exist. Snapshots stay in `.playwright-cli/` in the project folder.
- Browser: always `playwright-cli attach --extension=chrome` (my Chrome, through the Playwright MCP Bridge extension) or `playwright-cli open --browser=chrome`. Never run `playwright-cli install-browser`, and never `open` without `--browser`. The bundled Chromium lags behind Chrome stable and runs without a sandbox. The env var `PLAYWRIGHT_MCP_PROFILE_DIR_NAME` picks the Chrome profile. Its value is in `~/.zshrc_secrets`. Until the shell restarts, pass it inline before `attach`. After `attach`, run every command with `-s=chrome`.
- Claude in Chrome: use its tools only when I started the session with `claude --chrome`. Same Level 3 rule.
- For code search or go to definition, delegate to the `coder` subagent. It uses the fff tools.

### herdr-app terminals (`hc`)

- My agents run in herdr-app. Its CLI is `hc` (herdr-core), not `herdr`.
- A pane id like `t7` or `t1g` is an `hc` terminal address. Never look it up with `herdr pane`.
- Before the first `hc` call in a session, run `hc --skill` and follow that manual.
- `$HC_TERMINAL_ID` is your own address.
- Levels: `hc ls`, `hc get`, and `hc read` are Level 1. Run `hc send` and `hc keys` only when I ask to message a pane. `hc kill`, `hc rm`, and `hc run` are Level 3: ask first.

## MCP Tool Usage

### GitHub

- When you detect a `github.com` URL (issues, PRs, repos, etc.), use the `gh` CLI to fetch information instead of web fetching.
- By default, use only **read-only** `gh` commands: `gh issue view`, `gh pr view`, `gh pr diff`, `gh pr checks`, `gh api`, `gh repo view`, etc.
- Before any `gh` command that creates, merges, closes, or changes something, ask me and wait for my yes.
- Exception: `gh pr edit` for a PR body is a Level 2 cheap action. See "Cheap actions" in `workflow.md`.

### Grafana

- When I name Grafana or paste a Grafana URL, use the `gcx` CLI. Do not use the browser, `playwright-cli`, or WebFetch.
- A `gcx` read command is a Level 1 cheap action. See "Cheap actions" in `workflow.md`.
- Never pass `--insecure-log-http-payload`. It prints tokens into the chat.
- Save files from `snapshot`, `pull`, and `export` in the scratchpad folder.
- When `gcx` says it has no context, or returns 401, stop and ask me to run `! gcx login` and pick only the read capabilities.

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
