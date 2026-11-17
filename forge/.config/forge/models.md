# models (forge default)

Model per role, as `- role: model`. `fable`, `opus`, `sonnet`, and `haiku` are
aliases for the latest model of each family. A project file `<main>/.forge/models.md`
overrides single roles. `default` covers any role not listed.
Keep each role on its own line. A description goes on the next line, indented.

How to pick a model for a role:
- fable: the role assumes or decides (scope, invariants).
- opus: the role writes, judges, or routes from one fixed input, with real judgment.
- sonnet: the role checks against clear rules.
- haiku: the role follows exact steps.

- default: sonnet

## Planning: gathers facts and plans the work

- asker: fable
  Asks question rounds about the request, then writes SPEC.draft.md with the invariants.
- fact-finder: opus
  Answers one fact question from the code, git history, docs, and tools. Changes nothing.
- planner: fable
  Splits the approved spec into units with fixed files, sorted into waves.

## Decision: judges, picks, and approves

- grill-coord: opus
  Runs grill: spawns askers, fact-finders, and deciders until the spec draft is complete.
- grill-me-coord: fable
  Runs grill with the user in its terminal, and writes SPEC.draft.md with the invariants.
- verify-coord: opus
  Makes one TLA+ model per invariant, judges the results, then opens the gate or a new cycle.
- exec-coord: opus
  Runs exec: plan, waves, 4 gates per wave, fix rounds, local commits, PR body update.
- decider: fable
  Makes one product, scope, priority, or risk decision for the user, with a reason.
- gate-beh: sonnet
  Checks that the wave works: runs the tests and the typecheck.
- gate-spec: sonnet
  Checks the wave against the approved spec: each invariant has a test and a guard.
- gate-sec: sonnet
  Checks the wave's diff for security problems.
- gate-review: opus
  Reviews the wave's code with the user's code-review skill. Must-fix findings start a fix round.
- classifier: opus
  Routes a follow-up to the right phase when no coordinator runs.

## Writing: produces files and code

- tla-writer: opus
  Writes one TLA+ model for one invariant, runs TLC, and checks it with a mutant.
- unit: haiku
  Changes only its own files as the task says, adds tests, and runs the checks.
- commit: haiku
  Commits one wave locally after all 4 gates pass. Never pushes.
