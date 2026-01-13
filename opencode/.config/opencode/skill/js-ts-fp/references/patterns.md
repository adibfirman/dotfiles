# TypeScript/JavaScript Functional Programming Patterns

## Core Patterns

### Composition (Native)

```typescript
// Simple compose function
const compose =
  <T>(...fns: Array<(arg: T) => T>) =>
  (x: T) =>
    fns.reduceRight((acc, fn) => fn(acc), x);

// Simple pipe function
const pipe =
  <T>(...fns: Array<(arg: T) => T>) =>
  (x: T) =>
    fns.reduce((acc, fn) => fn(acc), x);

// Usage
const process = pipe(validate, transform, serialize);
const result = process(rawData);
```

### Option Pattern (null handling)

```typescript
type Option<T> = { type: "some"; value: T } | { type: "none" };

const some = <T>(value: T): Option<T> => ({ type: "some", value });
const none: Option<never> = { type: "none" };

const map = <T, U>(opt: Option<T>, fn: (v: T) => U): Option<U> =>
  opt.type === "some" ? some(fn(opt.value)) : none;

const getOrElse = <T>(opt: Option<T>, fallback: T): T =>
  opt.type === "some" ? opt.value : fallback;

// Usage
const findUser = (id: string): Option<User> =>
  users.has(id) ? some(users.get(id)!) : none;

const userName = getOrElse(
  map(findUser("123"), (u) => u.name),
  "Anonymous",
);
```

### Result/Either Pattern (error handling)

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

const parseJson = (s: string): Result<unknown, Error> => {
  try {
    return ok(JSON.parse(s));
  } catch (e) {
    return err(e as Error);
  }
};

// Usage
const result = parseJson(input);
if (result.ok) {
  return { success: transform(result.value) };
} else {
  return { error: result.error.message };
}
```

### Async with Promises (functional style)

```typescript
const fetchUser = (id: string): Promise<Result<User, Error>> =>
  fetch(`/api/users/${id}`)
    .then((r) => r.json())
    .then(ok)
    .catch((e) => err(new Error(String(e))));

// Chain with .then
const getUserName = (id: string) =>
  fetchUser(id).then((result) => (result.ok ? result.value.name : "Unknown"));
```

## Array Operations

Prefer these over loops:

```typescript
// Transform
const names = users.map((u) => u.name);

// Filter
const active = users.filter((u) => u.isActive);

// Reduce
const total = items.reduce((sum, item) => sum + item.price, 0);

// Find
const admin = users.find((u) => u.role === "admin");

// Check
const hasAdmin = users.some((u) => u.role === "admin");
const allActive = users.every((u) => u.isActive);

// Chained
const result = users
  .filter((u) => u.isActive)
  .map((u) => u.name)
  .sort();
```

## Object Immutability

```typescript
// Spread for shallow updates
const updated = { ...user, name: "New Name" };

// Nested updates
const updated = {
  ...state,
  user: {
    ...state.user,
    settings: {
      ...state.user.settings,
      theme: "dark",
    },
  },
};

// With Ramda
import { assocPath } from "ramda";
const updated = assocPath(["user", "settings", "theme"], "dark", state);
```

## Currying and Partial Application

```typescript
// Manual currying
const add = (a: number) => (b: number) => a + b;
const add5 = add(5);

// Generic curry helper
const curry2 =
  <A, B, R>(fn: (a: A, b: B) => R) =>
  (a: A) =>
  (b: B) =>
    fn(a, b);

// Partial application
const partial =
  <A, B, R>(fn: (a: A, b: B) => R, a: A) =>
  (b: B) =>
    fn(a, b);

// Usage
const multiply = (a: number, b: number) => a * b;
const double = partial(multiply, 2);
```

## Point-Free Style

```typescript
// Named, not point-free
const getNames = (users: User[]) => users.map((u) => u.name);

// Point-free with helper
const prop =
  <T, K extends keyof T>(key: K) =>
  (obj: T) =>
    obj[key];
const getNames = (users: User[]) => users.map(prop("name"));
```

## TypeScript Specifics

### Readonly types

```typescript
type User = Readonly<{
  id: string;
  name: string;
  settings: Readonly<{
    theme: string;
  }>;
}>;

// Or use ReadonlyArray
type Users = ReadonlyArray<User>;
```

### Discriminated unions (pattern matching)

```typescript
type Result<T> =
  | { type: "success"; data: T }
  | { type: "error"; message: string };

const handle = <T>(result: Result<T>) => {
  switch (result.type) {
    case "success":
      return process(result.data);
    case "error":
      return logError(result.message);
  }
};
```
