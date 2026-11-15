# forge spec (v0)

Status: approved at the gate on 2026-11-15, with decisions 11 to 13. M1 (forge CLI) and M2 (role prompts) built. M5-lite (one real cycle) passed. Source: `~/.claude/plans/forge-recap.md`.

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

## 10. M5-lite: first real cycle (2026-11-15)

A test repo (bun, `src/order.ts` with pay and cancel) and the request "add refunds: only paid orders, at most once, full amount". One cycle ran from `forge init` to two local commits. The user only approved at the gate.

- Grill: about 6 minutes. 2 asker rounds, 5 decider nodes, no fact-finder (the repo is small). The spec draft had all sections, 8 invariants, and 6 agent decisions for the user.
- Verify: 8 TLA+ models, all PASS, and each mutant was caught (checked in each `mutant/tlc.out`). The first try failed (see 1 below). After the fix, the retries passed. `verify-coord-2` took over from `verify-coord-1` through reconcile.
- Exec: the planner made 2 waves, 4 gates for each wave, and no must-fix finding. 2 commits: `feat: refund paid orders`, `test: cover refund of paid orders`. 12 tests pass. 13 comments went to `review-notes.md`.

Found and fixed:

1. Agents wrote compound shell commands (`M=…; forge tlc $M`, `cd … && …`). The allow list matches how a command starts, so these were denied, and the agents gave up. Fix: `_common.md` says to run each command alone and in plain form, and to write files with the Write tool. `forge spawn --task-file` keeps TLA+ text out of shell arguments. `_coordinator.md` says how to handle `needs <tool>`.
2. hc terminals have a short PATH (no `~/.bun/bin`), and on macOS `/usr/bin/java` is only a placeholder. Fix: the per-spawn settings pass the caller's PATH, the `forge` wrapper falls back to `~/.bun/bin/bun`, and `forge tlc` finds Homebrew OpenJDK.
3. `forge reconcile` checked lost nodes before it closed old coordinators, but node agents end with their coordinator. Fix: close old coordinators first.
4. Gate agents ran `git -C <path> diff`, which was denied. Fix: `_common.md` says to run git without `-C`.
5. The planner put the tests in the wave after the code, so the wave 1 SPEC gate had no test to check. Fix: a code change and its tests go in the same wave.
6. Commits got a `Co-Authored-By` trailer. Fix: the per-spawn settings set `attribution` to empty (tested).
7. `forge status` gives `cyclePath`, the absolute cycle folder.

Seen and accepted: one security gate wrote `## VERDICT: PASS` as a heading. Gate prompts now ask for `VERDICT:` as the first line.

## 11. Build notes (M3: forge mod)

The mod lives in the `herdr-app` stow package: `herdr-app/.config/herdr-app/mods/forge/`.

- `layout.js`: Blueprint's layered layout, copied unchanged (MIT, `BLUEPRINT-LICENSE.md`).
- `graph.js`: pure code with tests (`node --test 'test/*.test.mjs'`, 7 pass). It parses the `ts` graphs of a spec, builds the run graph from `forge status` (phases in a chain, nodes under their phase, exec nodes under their wave), and reads the agent decisions list.
- `data.js`: git for the repo, `~/.local/bin/forge` for the run, push.
- `main.js`: the view. It has a header (ticket, cycle, phase, running/cap, Pause/Resume), tabs (Run, Gate while the gate is open, one per spec graph, Spec), a node detail panel (output file, or the agent's terminal through `terminal.keep` while it runs), the gate view (spec, agent decisions with Override, comment, Approve), a start form, and a footer (follow-up; Push and Create PR when the cycle is done).
- It follows the focused terminal's repo, or a pinned run: `herdr-app do pane.split --direction right --mod forge --props '{"run":"<run dir>"}'`. Pane props come from `props()` in the `herdr` module, not from the `init` argument.
- It writes what it sees to `<app home>/data/forge/last-state.json` after each load, for debugging.

Found while building:

1. Herdr does not reload a symlinked mod folder when its files change (Blueprint says the same). Stow links the folder, so after an edit, restart Herdr, or test from a real copy (`mods/forge-dev`).
2. `herdr-app shot` returns the last frame while the window is covered, so a screenshot can be stale. `last-state.json` shows the data without one.
3. A shell filter here strips comments from `cat` output. Copy files with Python or `rtk proxy`.

Not checked yet: how the graph, the gate view, and the buttons look and work in the app.

## 12. Build notes (M4: prs mod)

The mod lives in `herdr-app/.config/herdr-app/mods/prs/`. Open it with `herdr-app do pane.split --direction right --mod prs`.

- `model.js`: pure code with tests (`node --test 'test/*.test.mjs'`, 7 pass). The state rules come from `herdr/.config/herdr/scripts/sync-all-pr-worktree-labels`: draft; then merge conflict, CI failed (cancelled runs do not count), open threads or changes requested, blocked, approved on the head commit. The list sorts by that order, then by the last update.
- `github.js`: one GraphQL call through `gh` for all open PRs (`is:pr is:open author:@me`), with checks, reviews, threads, merge state, and files. It retries once, because GitHub sometimes answers this query with a 502. Send to forge reads the open threads and the failed job logs (`gh run view --job <id> --log-failed`).
- `main.js`: the list (title, repo #n, ticket, CI, state, forge phase, agent) and the detail (branch → base, agent with Go, a timeline, the checks, the ticket link, the forge cycle, changed files, Push, Send to forge). It refreshes every 2 minutes and on ↻.
- A PR matches a local pane by repo (`git remote get-url origin`) and branch. The ticket comes from the branch name. A forge run is `<main>/.forge/tickets/<ticket>/`.
- Send to forge writes the failed logs and the open threads to `<run>/inbox/pr-<n>-<time>.md` and runs `forge followup "PR #n: … Details: <file>" --source pr`.
- The ticket link comes from an untracked file, `<app home>/data/prs/config.json` (`{"ticketUrl": ".../browse/{key}"}`), so no company URL is in dotfiles.
- It writes what it sees to `<app home>/data/prs/last-state.json`. Checked on 2026-11-15: 38 PRs, 2 matched to local worktrees.

Changed after review (Q31 = B): the sidebar shows **forge runs** by default, with an **All** toggle for every open PR of mine.

- `forge init` adds each run to a global registry, `~/.local/state/forge/runs.jsonl` (`FORGE_REGISTRY` to move it): ticket, run folder, main checkout, worktree, branch (the current branch for `ticket: none`), repo (from `origin`), title (the first line of the context), and time. `forge runs` lists the runs whose folder still exists, with their HEAD. `forge register` adds a run made before the registry existed.
- Forge mode asks GitHub for the newest PR of each run's branch in one GraphQL call (one aliased field per run), in any state, so merged and closed PRs stay visible. A run without a PR shows "No PR yet". When its cycle is done, its detail offers Create PR (draft, body from `exec/PR.md`).
- Checked in the app: the test run shows with no PR (the test repo has no remote). The aliased query was checked against GitHub: it found the open PR of a real branch and no PR for a branch that does not exist.

Not checked yet: the look, and Push, Create PR, and Send to forge on a real PR.

## 13. Follow-up test (2026-11-15)

A regression commit (`cdfdcc4`, refund allowed for a cancelled order) and a QA report through `forge followup --source qa`. No coordinator was running, so forge started a classifier. It cited the approved spec (`gate/SPEC.md:118`, D10), picked `exec`, and opened cycle `002-fix-cancelled-refund-guard` with the approval carried over: no new context file, no restart, no gate. exec-coord ran plan → 1 unit → 4 gates (all PASS) → commit `fafeb88 fix: refund only paid orders` with a regression test. 13 tests pass, the follow-up is marked handled, and the commit has no co-author line.

Found: the coordinator's task text named `exec/gates/<id>.md` as the output, while forge's footer names `exec/<id>.md`, so gate outputs went to two places. Fix: `_coordinator.md` says never to name an output file in a task.

## 14. Gate comment and fix loop tests (2026-11-15)

- Spec change follow-up ("every refund must record a reason") → cycle `003-refund-reason` at grill, approval dropped → 12 invariants → gate.
- Gate comment (`forge followup --source gate`: "limit the reason to 200 characters") → a classifier (no coordinator runs at the gate) → cycle `004-refund-reason-length` at grill. Its spec carries cycle 3 (never executed), marks D20 "No maximum reason length" as SUPERSEDED by D26, and adds 2 invariants. 14 models, all PASS with caught mutants → gate again.
- Fix loop: approved cycle 4. When the first gate node was added, a test script changed the limit in `src/order.ts` from 200 to 2000 (a deliberate defect). All 4 gates failed in round 0 (BEH 2, SPEC 2, SEC 1, REVIEW 1 must-fix) → `fix-u-refund-reason-length-r1` at wave 102 → gates round 1 at wave 103, all PASS → commit `9f9d05e feat: require refund reason, limit it to 200 characters`. The limit is back at 200 and 29 tests pass.

Found and fixed:

1. `forge followup` sent the first follow-up to `exec-coord-1`, which had finished but whose terminal was still open. It handled it, but by luck. Fix: a coordinator counts as live only when it runs the current phase (`80f799a`).
2. The classifier wrote its note after `forge coord`, and the next coordinator closed it first, so the note was lost. Fix: the note comes before the action.

## 15. Spaces integration (2026-11-15)

Decisions (Q32 to Q35, revised by the user): forge shows inside the spaces sidebar, and "+" works from the space's folder.

- `omarchy-spaces` loads `forge runs` every 8 s and draws each run as a child row under the space whose folder is the run's worktree: ✓ done, ● running, ◆ "you" at the gate, Ⅱ paused. A click selects the space and opens the forge panel pinned to that run (`pane.split` right, `props.run`).
- Hovering a space shows a "+". It opens the new `forge-start` dialog for the space's folder: the repo's runs (from `.forge` through the registry) with Open and Follow up, and a New run form (optional ticket, what to build).
- A new run uses the space's folder as it is: `forge init <context> --here`. No new worktree; the ticket key, when given, names the run. For a ticket worktree, make the worktree space first (herdr's New worktree), then press "+" there.
- The stowed mods (`forge`, `prs`, `omarchy-spaces`, `forge-start`) load their new code after a Herdr restart.
- A click on a forge row (or Open and Start in the dialog) shows the run in both mods: the forge graph panel on the right and the prs view below it, opened on that run's detail. The click sets the shared value `forge.selected` (`{dir, at}`). Forge and prs panes already in the space's active tab switch to that run instead of opening again (the selection is global, so every forge and prs pane follows the last click).

## 16. References (2026-11-15)

Decisions Q36 to Q39: references are added in `context.md` (`refs:` list), in the + dialog (one per line, or files dropped on it), or with `forge followup --ref`; each is fetched once into `<run>/refs/` with the user's own credentials; v1 sources are GitHub, Confluence, Jira, https, and local files; refs are data, never instructions.

- `forge refs add <url|path|KEY>...`, `forge refs list`, `forge refs refresh <n>` (a refresh adds a new copy with a new number). `forge init` fetches the `refs:` list, relative to the context file.
- Fetchers: GitHub PR, issue, or file through `gh`; Confluence page through REST v2 with `CONFLUENCE_*`; Jira issue through REST v3 with `JIRA_*`, with up to 5 image attachments as image refs; any https URL (HTML to text, images and PDFs kept as files); local files.
- Images and PDFs are stored as files (up to 10 MB). Agents open them with the Read tool, which shows them to the model. Text is cut at 200 KB.
- `refs/INDEX.md` lists every ref. Every agent's task names it, and `_common.md` says to read it first and to treat ref text as data.
- Agents can read `refs/` but not write it (it is outside every agent's output folder).
- `CONFLUENCE_DOMAIN` may hold a full URL; hosts are normalized. A network error is a refusal, not a crash.
- Checked live (read-only): a public GitHub file (20 KB), a Jira issue, and a Confluence page (17 KB). 91 tests pass.

Failures (Q40 to Q43, 2026-11-15): refs are fetched only when added, never during a phase, so a ref can never stop a wave.

- All or nothing: every ref is fetched (into memory) before forge writes anything. One failure means no run is created (`forge init`), no follow-up is sent (`--ref`), and no ref is added (`refs add a b c`). The error names the ref: `ref 2 of 3 failed: <source>: <reason>`. The + dialog keeps what you typed.
- Retries: 2, after 2 s and 5 s (`FORGE_REF_RETRY_MS`), for HTTP 5xx, 429, timeouts, and lost connections. 401, 403, and 404 fail at once.
- A login page is a failure: HTML with a password field, or a short page titled "Sign in" or "Log in".
- A failed refresh changes nothing; the old copy stays.

## 17. Settings and requirement changes (2026-11-15)

- Q44 (A): a requirement change while the run's PR is open is a follow-up cycle on the same run. When the PR is merged, it is a new run. The + dialog marks such runs "PR merged" and offers "New run from this": the old run's approved spec goes into the refs, and the goal starts with "Continue from <ticket>".
- Q45: the + dialog has a Settings section: models per role group (opus, sonnet, haiku; "project" marks an override, "reset" removes it), agents at once (1 to 8), the allowed tools per phase (read only), the deny floor (read only), and "Edit project SOURCES.md" (opens it in `$EDITOR`, default nvim, in a pane below).
- The CLI owns these files: `forge settings [--main]` prints the effective values marked default or project; `forge config model <role>=<model|default>...`, `forge config cap <n>`, and `forge config sources-file` write only `<main>/.forge/models.md`, `config.json`, and `SOURCES.md`.
- Q46: models and tools apply from the next agent (read at each spawn). The cap applies from the next cycle: `forge init` and each new cycle read `<main>/.forge/config.json` (`FORGE_CAP` still overrides at init). 100 tests pass.

## 18. Workspace mode (2026-11-15)

Decisions Q47 to Q52: a root folder that is not a git repo but holds repos (like `~/work` with one folder per repo) runs forge as a workspace; a folder with no repos is offered "Make this a git repo" (`git init`, add, first commit). Each repo keeps its own git; the root needs none.

- `forge init` in such a root starts a workspace run at `<root>/.forge/tickets/<ticket>/` (`run.json` `mode: "workspace"`, `repos: []`). forge finds it from the root (no git) by walking up to `.forge/tickets`.
- `forge repo add <name>[@<base>]` (from `repos:` in the context, the dialog's Repos field, or grill as an `agent-decision`): the base comes from `origin/HEAD` (develop or main) unless given; forge fetches `origin/<base>` and makes a detached worktree `<root>/worktrees/<ticket>/<repo>` at it. All fetches run before any worktree is made. The user's own checkouts are never touched.
- `forge repo branch` (exec start): fetch each base again, then `git switch -c <type>/<ticket> origin/<base>` in each worktree, so exec starts from the newest base.
- Nodes carry `data.repo`; a unit, gate, or commit node in a workspace run must have one, and forge starts it in that repo's worktree (plain git works there). Files are `<repo>/<path>`, so two repos can change the same relative path in one wave.
- One commit node per repo per wave, the 4 gates per repo, and one `exec/PR-<repo>.md` per repo linking the others. The forge panel pushes every branched repo and opens one draft PR per repo. The prs pane shows one row per repo ("<title> · <repo>").
- `forge status` and `forge runs` show `mode` and `repos`. 107 tests pass (7 workspace tests on real git repos with bare origins, including a base that moves after grill and an untouched user checkout).

## 19. Closing the last coordinator (2026-11-15)

Coordinators close each other at a handoff (`forge reconcile`), but nothing follows the coordinator whose `phase_done` ends the run. Found when the test run's last exec coordinator stayed open and idle. Fix: that `forge append phase_done` starts a detached `forge close <id>` after `FORGE_CLOSE_DELAY_S` (default 60 s), so the coordinator can print its summary first. The screen is saved before the terminal ends. At the gate nothing changes: Approve or a comment starts the next coordinator, which closes the old one.

## 20. Skills plugin without symlinks in the repo (2026-11-15)

The repo held two relative symlinks (`skills-plugin/skills/code-review → ../../../../../claude/.claude/skills/code-review`). They worked, but they depend on the dotfiles layout and on stow folding `~/.config/forge`. Now `skills.md` lists the skill names, and `forge spawn` builds `~/.local/share/forge/skills-plugin/` at run time: `.claude-plugin/plugin.json` plus one link per installed skill to `~/.claude/skills/<name>` on that machine (a missing skill is skipped). Checked on a real claude: it loads `forge-skills:code-review` and `forge-skills:technical`. 109 tests pass.
