# Forge.tla: result

Verdict: **PASS**. Date: 2026-11-16 (retry cap added; first run 2026-11-15). TLC 2.19 (`tla2tools.jar` v1.7.4).

```sh
java -cp ~/.local/share/forge/tla2tools.jar tlc2.TLC -workers auto -config Forge.cfg Forge.tla
```

Model: 2 grill nodes, 1 verify node, 3 exec nodes, Cap 2, MaxFail 3, RetryCap 2, MaxCycles 2.
35,728 distinct states, depth 35, no error.

## Properties

| Property | Kind | Meaning |
|---|---|---|
| `CapOK` | invariant | At most Cap agents run at once. |
| `OnlyCurrentPhaseRuns` | invariant | Only nodes of the current phase run. |
| `PhaseBarrier` | invariant | Every node of an earlier phase is done. |
| `ExecNeedsApproval` | invariant | No exec without an approved spec. |
| `NoOrphanAgents` | invariant | No agent from an older cycle still runs. |
| `ForwardOnly` | action | Inside a cycle the phase never moves back and a done node stays done. Cycles and generations never go down. |
| `BlockedNeedsUser` | action | A node blocked after RetryCap failures never starts. It leaves "blocked" only by the user's retry (new generation, count 0), the user's skip (done), or a new cycle. |
| `Termination` | liveness | Every run ends and stays ended. |
| `NoStuckFailure` | liveness | A failed node never stays failed. |

## Mutation check

Each rule was removed from a copy of the model. A property must catch it.

| Removed rule | Caught by |
|---|---|
| Cap check in `Start` | `CapOK` |
| "all nodes done" in `Advance` | `PhaseBarrier` |
| new cycle in `Reopen` | `ForwardOnly` |
| `Running = {}` in `Reopen` | `NoOrphanAgents` |
| failure bound (`fails` grows) | `Termination` |
| `Evolve` | deadlock (a node with 2 identical errors can never run again) |
| `~Blocked(n)` in `Retry` (a coordinator retries a blocked node) | `BlockedNeedsUser` |
| `start = "exec" => approved` in `Reopen` | not caught: redundant, see finding 3 |
| approval reset in `Reopen` | not caught: redundant, see finding 3 |

## Findings for SPEC.md

1. A move to an earlier phase always opens a new cycle. This includes a TLA+ counterexample. Inside one cycle the phase only moves forward.
2. A reopen waits for a phase boundary, when no agent runs. Without that rule, agents of the old cycle keep running in the new one (`NoOrphanAgents` counterexample).
3. A follow-up can open a new cycle only at a phase at or before the current one. A code-only change (start at exec) is possible only after the run reached exec. So the approval check in `Reopen` never fires: the phase order already forces every spec change through the gate. `forge append` still checks it, as a second guard.
4. `Termination` holds only when failures are finite. The retry cap now gives the brake: after RetryCap failures a node waits for the user. `Termination` and `NoStuckFailure` also assume the user decides on a blocked node sooner or later (weak fairness on retry or skip).

## What the model leaves out

- File ownership inside an exec wave (checked by `forge append`, not modelled here).
- Gate nodes, fix nodes and the REVIEW loop inside exec (modelled as ordinary exec nodes that fail and retry).
- Pause and Resume.
