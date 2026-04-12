---
name: deslop-simplify-ai-code
description: >
  Remove code patterns that add noise without value. Use when reviewing diffs,
  PRs, or branches to clean up over-engineered or unnecessarily verbose code.
  Triggers include "remove slop", "clean up code", "review for bloat",
  "simplify this", or checking diffs for unnecessary verbosity, redundant
  checks, or over-engineering. Language-agnostic.
---

# Deslop: Simplify Code

Expert code simplification focused on clarity, consistency, and maintainability
while preserving exact functionality. Analyze code for unnecessary complexity,
redundant patterns, and opportunities to make code more readable and idiomatic.
Match existing code style, naming conventions, and patterns in the codebase.

## Workflow

1. **Understand project context**: Review existing code style, patterns, and
   conventions in the codebase
2. **Get the code to review**: via `git diff`, PR review, file selection, or
   paste — don't assume branch naming or tooling
3. **Identify slop patterns** across the entire file if it's been touched
4. **Simplify**: Remove or refactor each instance to match project idioms
5. **Verify**: Run tests if available. If not, review the diff carefully and
   manually verify behavior. For frontend code, visually verify UI still
   renders correctly. Provide a summary report of what changed and why.

## Slop Patterns

### Comments

**Rule: Prefer WHY over WHAT.**

Remove:

- Comments restating what code does: `// increment counter` above `counter++`
- Section dividers: `// ========== VALIDATION ==========`
- Redundant docstrings documenting self-evident parameters
- "Note:" or "Important:" prefixes that add nothing
- Comments explaining language basics

**Carve-out: WHAT comments are acceptable for:**

- Complex regex patterns
- Non-obvious bit manipulation
- Mathematical formulas where the code IS the implementation
- Cases where the logic genuinely can't be simplified further

Transform WHAT → WHY:

```
# SLOP: describes what
# Check if user is active
if user.is_active:

# CLEAN: explains why
# Inactive users can't access billing portal
if user.is_active:
```

```
// SLOP: restates the code
// Loop through all items and process each one
for item in items:
    process(item)

// CLEAN: no comment needed, or explain why this approach
// Process sequentially - parallel causes rate limit errors
for item in items:
    process(item)
```

### Null/Error Handling

Remove redundant checks:

```
# SLOP: checking what's already guaranteed
if user is not None and user is not empty and is_valid_type(user):
    if user.name is not None and user.name is not empty:

# CLEAN: trust the type system or add one meaningful check
if user and user.name:
```

Simplify excessive try-catch:

```
# SLOP: catch-log-rethrow adds nothing
try:
    do_thing()
catch error:
    log("Error doing thing:", error)
    throw error

# CLEAN: let it propagate or handle meaningfully
do_thing()
```

Also watch for:

- **Swallowed errors**: `try { ... } catch { }` — at minimum log it, ideally
  handle or propagate
- **Generic error messages**: `catch (e) { throw new Error("Something went wrong") }`
  — preserves no context; include the original error or relevant details
- **Error string parsing**: checking `error.message === "not found"` instead of
  using error types, codes, or structured error objects

### Abstractions

Flatten unnecessary layers — but **match the codebase's testing patterns**:

- In Python/JS/TS: prefer direct calls; use monkey-patching or test fixtures
  for mocking
- In Java/C#: interfaces and wrapper classes are idiomatic for testability via
  DI — keep if they serve that purpose
- In Go: keep if it implements an interface for testing; flatten otherwise

General rule: remove abstractions that do nothing AND aren't required by the
language/framework. Keep if there are 2+ callers or a test that depends on it.

Watch for:

- Single-use helper functions that obscure rather than clarify
- Wrapper classes around simple operations
- "Manager", "Handler", "Service" suffixes on thin wrappers
- Config objects for 1-2 values

### Verbosity

```
# SLOP
is_user_valid = user.is_active == true
if is_user_valid == true:
    return true
else:
    return false

# CLEAN
return user.is_active
```

Common patterns:

- `== true` / `== false` comparisons
- Intermediate variables used once
- `if x: return true; else: return false` → `return x`
- Unnecessary destructuring then reassembly
- Unused imports, wildcard imports (`import *`), importing entire libraries
  for one function

### Naming

Fix over-descriptive names:

- `userDataResponseObject` → `user`
- `isCurrentlyProcessingData` → `processing`
- `handleOnClickButtonEvent` → `onClick`

### Structure

Remove:

- Constructors that do nothing AND aren't required by the language/framework
- Getters/setters that just proxy fields
- Interfaces implemented by one class
- Abstract classes with one child
- Enums with one value

### Logs/Debug

Remove:

- Bare `print()` / `console.log()` / `System.out.println()` debug statements
- Verbose entry/exit logging: `Entering function X with params...`
- Success logs that spam output: `Successfully processed item 1 of 10000`

Keep:

- Structured logging with levels (`logger.debug(...)`) — these are controlled
  by log level config and useful for ops/debugging
- Error logging with context
- Audit logs for important operations

## Review Checklist

### Must Fix

1. Does this comment explain WHY, not WHAT? (with carve-outs for complex logic)
2. Is this null check protecting against something that can actually happen?
3. Could this be expressed more directly?

### Should Fix

4. Does this abstraction earn its complexity? (consider language context)
5. Is this name proportional to the scope?

### Nice to Have

6. Does this match existing patterns in the codebase?
7. Would a maintainer find this clearer or more confusing?

## Guiding Principles

- **Preserve behavior**: Never change what the code does, only how it's expressed
- **Match the codebase**: New code should look like it belongs — follow existing
  conventions, including testing patterns
- **Simplify, don't clever**: Prefer obvious solutions over clever ones
- **Earn complexity**: Every abstraction, check, or layer must justify its existence
- **Readable > short**: Clarity beats brevity when they conflict

## Edge Cases

Don't remove:

- Defensive checks at API boundaries (external input)
- Comments required by linters or documentation generators
- Abstractions that enable testing or future extension (if there's a concrete
  existing use case — not hypothetical)
- Explicit type annotations in ambiguous contexts
- Structured debug-level logging (`logger.debug(...)`)
