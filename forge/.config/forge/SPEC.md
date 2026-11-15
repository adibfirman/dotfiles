# forge spec (v0)

Status: approved at the gate on 2026-11-15, with decisions 11 to 13. M1 (forge CLI) and M2 (role prompts) built. Source: `~/.claude/plans/forge-recap.md`.

## 1. Goal and out of scope

Goal: automate the brainstorming flow. Agents grill each other, verify the spec with TLA+, and run the work in parallel. The user touches the flow at one point only: the spec gate. The state on disk is the only memory, so any new session can resume.

Out of scope for v0:

- Push, PR create, merge. Only the user does these, with a button.
- Bend. Only TLA+ (TLC).
- Linux and Windows. macOS first.
- Jira status in the GUI. The ticket is a link only.

## 2. Terms

- **Run**: all the work for one ticket.
- **Cycle**: one pass through the phases, in its own folder. A follow-up opens a new cycle.
- **Phase**: grill, verify, gate, exec, done.
- **Node**: one agent task in one phase, in its own hc terminal.
- **Generation**: a node that evolves gets a new generation. The log keeps the old one.
- **Coordinator**: the claude agent that runs one phase. The gate has none.
- **Follow-up**: new input after a cycle started: a QA bug, a request, a gate comment, a PR review.
- **Gate**: the one point where the user reads SPEC.md and approves or comments.
- **Agent decision**: a choice the user would make, made by the decider agent instead, with a reason.
- **Deny floor**: tool rules that no SOURCES file can unlock.
- **Unit**: one exec node that owns a fixed list of files.
- **Wave**: units that run in parallel. Waves run one after another.

## 3. Decisions

All decisions come from the user, in brainstorming rounds Q1 to Q30 (2026-11-15). The full list is in the recap. The ones that shape the build:

1. A claude coordinator agent decides. Code guards the state and the permissions only (Q1, Q7, Q28).
2. One coordinator per phase. It reads only its phase inputs and hands off to the next (Q6, Q11).
3. Forward only. A failure retries the node. 2 identical errors evolve it. No retry limit, no halt (Q4).
4. The user gate comes after TLA+ verification (Q2).
5. Exec: units own their files, waves run in order, at most 4 agents, local commits only (Q12).
6. Gates after each wave: BEH, SPEC, SEC, REVIEW. REVIEW runs the user's `code-review` skill and loops on must-fix findings (Q13, Q17).
7. Children start with `claude --setting-sources project --strict-mcp-config` (Q16). Tested: the user CLAUDE.md is skipped and MCP from `--mcp-config` loads.
8. SOURCES in layers: dotfiles default, toolchain preset, optional project file, deny floor last (Q29).
9. The ticket worktree is created at cycle start. The state lives in the main checkout (Q18).
10. GUI: a forge mod with Blueprint's layout code (MIT), and a separate prs sidebar mod (Q22, Q24).

New decisions from the TLA+ model (`tla/result.md`), approved at the gate:

11. A move to an earlier phase always opens a new cycle, a TLA+ counterexample included. Round 2 said "new grill node in the same cycle". The model needs a new cycle so that the phase only moves forward inside one cycle.
12. A follow-up waits for a phase boundary: no agent of the cycle runs. It is queued until then.
13. A follow-up whose earliest phase is later than the current phase does not open a cycle. It is added as input to the current cycle.

## 4. Flows and states

## Graphs

```ts
// Run flow
Start (forge mod) | context.md {ticket, type, base}
  → forge spawn setup
    herdr worktree create --cwd <main> --branch <type>/<ticket> --base <base>
  → grill-coord
    input: context.md | follow-up, SOURCES
    → [asker ∥ fact-finder × n ∥ decider]
      → SPEC.draft.md
  → verify-coord
    input: SPEC.draft.md ONLY
    → [tla-writer × invariants]
      tlc → PASS | COUNTEREXAMPLE
      → COUNTEREXAMPLE → new cycle at grill
  → gate
    you: Approve | Comment | Override
    → Comment | Override → follow-up → new cycle
  → exec-coord
    input: SPEC.md + models ONLY
    → planner
      units with FILES_CHANGED, sorted into waves
    → W1 [unit ∥ unit]
      → [BEH ∥ SPEC ∥ SEC ∥ REVIEW]
        → ❌ → fix nodes → gates again
        → ✅ → local commit
    → exec/PR.md
  → you: Push | Create PR (draft)
```

```ts
// Node states (per generation)
pending
  → running
    forge spawn, at most 4 running
    → done
    → failed
      → pending
        retry, same subgraph, sameErr < 2
      → pending (gen + 1)
        evolve after 2 identical errors
```

```ts
// Phase states (per cycle)
grill
  → verify
    all grill nodes done
    → gate
      all verify nodes done
      → exec
        Approve
        → done
          all exec nodes done
any phase, no agent running
  → Reopen(start)
    new cycle, start at or before the current phase
    start = exec only when the spec is approved
```

```ts
// Permission build in forge spawn
forge spawn <role> <task>
  → ~/.config/forge/SOURCES.md
    default, one section per phase
  → toolchain preset
    package.json scripts | go.mod
  → <main>/.forge/SOURCES.md
    optional, differences only: "- bash: …" adds, "- !bash: …" removes
  → deny floor
    always last, always wins
    → claude --setting-sources project --strict-mcp-config --mcp-config … --allowedTools … --disallowedTools … --settings <deny floor> --plugin-dir <forge skills> --model <from models.md>
      → hc run --bg --cwd <worktree> --label forge=<ticket>/<cycle>/<node>
```

### State on disk

```
<main>/.forge/tickets/<ticket>/
  HEAD                                   current cycle and phase
  SOURCES.md                             optional override
  cycles/<NNN>-<slug>/
    events.jsonl                         written only by forge append
    grill/   tree.md decisions.md SPEC.draft.md <node>.md
    verify/  models/<invariant>/{Spec.tla, Spec.cfg, result.md}
    gate/    SPEC.md
    exec/    waves/<NN>-<slug>.md gates/ review-notes.md PR.md
```

Event line: `{"ts", "cycle", "phase", "node", "gen", "kind", "data", "prev"}`. The caller gives `kind`, `node`, and `data`. forge sets the rest. `prev` is the sha256 of the line before, so a changed or removed line breaks the chain. `HEAD` keeps the hash of the last line, so an edit to the last line is caught too. Kinds: `cycle_open`, `node_add`, `node_start`, `node_done`, `node_fail`, `node_evolve`, `phase_done`, `approved`, `comment`, `followup`, `pause`, `resume`. The gate opens with `phase_done` at the end of verify (no `gate_open` kind).

## 5. Invariants

Each one is checked in `tla/Forge.tla`. Result: PASS, see `tla/result.md`.

1. `CapOK`: at most 4 agents run at once (the model checks Cap 2 with 3 exec nodes).
2. `OnlyCurrentPhaseRuns`: only nodes of the current phase run.
3. `PhaseBarrier`: every node of an earlier phase is done.
4. `ExecNeedsApproval`: no exec without an approved spec.
5. `NoOrphanAgents`: no agent from an older cycle still runs.
6. `ForwardOnly`: inside a cycle the phase never moves back and a done node stays done.
7. `Termination`: every run ends. It needs finite failures.
8. `NoStuckFailure`: a failed node never stays failed.

## 6. Acceptance tests

1. `forge append` refuses: an edited old line, a node status that moves back inside a cycle, a phase that moves back inside a cycle, an exec node start with no `approved` event for the current spec, two units of one wave with the same file.
2. `forge spawn` builds the flags from the 4 layers. A deny floor entry wins over a SOURCES entry that allows the same thing. A 5th agent waits in the queue until one of 4 ends.
3. `forge spawn` reads `first_message.sent` from `hc run`. When it is false, it reads the terminal and sends the task again only when the task did not arrive.
4. `forge status` prints the current cycle, phase, and nodes as JSON, rebuilt from `events.jsonl` alone.
5. A child started by `forge spawn` has no user CLAUDE.md, has the MCP servers of its phase, and can load `code-review` through `--plugin-dir`.
6. The forge mod draws each `ts` block under `## Graphs` in SPEC.md as a graph tab, and the Run tab from `events.jsonl`.
7. End to end on a small test repo: one cycle reaches done with no user input except Approve. A follow-up then opens cycle 002.

## 7. Exec plan

```ts
// Waves (each wave ends with tests + review + a local commit)
W1 [M1 forge CLI]
  forge/.config/forge/cli/{package.json, tsconfig.json}
  forge/.config/forge/cli/src/{events.ts, append.ts, sources.ts, spawn.ts, status.ts, main.ts}
  forge/.config/forge/cli/test/*.test.ts
  forge/.config/forge/{SOURCES.md, deny-floor.json, models.md}
  forge/.local/bin/forge
W2 [M2 role prompts]
  forge/.config/forge/roles/{grill-coord, verify-coord, exec-coord}.md
  forge/.config/forge/roles/{asker, fact-finder, decider, tla-writer, planner, unit}.md
  forge/.config/forge/roles/{gate-beh, gate-spec, gate-sec, gate-review, classifier, commit}.md
W3 [M3 forge mod ∥ M4 prs mod]
  herdr-app/.config/herdr-app/mods/forge/*        // layout.js from Blueprint, with its MIT notice
  herdr-app/.config/herdr-app/mods/prs/*
W4 [M5 end to end]
  a small test repo outside dotfiles
```

Note: the mods go in the `herdr-app` stow package, next to the other mods, not in `forge/`. Stow links them into `~/.config/herdr-app/mods/`.

Runtime: the CLI uses bun (1.3.4 installed) and has no dependencies. The mods are plain JS, tested with `node --test`, like `agent-notify`.

## 8. Build notes (M1)

Facts found while building M1. Each one is tested.

1. Commands: `forge init <context.md>`, `forge append <kind> [--node] [--data]`, `forge spawn <role> <node> <task>`, `forge status`, `forge tlc <dir>`. `init` and `tlc` are additions to the 3 commands in decision 5. `init` makes the ticket worktree itself (no agent needed for that step).
2. Exec order: each exec node has a `wave` number. A node starts only when every exec node with a lower number is done. Units, gates, fix nodes, and the commit of one plan wave get rising numbers (for example 10, 11, 12). A new node cannot take a number lower than one that already started.
3. Queue: `forge spawn` queues a node when the cap or the wave order blocks it (exit 3). `forge append` starts queued nodes after `node_done`, `node_fail`, `node_evolve`, `phase_done`, `approved`, or `resume`. Other blocks are refusals (exit 1).
4. Child flags (tested on a real claude 2.1.319): the user CLAUDE.md is not loaded, only the phase's MCP servers load, `forge-skills:code-review` and `forge-skills:technical` load through `--plugin-dir`, writes to the phase folder work, and writes to `events.jsonl` and `git push` are denied.
5. Deny rules for files must be `Edit(path)`. Claude does not match `Write(path)` rules; `Edit` rules cover every file tool.
6. The run address (`FORGE_RUN`, `FORGE_NODE`) goes in a per-spawn `--settings` file under `env`. An `env` wrapper command hides claude from hc, which then shows no agent status.
7. Claude asks to trust each new folder, and its default answer is "No, exit". `forge spawn` reads the screen and answers "Yes, I trust this folder" (`hc keys down enter`). It runs agents only in the run's own worktree. Tested in a new folder.
8. hc does not track a task given as a claude argument as a launch task (`first_message` is empty). `hc wait` can return at the startup idle, before the task starts. Coordinators (M2) must wait for the child's `hc send` report, or for turn 1 or later, not for the first idle.
9. A built-in `code-review` skill also exists. The REVIEW gate role must name `forge-skills:code-review`.

## 9. Build notes (M2)

1. Coordinators and the classifier are not nodes. `forge coord` starts them, and a `coord_start` event records them. They are not in the cap or the phase barrier, because a coordinator runs while its phase ends.
2. New commands: `forge coord [--role classifier]`, `forge approve` (approved + start exec-coord), `forge followup <text> [--source]`, `forge reconcile`.
3. `forge followup` sends the follow-up to the live coordinator with `hc send`. With no live coordinator (gate, done, or after a crash), it starts a classifier. A follow-up gets an id (`<cycle>-<n>`). A later event with `data.followup` marks it handled.
4. `forge reconcile`, at each coordinator boot: a running node whose agent is gone fails with `agent lost`, so it retries. Old coordinators of the run are closed. This is how a coordinator hands off: it starts the next one and stops, and the next one closes it.
5. `forge append node_done` and `node_fail` close the agent's terminal and save its screen in `.spawn/`. A retry closes the old terminal before it reuses the name.
6. The role prompt is `roles/_common.md`, then `roles/_coordinator.md` for coordinators, then `roles/<role>.md`, joined into `.spawn/<id>-prompt.md`.
7. Every agent can read the run folder and write its output folder: the phase folder for a node, the cycle folder for a coordinator (an `Edit(<folder>/**)` allow rule; tested on a real claude). SOURCES sections can name a role. Gates, the planner, and coordinators have no `Edit` or `Write` and no git write commands. Only `unit` and `commit` change the repo.
8. Exec wave numbers: `plan` 1; plan wave k: units 100k, gates 100k+1, fix round r 100k+2r, gates again 100k+2r+1, commit 100k+99.
9. The prompts are not yet tested on real agents end to end. That is M5.
