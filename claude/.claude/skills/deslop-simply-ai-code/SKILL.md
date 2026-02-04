---
name: deslop-simplify-ai-code
description: Remove LLM-generated code patterns that add noise without value. Use when reviewing diffs, PRs, or branches to clean up AI-generated code. Triggers include requests to "remove slop", "clean up AI code", "review for AI patterns", or checking diffs against main for unnecessary verbosity, redundant checks, or over-engineering introduced by LLMs. Language-agnostic.
---

# Deslop: Simplify AI Code

Expert code simplification focused on clarity, consistency, and maintainability while preserving exact functionality. Analyze code for unnecessary complexity, redundant patterns, and opportunities to make code more readable and idiomatic. Apply project-specific best practices—match existing code style, naming conventions, and patterns already established in the codebase.

## Workflow

1. **Understand project context**: Review existing code style, patterns, and conventions in the codebase
2. **Get the diff**: `git diff main...HEAD` or `git diff main`
3. **Identify slop patterns** in changed lines
4. **Simplify**: Remove or refactor each instance to match project idioms
5. **Verify**: Ensure functionality unchanged, code aligns with existing style

## Slop Patterns

### Comments

**Rule: Comments explain WHY, not WHAT.**

Remove:

- Comments restating what code does: `// increment counter` above `counter++`
- Section dividers: `// ========== VALIDATION ==========`
- Redundant docstrings documenting self-evident parameters
- "Note:" or "Important:" prefixes that add nothing
- Comments explaining language basics

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

### Abstractions

Flatten unnecessary layers:

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

### Naming

Fix over-descriptive names:

- `userDataResponseObject` → `user`
- `isCurrentlyProcessingData` → `processing`
- `handleOnClickButtonEvent` → `onClick`

### Structure

Remove:

- Empty constructors
- Getters/setters that just proxy fields
- Interfaces implemented by one class
- Abstract classes with one child
- Enums with one value

### Logs/Debug

Remove:

- Debug print/log statements
- Verbose entry/exit logging: `Entering function X with params...`
- Success logs that spam output: `Successfully processed item 1 of 10000`

Keep: error logging with context, audit logs for important operations.

## Review Checklist

For each changed file, ask:

1. Does this comment explain WHY, not WHAT?
2. Is this null check protecting against something that can actually happen?
3. Does this abstraction earn its complexity?
4. Could this be expressed more directly?
5. Is this name proportional to the scope?
6. Does this match existing patterns in the codebase?
7. Would a maintainer find this clearer or more confusing?

## Guiding Principles

- **Preserve behavior**: Never change what the code does, only how it's expressed
- **Match the codebase**: New code should look like it belongs—follow existing conventions
- **Simplify, don't clever**: Prefer obvious solutions over clever ones
- **Earn complexity**: Every abstraction, check, or layer must justify its existence
- **Readable > short**: Clarity beats brevity when they conflict

## Edge Cases

Don't remove:

- Defensive checks at API boundaries (external input)
- Comments required by linters or documentation generators
- Abstractions that enable testing or future extension (if justified)
- Explicit type annotations in ambiguous contexts
