---
name: js-ts-fp
description: Write TypeScript and JavaScript code like a top engineer using functional programming principles. Use when writing new code, reviewing existing code, or refactoring TS/JS projects. Applies pure functions, immutability, function composition, higher-order functions, declarative style, and avoiding shared state using native patterns only (no external libraries). Always analyzes the existing codebase first to understand patterns and conventions before making changes or suggestions.
---

# Functional Programming Engineering Skill

Write and review code using functional programming principles like a top engineer.

## Workflow

### Step 1: Analyze the Codebase

Before writing or reviewing any code, examine the repository:

1. **Confirm TypeScript or JavaScript**: Check for `.ts`, `.tsx`, `.js`, `.jsx` files and `package.json`
2. **Find existing patterns**: Look at 2-3 representative files to understand current conventions
3. **Check tsconfig.json**: Note strict mode, module system, and target ES version

### Step 2: Apply FP Principles

Apply these principles (all natively supported in TS/JS):

| Principle              | Description                               |
| ---------------------- | ----------------------------------------- |
| Pure functions         | No side effects, same input → same output |
| Immutability           | Never mutate, always return new values    |
| Declarative style      | Describe what, not how                    |
| Function composition   | Build complex from simple functions       |
| Higher-order functions | Functions that take/return functions      |
| Avoid shared state     | No globals, no mutation of external state |
| Discriminated unions   | TypeScript pattern matching alternative   |

### Step 3: Execute Task

**Writing new code:**

- Follow existing repo conventions for file structure and naming
- Use FP patterns consistent with what's already in the codebase
- If no FP patterns exist, introduce them gradually and idiomatically

**Reviewing code:**

- Identify imperative patterns that could be functional
- Flag mutation, side effects, shared state
- Suggest specific refactors with before/after examples

**Refactoring:**

- Preserve behavior while improving structure
- Transform loops → map/filter/reduce
- Extract pure functions from impure ones
- Isolate side effects to boundaries

## Core FP Transformations

### Imperative → Declarative

```
// Before: imperative loop
let results = [];
for (let i = 0; i < items.length; i++) {
  if (items[i].active) {
    results.push(transform(items[i]));
  }
}

// After: declarative
const results = items
  .filter(item => item.active)
  .map(transform);
```

### Mutation → Immutability

```
// Before: mutation
function addItem(cart, item) {
  cart.items.push(item);
  cart.total += item.price;
  return cart;
}

// After: immutable
function addItem(cart, item) {
  return {
    ...cart,
    items: [...cart.items, item],
    total: cart.total + item.price
  };
}
```

### Shared State → Pure Functions

```
// Before: shared state
let counter = 0;
function increment() {
  counter++;
  return counter;
}

// After: pure
function increment(counter) {
  return counter + 1;
}
```

### Nested Logic → Composition

```
// Before: nested
function process(data) {
  const validated = validate(data);
  if (validated) {
    const transformed = transform(validated);
    return format(transformed);
  }
  return null;
}

// After: composed (with pipe/flow)
const process = pipe(
  validate,
  transform,
  format
);
```

## Detailed Patterns Reference

For comprehensive patterns including Option/Result types, composition helpers, currying, and TypeScript-specific techniques, see [references/patterns.md](references/patterns.md).

## Code Review Checklist

When reviewing, check for:

- [ ] Functions return values (not void/undefined for logic)
- [ ] No mutation of input parameters
- [ ] Side effects isolated and clearly marked
- [ ] Loops replaced with map/filter/reduce where clearer
- [ ] Conditionals use early returns or ternaries for simple cases
- [ ] Complex conditionals extracted to named predicates
- [ ] State transformations are pure
- [ ] Error handling uses Result/Either/Option patterns when available

## Anti-Patterns to Flag

| Anti-Pattern             | Refactor To                       |
| ------------------------ | --------------------------------- |
| `for` loop with push     | `map`/`filter`/`reduce`           |
| `let` with reassignment  | `const` with transformation       |
| Nested callbacks         | Composition or async/await        |
| `null` checks everywhere | Option/Maybe type                 |
| `try/catch` everywhere   | Result/Either type                |
| Class with mutable state | Pure functions + data             |
| Global variables         | Dependency injection              |
| `if/else` chains         | Pattern matching or lookup tables |

## When NOT to Apply FP

- Performance-critical hot paths where mutation is measurably faster
- When the team/codebase has no FP experience (introduce gradually)
- Simple scripts where FP adds complexity without benefit
- When existing patterns in the repo are intentionally imperative
- Legacy codebases where consistency matters more than FP purity
