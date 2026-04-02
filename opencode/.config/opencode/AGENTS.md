## Plan mode default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions).
- If something goes sideways, STOP and re-plan immediately. Don't keep pushing.
- Use plan mode for verification steps, not just building.
- Always asking questions to get more clarity
- Write detailed specs upfront to reduce ambiguity
- Always breakdown tasks with its dependencies

## General

- If we find the codebase is related with react u can use react-best-practice skills, if can do not use useEffect at all
- if you changes, review, or anything related with code, u can use deslop-ai to double check it
- put the screenshot or anything from the playwright-mcp in ~/Downloads/playwright-mcp -- if the folder not yet there, create it
- after the execution of the plan always check to update or put it as a new (if it's not exists) on root repo with pattern "memory" or "plan" as a reference in the futures of planning

## Git Workflow

- before execution ask the branch branch or new branch format
- follow the commit format with the existing commit format

# MCP Tool Usage

## Serena — Semantic Code Toolkit

Prefer **serena** tools over raw file reads/greps for code operations. They are symbol-aware, token-efficient, and exploit relational structure.

### Project Lifecycle

- `check_onboarding_performed` — always call first when starting work on a project
- `onboarding` — run if onboarding hasn't been performed yet (discovers project structure, build/test commands)
- `activate_project` — switch between configured projects

### Code Navigation & Discovery

- `get_symbols_overview` — first tool to call on an unfamiliar file (classes, functions, variables at a glance)
- `find_symbol` — find classes, methods, functions by name path; use `depth` to get children, `include_body` to read source
- `find_referencing_symbols` — find where a symbol is used across the codebase
- `search_for_pattern` — regex search across files (for non-symbol searches, config files, strings, comments)
- `list_dir` — list files/directories with optional recursion
- `find_file` — find files by name or wildcard mask
- `read_file` — read a file (use sparingly; prefer symbolic tools for code)

### Code Editing — Symbol Level (preferred)

- `replace_symbol_body` — replace an entire symbol definition (function, method, class)
- `insert_after_symbol` — insert new code after a symbol (e.g. add a method after another)
- `insert_before_symbol` — insert code before a symbol (e.g. add imports, decorators)
- `rename_symbol` — rename across the entire codebase via LSP refactoring

### Code Editing — Line Level (when symbol-level is too coarse)

- `replace_content` — find/replace in a file, optionally with regex
- `replace_lines` — replace a range of lines with new content
- `delete_lines` — delete a range of lines
- `insert_at_line` — insert content at a specific line number
- `create_text_file` — create or overwrite a file

### Memory (persistent knowledge across conversations)

- `list_memories` — see what's been remembered
- `read_memory` — retrieve a memory by name
- `write_memory` — save useful project knowledge for future sessions
- `edit_memory` — update an existing memory
- `delete_memory` — remove a memory

### Thinking Tools (structured self-reflection)

- `think_about_collected_information` — have I gathered enough context?
- `think_about_task_adherence` — am I still on track with the task?
- `think_about_whether_you_are_done` — is the task truly complete?

### Other

- `summarize_changes` — summarize what was changed in the codebase
- `prepare_for_new_conversation` — prepare context handoff for a new session
- `restart_language_server` — restart LSP if external edits cause stale state

## GitHub

- When you detect a `github.com` URL (issues, PRs, repos, etc.), use the `gh` CLI to fetch information instead of web fetching.
- Stick to **read-only** `gh` commands: `gh issue view`, `gh pr view`, `gh pr diff`, `gh pr checks`, `gh api`, `gh repo view`, etc.
- Do **not** use `gh` to create, merge, close, or modify anything — always read-only.

## Context7 — Live Documentation

When generating code that uses third-party libraries, ALWAYS use Context7
(`resolve-library-id` → `query-docs`) to fetch current documentation BEFORE
writing the code. Do not rely on training data for API signatures, configuration
options, or usage patterns. Use skills context7

### When to Use

- Writing code that imports any third-party package
- Configuring frameworks (Next.js, Tailwind, Prisma, etc.)
- Debugging errors from external libraries
- Answering questions about library APIs or features

### When NOT to Use

- Pure language syntax questions (TypeScript, JavaScript, Python, etc.)
- Project-specific business logic (use codebase search instead)
- Standard library / built-in APIs
