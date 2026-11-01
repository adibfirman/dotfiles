---
name: call-graph
description: Trace and format call graphs, execution flows, and architecture paths. Use when project overviews, architecture summaries, or code explanations show component call hierarchy.
---

## Workflow

1. Trace the flow from actual entrypoints through source definitions. Follow foreground, background, event-driven, and test paths when they materially differ.
2. Select one node per meaningful responsibility handoff. The graph should answer who owns the next operation and what crosses that boundary.
3. Render a detailed graph by default. If the user asks for a simplified graph, preserve the same nodes and remove their explanation lines.
4. Finish with concise source anchors for the principal symbols. The graph is complete when every edge is source-grounded and every material handoff is represented.

## Granularity

- Use real application symbols for executable nodes.
- Use conceptual phrases only as section roots that name distinct paths.
- Put a symbol's responsibility, important inputs or outputs, owned state, and relevant invariants on indented detail lines.
- Mention important structures in the detail lines of the symbols that produce or consume them. Give a structure its own node only when its behavior is part of the flow.
- Collapse framework plumbing such as combinators, dependency injection mechanics, and generic collection operations unless those mechanics are the subject being explained.
- Split materially different production, background, event-driven, cache, failure, and test paths into named sections.

## Detailed Output

Use the detailed form by default:

```ts
Review.run(request)
  owns the complete review lifecycle
  → captureReviewSnapshot()
    produces ReviewSnapshot, the immutable source and patch inventory
    → planReviewUnits()
      groups changed paths into bounded semantic units
  → runReviewUnit() × reviewUnits
    returns structured local findings
  → adjudicateReview()
    produces the final repository-wide result
```

## Simplified Output

When the user asks for a simplified version, retain the detailed graph's sections, nodes, hierarchy, and branches while removing explanation lines:

```ts
Review.run(request)
  → captureReviewSnapshot()
    → planReviewUnits()
  → runReviewUnit() × reviewUnits
  → adjudicateReview()
```

## Change Output

Use this form when the graph reports changes, for example after an edit. Do not use it to trace existing code.

- Put one marker before each node that changed:
  - `[ADD]`: the node is new.
  - `[EDIT]`: the node exists and its content changed.
  - `[REMOVE]`: the node is gone.
  - `[MOVE]`: the node moved.
- Under each changed node, show a short before and after:
  - `[EDIT]`: a `before:` line and an `after:` line.
  - `[ADD]`: an `after:` line only.
  - `[REMOVE]`: a `before:` line only.
  - `[MOVE]`: a `from:` line and a `to:` line.
  - Keep each line at 120 characters or less. Cut longer text with `…`.
  - When the text is too long to quote, give a count. Example: `before: 2 items`, `after: 3 items`.
- A node without a marker did not change. Show it only when it gives context to a changed node.
- A node can be a file, a section, or an outside object such as a PR or a Jira issue.
- The simplified form removes the before and after lines, the same as other detail lines.

```ts
workflow.md
  [EDIT] line 8
    before: "Always ask questions to get more clarity."
    after:  "Ask questions when a decision is mine to make. Do not ask…"
  [ADD] ## Cheap actions
    after:  "Do not ask "run the recommended action?" for a cheap action…"
PR #212
  [EDIT] body › Known gaps
    before: 2 items
    after:  3 items
```

## Source Anchors

End the response with a **Source Anchors** section containing `path:line` references for the principal symbols that substantiate the graph. Prefer symbol-definition lines and omit generated, vendored, or incidental files. Keep anchors outside the graph so they support it without interrupting the flow.

## Output Rules

- Use plain text rather than rendered diagram formats.
- Use indented `→` arrows for hierarchy inside a `ts` code block.
- Keep descriptions beneath their symbol rather than as inline comments or a separate symbol table.
- Show Production and Tests as separate sections only when their wiring materially differs.
