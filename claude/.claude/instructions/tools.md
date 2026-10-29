# Skills and tools

## General

- MANDATORY: when we dig into code (explore, read, trace, debug, review, or change code), call the `/technical` skill (`Skill(technical)`) first, before starting the work.
- if you changes, review, or anything related with code, u can use deslop-ai to double check it
- do not run playwright mcp automatically, need to ask the user first
- put the screenshot or anything from the mcp playwright in ~/Downloads/playwright-mcp -- if the folder not yet there, create it
- For any file search or grep in the current git indexed directory use fff tools

## MCP Tool Usage

### Serena — Semantic Code Toolkit

Prefer **serena** tools over raw file reads/greps for code operations. They are symbol-aware, token-efficient, and exploit relational structure.

### GitHub

- When you detect a `github.com` URL (issues, PRs, repos, etc.), use the `gh` CLI to fetch information instead of web fetching.
- Stick to **read-only** `gh` commands: `gh issue view`, `gh pr view`, `gh pr diff`, `gh pr checks`, `gh api`, `gh repo view`, etc.
- Do **not** use `gh` to create, merge, close, or modify anything — always read-only, ask the user first before u do this.

### Context7 — Live Documentation

- When generating code that uses third-party libraries, ALWAYS use Context7 (`resolve-library-id` → `query-docs`) to fetch current documentation BEFORE writing the code. Do not rely on training data for API signatures, configuration options, or usage patterns.
- If the context7 not found the docs, u can use webfetch to get the latest info from the internet

#### When to Use

- Writing code that imports any third-party package
- Configuring frameworks (Next.js, Tailwind, Prisma, etc.)
- Debugging errors from external libraries
- Answering questions about library APIs or features

#### When NOT to Use

- Pure language syntax questions (TypeScript, JavaScript, Python, etc.)
- Project-specific business logic (use codebase search instead)
- Standard library / built-in APIs
