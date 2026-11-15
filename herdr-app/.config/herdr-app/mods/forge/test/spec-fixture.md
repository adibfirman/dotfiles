# SPEC: Refunds for orders

## 1. Goal and out of scope

Goal: add a pure `refund` function to `src/order.ts`. It moves a paid order to a new `refunded` status and records when the refund happened. Add tests for it in `test/order.test.ts`.

Rules from the request (`context.md:8-11`):
- Only a paid order can be refunded.
- An order is refunded at most once.
- A refund is always the full paid amount. No partial refunds.

Out of scope (decide-r1-q5):
- No refund time window.
- No refund reason field.
- No payment-provider call.
- No events, no logs, no persistence.
- No refund amount field and no amount parameter.
- No change to `createOrder`, `pay`, or `cancel` behavior.

## 2. Terms

- **order**: a value of type `Order` (`src/order.ts:3-8`).
- **status**: the `status` field of an order. One of `pending`, `paid`, `cancelled`, `refunded` after this change.
- **paid order**: an order whose status is `paid`.
- **refunded order**: an order whose status is `refunded`.
- **refund**: the new function `refund(order, now)`. It also names the act of calling it successfully.
- **full paid amount**: `order.amount`. The order has no other amount field, and `pay` does not change `amount` (`src/order.ts:17`).
- **refundedAt**: the new optional `Date` field. It holds the `now` value passed to the refund.
- **now**: the second parameter of `refund`. It defaults to `new Date()`.

## 3. Decisions

| # | Decision | Tag | Source |
|---|----------|-----|--------|
| D1 | `OrderStatus` today is `"pending" \| "paid" \| "cancelled"`. | fact | `src/order.ts:1` |
| D2 | `Order` has `id`, `amount`, `status`, optional `paidAt`. | fact | `src/order.ts:3-8` |
| D3 | `pay` and `cancel` return a new object with a spread and throw `cannot <verb> order in status ${status}` on a wrong status. | fact | `src/order.ts:15-23` |
| D4 | `cancel` throws for any status other than `pending`, so it already rejects paid and refunded orders. | fact | `src/order.ts:21` |
| D5 | Tests use `bun:test` in one `describe("order")` block. `npm test` runs `bun test`. | fact | `test/order.test.ts:1-4`, `package.json:4` |
| D6 | No other code calls these functions. No persistence exists. | fact | ask-r1.md:12 (`git ls-files`) |
| D7 | Only paid orders can be refunded, at most once, always in full. Keep the current style. Add tests. Keep it small. | given | `context.md:8-13` |
| D8 | Add `"refunded"` to `OrderStatus`. `refund` moves `paid` to `refunded`. | agent-decision | decide-r1-q1: one status per state, like `pay`/`cancel`; "at most once" follows from the `paid` guard. |
| D9 | Add `refundedAt?: Date`, set from `now`. Keep `paidAt`. Store no refund amount. | agent-decision | decide-r1-q2: mirrors `pay`/`paidAt`; a refund amount could only equal `amount`. |
| D10 | On any status other than `paid`, throw `Error(\`cannot refund order in status ${order.status}\`)`. | agent-decision | decide-r1-q3: same style as `pay`/`cancel`; a no-op would hide a double refund. |
| D11 | Signature: `export function refund(order: Order, now = new Date()): Order`. No amount parameter. | agent-decision | decide-r1-q4: a partial refund cannot be expressed; matches `pay`. |
| D12 | Extras (window, reason, provider, events) are out of scope. | agent-decision | decide-r1-q5: request lists three rules and asks for a small change. |
| D13 | `refund` does not mutate its input. It keeps `id`, `amount`, and `paidAt` unchanged. | agent-decision | ask-r1 assumption; follows from the `{ ...order, ... }` style at `src/order.ts:17`. |

Agent decisions for the user to confirm: D8, D9, D10, D11, D12, D13.

## 4. Flows and states

System flow:

```ts
refund call
  → refund(order, now = new Date())  src/order.ts
    → guard: order.status !== "paid"
      → throw Error(`cannot refund order in status ${order.status}`)
        pending, cancelled, refunded all land here
    → return { ...order, status: "refunded", refundedAt: now }
      id, amount, paidAt carried over by the spread
      input order is not mutated
```

Order state machine (after this change):

```ts
Order status
  → pending
    created by createOrder(id, amount)  src/order.ts:10
    → paid        via pay(order, now)    sets paidAt
    → cancelled   via cancel(order)
  → paid
    → refunded    via refund(order, now) sets refundedAt
    pay, cancel throw
  → cancelled
    terminal: pay, cancel, refund throw
  → refunded
    terminal: pay, cancel, refund throw
```

Exec plan:

```ts
Exec plan
  → U1 code  src/order.ts
    add "refunded" to OrderStatus
    add refundedAt?: Date to Order
    add export function refund(order, now = new Date()): Order
  → U2 tests  test/order.test.ts
    import refund
    add refund tests from section 6
  → U3 verify
    run npm test (bun test); all tests pass
```

## 5. Invariants

1. `refund-only-from-paid`: a step into status `refunded` starts only from status `paid`. **PASS**: [result](../verify/models/refund-only-from-paid/result.md)
2. `refunded-at-most-once`: in any behavior, an order enters status `refunded` at most once. **PASS**: [result](../verify/models/refunded-at-most-once/result.md)
3. `refunded-terminal`: once an order has status `refunded`, no later step changes its status. **PASS**: [result](../verify/models/refunded-terminal/result.md)
4. `full-amount`: in every reachable state, `amount` equals the `amount` given to `createOrder`; `refund` never changes it. **PASS**: [result](../verify/models/full-amount/result.md)
5. `refundedAt-iff-refunded`: in every reachable state, `refundedAt` is set if and only if the status is `refunded`. **PASS**: [result](../verify/models/refundedat-iff-refunded/result.md)
6. `refunded-was-paid`: in every reachable state with status `refunded`, `paidAt` is set. **PASS**: [result](../verify/models/refunded-was-paid/result.md)
7. `invalid-refund-throws`: a `refund` call on an order whose status is not `paid` throws and returns no order. **PASS**: [result](../verify/models/invalid-refund-throws/result.md)
8. `no-mutation`: a `refund` call leaves its input order unchanged, whether it returns or throws. **PASS**: [result](../verify/models/no-mutation/result.md)

## 6. Acceptance tests

All in `test/order.test.ts`, run with `npm test` (`bun test`):

1. A paid order refunds: `refund(pay(createOrder("o1", 500)))` has status `refunded`.
2. `refundedAt` equals the `now` passed in: with a fixed `Date`, `refund(paid, now).refundedAt` is that `Date`.
3. Refund keeps `id`, `amount` (500), and `paidAt` unchanged.
4. A refunded order cannot be refunded again: `refund(refunded)` throws `cannot refund order in status refunded`.
5. A pending order cannot be refunded: throws `cannot refund order in status pending`.
6. A cancelled order cannot be refunded: throws `cannot refund order in status cancelled`.
7. A refunded order cannot be paid or cancelled: `pay(refunded)` and `cancel(refunded)` throw.
8. The input order is not mutated: after `refund(paid)`, `paid.status` is still `paid` and `paid.refundedAt` is `undefined`.
9. All four existing tests (`test/order.test.ts:5-20`) still pass unchanged.
10. TypeScript accepts the code: `refund` has no amount parameter, so `refund(order, 100)` with a number would be a type error (checked by review, not a runtime test).

## 7. Exec plan

| Unit | Files | Change |
|------|-------|--------|
| U1 | `src/order.ts` | Line 1: add `"refunded"` to `OrderStatus`. In `Order`: add `refundedAt?: Date`. After `cancel`: add `refund(order: Order, now = new Date()): Order` with guard `order.status !== "paid"` → throw, else return `{ ...order, status: "refunded", refundedAt: now }`. |
| U2 | `test/order.test.ts` | Import `refund`. Add tests 1-8 from section 6 inside the existing `describe("order")` block. |
| U3 | none | Run `npm test`. All tests pass. |

U2 depends on U1. U3 depends on U1 and U2.

## Verification

Each invariant has a TLA+ model checked by TLC. Each model also has a mutant with one guard removed, and TLC found a violation in every mutant. So no model is vacuous.

| # | Slug | Verdict | Mutation | Result |
|---|------|---------|----------|--------|
| 1 | refund-only-from-paid | PASS | caught | [result.md](../verify/models/refund-only-from-paid/result.md) |
| 2 | refunded-at-most-once | PASS | caught | [result.md](../verify/models/refunded-at-most-once/result.md) |
| 3 | refunded-terminal | PASS | caught | [result.md](../verify/models/refunded-terminal/result.md) |
| 4 | full-amount | PASS | caught | [result.md](../verify/models/full-amount/result.md) |
| 5 | refundedAt-iff-refunded | PASS | caught | [result.md](../verify/models/refundedat-iff-refunded/result.md) |
| 6 | refunded-was-paid | PASS | caught | [result.md](../verify/models/refunded-was-paid/result.md) |
| 7 | invalid-refund-throws | PASS | caught | [result.md](../verify/models/invalid-refund-throws/result.md) |
| 8 | no-mutation | PASS | caught | [result.md](../verify/models/no-mutation/result.md) |

Scope note: the models treat an order as one value that moves through states. `refund` is pure (D13). So a caller who keeps an old `paid` value can call `refund` on it again and get a second `refunded` value. Invariant 2 holds for each order value. It does not hold across old copies that a caller keeps. No caller exists today (D6), and nothing is persisted. If you want "at most once" enforced across copies, that needs a store, and that is out of scope (section 1).

## Agent decisions to confirm

- **D8**: Add `"refunded"` to `OrderStatus`. `refund` moves `paid` to `refunded`. Reason: one status per state, like `pay`/`cancel`. "At most once" follows from the `paid` guard (decide-r1-q1).
- **D9**: Add `refundedAt?: Date`, set from `now`. Keep `paidAt`. Store no refund amount. Reason: mirrors `pay`/`paidAt`. A refund amount could only equal `amount` (decide-r1-q2).
- **D10**: On any status other than `paid`, throw `Error(\`cannot refund order in status ${order.status}\`)`. Reason: same style as `pay`/`cancel`. A no-op would hide a double refund (decide-r1-q3).
- **D11**: Signature `export function refund(order: Order, now = new Date()): Order`, with no amount parameter. Reason: a partial refund cannot be expressed. It matches `pay` (decide-r1-q4).
- **D12**: Extras (window, reason, provider, events) are out of scope. Reason: the request lists three rules and asks for a small change (decide-r1-q5).
- **D13**: `refund` does not mutate its input. It keeps `id`, `amount`, and `paidAt` unchanged. Reason: follows from the `{ ...order, ... }` style at `src/order.ts:17` (ask-r1 assumption).
