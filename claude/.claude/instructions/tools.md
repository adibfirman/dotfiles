# Skills and tools

## General

- MANDATORY: when we dig into code (explore, read, trace, debug, review, or change code), call the `/technical` skill (`Skill(technical)`) first, before starting the work.
- Do not run the Playwright MCP on your own. Ask me first.
- Save screenshots and other files from the Playwright MCP in `~/Downloads/playwright-mcp`. Create the folder if it does not exist.
- In a git repository, use the fff tools for every file search and grep.

## MCP Tool Usage

### Serena — Semantic Code Toolkit

Prefer the **serena** tools over raw file reads and greps for code work. They understand symbols, use fewer tokens, and follow the links between symbols.

### GitHub

- When you detect a `github.com` URL (issues, PRs, repos, etc.), use the `gh` CLI to fetch information instead of web fetching.
- By default, use only **read-only** `gh` commands: `gh issue view`, `gh pr view`, `gh pr diff`, `gh pr checks`, `gh api`, `gh repo view`, etc.
- Before any `gh` command that creates, merges, closes, or changes something, ask me and wait for my yes.

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
