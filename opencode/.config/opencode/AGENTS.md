# General

- If we find the codebase is related with react u can use react-best-practice skills, if can do not use useEffect at all
- if you changes, review, or anything related with code, u can use deslop-ai to double check it
- put the screenshot or anything from the playwright-mcp in ~/Downloads/playwright-mcp -- if the folder not yet there, create it
- after the execution of the plan always check to update or put it as a new (if it's not exists) on root repo with pattern "memory" or "plan" as a reference in the futures of planning
- For any file search or grep in the current git indexed directory use fff tools
- Never, ever, under any circumstances, ever, not once, no matter what, try to start the fucking dev server, it’s already fucking running.

# Git Workflow

- before execution ask the branch branch or new branch format
- follow the commit format with the existing commit format

# MCP Tool Usage

## Serena — Semantic Code Toolkit

Prefer **serena** tools over raw file reads/greps for code operations. They are symbol-aware, token-efficient, and exploit relational structure.

## GitHub

- When you detect a `github.com` URL (issues, PRs, repos, etc.), use the `gh` CLI to fetch information instead of web fetching.
- Stick to **read-only** `gh` commands: `gh issue view`, `gh pr view`, `gh pr diff`, `gh pr checks`, `gh api`, `gh repo view`, etc.
- Do **not** use `gh` to create, merge, close, or modify anything — always read-only.

## Context7 — Live Documentation

- When generating code that uses third-party libraries, ALWAYS use Context7 (`resolve-library-id` → `query-docs`) to fetch current documentation BEFORE writing the code. Do not rely on training data for API signatures, configuration options, or usage patterns. Use skills context7
- If the Context7 MCP cannot found it, use webfetch to get the latest info from the internet

### When to Use

- Writing code that imports any third-party package
- Configuring frameworks (Next.js, Tailwind, Prisma, etc.)
- Debugging errors from external libraries
- Answering questions about library APIs or features

### When NOT to Use

- Pure language syntax questions (TypeScript, JavaScript, Python, etc.)
- Project-specific business logic (use codebase search instead)
- Standard library / built-in APIs
