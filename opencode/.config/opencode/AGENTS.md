# MCP Tool Usage

## File Search & Content Grep

For file search and content grep, prefer **fff** tools (`grep`, `find_files`, `multi_grep`) over serena's `search_for_pattern`.

- fff is faster and returns frecency-ranked results (frequent/recent files first, git-dirty files boosted)
- fff supports constraints: `*.rs`, `src/`, `!test/`, `git:modified`
- Use `multi_grep` for OR logic across multiple patterns instead of sequential greps

## Code Navigation & Symbols

Use **serena** for symbol-level operations:

- `find_symbol` — find classes, methods, functions by name
- `find_referencing_symbols` — find where symbols are used
- `get_symbols_overview` — understand file structure
- `replace_symbol_body` / `insert_after_symbol` — precise code editing
- `rename_symbol` — rename across entire codebase
