---
name: design-thinking
description: Concept checklist to design a flow before code. Use when you write a spec or a plan, or review a design. Covers program flow and UI flow.
---

# Design thinking

Draw the flow as a graph first. Then write code that has the same shape as the graph. If the code and the graph do not match, one of them is wrong.

Each graph has three channels:

- **Success**: what flows on the happy path.
- **Failure**: every point where the flow can break, or where the content can be absent.
- **Needs**: what each node must have before it can run or show.

## Program flow

Nodes are functions. Edges are the data that moves between them.

1. **Name the shapes.** List the records, the IDs, the states, and the errors. An ID has its own type, not a bare string. An error has a name and context, not only a message.
2. **Draw the happy path.** Show the call graph of the success flow in the `call-graph` format.
3. **Mark one or many.** For each node, pick one: one value, many values over time (stream, events, pages), or a value that is valid for a time window (cache it).
4. **Mark the break points.** For each failure, pick one:
   - Retry: a short failure, for example a timeout or a rate limit.
   - Fallback: return another value, for example a cached value or a default.
   - Stop: a bug or a broken invariant. It is not a domain error.

   Each layer changes the errors from the layer below into its own errors. A caller never sees an error from three layers down.
5. **Mark the needs.** For each node, list what it must have, for example a DB connection, a config value, or a client. Pass them in. Do not let a node get them from a global.
6. **Check input at the boundary.** Data from outside is not trusted: HTTP, files, env vars, user input, third-party APIs. Check and convert it once, where it comes in. Inside the boundary, trust the types.
7. **Wrap behavior around the node.** Retry, timeout, logs, traces, and cache wrap a node. They do not change the happy path. You can read the happy path without them.
8. **Close what you open.** A node that opens a connection, a file, or a process closes it on success, on error, and on cancel.
9. **Test by swapping the needs.** The graph is the same in production and in tests. Only the needs change. If a test must fake many things to test one node, that node does too much.
10. **Keep the happy path apart from the failure handling.** The main body of a function reads as the happy path. The failure handling is in one place after it. Exception: two steps in one function need different failure handling. Handle each one inline, and mark it.

## UI flow

Nodes are surfaces. Edges are the moves a person makes between them.

1. **Name the surfaces.** List the surfaces (page, pane, drawer, list), the units in them (row, field, metric), the states of each unit (rest, hover, selected, disabled, stale), and the moves (open, select, close, submit, undo).
2. **Draw the happy flow.** Show the moves of a person who finishes the job. A surface that is not on the flow has no reason to exist. A node with one move in and one move out may not need its own screen.
3. **Mark one or many.** Pick one per surface: one record (detail), many records (list), or live values. A list works with 0, 1, and 10,000 rows. A live value shows its time. A row does not move under the cursor.
4. **Design every absent state.** For each surface, design:
   - Empty: one short sentence that says what will show here.
   - Loading: a skeleton in the shape of the content.
   - Partial: show what arrived, and mark what is missing.
   - Error: say what failed, in the person's words, next to the part that failed.
   - Denied: do not route the person here. If you must, say why.
5. **Mark the needs.** For each surface, list what it must have: a selected record, a permission, a done prior step, or a minimum screen width. If a person can reach a surface without its needs, the flow has a bug. Do not show a control the person cannot use. Use a disabled control only as a last option.
6. **Check input at the field.** Check each field when the person uses it, not only at submit. One field definition gives the label, the rule, and the error text.
7. **Wrap behavior around the surface.** Motion, focus rings, and feedback wrap a surface. If you remove them and the person learns less from the screen, the layout is incomplete.
8. **Give focus back.** A modal, a drawer, a menu, or a toast takes focus. It gives focus back to where it came from on confirm, cancel, Escape, or interrupt. It has one clear move to close it.
9. **Test with four accounts.** Walk the flow again with each one:
   - A new account with no data.
   - An account with 40,000 records and long titles.
   - A read-only user.
   - A small screen, a slow network, and reduced motion.
10. **Keep the content apart from the states.** The component tree shows the happy flow. The state styles list every state from step 4. Do not mix state branches into the tree.

## Credits

Based on the "Design Thinking" and "Design Graph" notes by [@r17x](https://github.com/r17x) in [this gist](https://gist.github.com/r17x/90eb2f7be93932b5693753aedb09c01a). Rewritten in plain language, without the language and library details. The `Why:` line and the report check in `workflow.md` come from the "Graph Protocol" note in the same gist.
