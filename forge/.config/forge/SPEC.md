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
    verify/  summary.md models/<invariant>/{Spec.tla, Spec.cfg, result.md}
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

## 21. Allowed tools from the dialog, and dialog layout (2026-11-15)

- Q53 (A): Settings → Allowed tools shows, per phase, the default tools, the entries this repo or workspace added (chips with ×), and an Add row (the key cycles through bash, tools, mcp, read, write on click; then a value). It calls `forge config allow|disallow <phase> <key> <value>`, which edits only `<main>/.forge/SOURCES.md` under `## <phase>`. An entry the deny floor blocks is refused (it would never apply), and so is an MCP server that is not in `~/.claude/mcp-servers.json`. `forge settings` returns `project`, the entries per phase, so the dialog can offer × on exactly those.
- Settings are per repo (main checkout) or per workspace root, saved in its `.forge/`, and kept for every later run and session there.
- Layout: labeled fields, text areas padded like the inputs, a "New run" card, "one per line · or drop files" on References, and "workspace" instead of "repo" in a workspace. 110 tests pass.

## 22. First real run in dotfiles (2026-11-15)

Found while running forge in this repo:

1. Under `$HOME`, Claude reads `~/.claude/CLAUDE.md` as a parent folder's project file, so agents got the user's own global rules, and its `@CLAUDE.work.md` import raised a dialog nobody answered (the run sat at grill with 0 agents). Fix: every agent's settings set `claudeMdExcludes` for `~/.claude/**`, `~/CLAUDE.md`, `~/CLAUDE.local.md`; the repo's own CLAUDE.md still loads. Checked in dotfiles: before, the agent saw the global rules; after, it did not. forge also answers the import dialog with its default ("No").
2. Runs showed under the wrong space: a space's first terminal, or the folder it was created with, can be in another repo. Now a run shows under the space it was started from (shared `forge.spaces`), else the space most in its folder (agent panes 2, shells 1, its own folder 1); "+" uses the folder most of a space's panes are in.
3. A run opens in one floating window, not in tabs or the current tab: a read-only view of the run's current coordinator (its screen without Claude's prompt box, following phase handoffs), the forge graph, and the PR view (`forge-window` mod: title bar and agent view). The window does not move (every part stops presses). The sidebar marks the open run. Start opens nothing.
4. A TLA+ counterexample opened cycle 2 at grill, as designed. The forge header now shows why a cycle exists ("Cycle 2 · fixing a TLA+ counterexample from cycle 1: …", or the follow-up it handles). `forge status` reports `cycleOpen` and the current `coordinator`; `forge runs` reports each run's coordinator.
5. Runs started without a ticket are named after the goal (`local-<words>-<suffix>`).

## 23. Force allow, claude.ai connectors, and run-window fixes

- **Force allow (per repo, per phase).** `forge config force|unforce <phase> <tools|bash|mcp> <value>` stores `{key, value, rule, lifts}` under `force.<phase>` in `<main>/.forge/config.json`. `lifts` are the deny floor rules that block the entry. For an agent in that phase, the floor is `effectiveDeny(floor, lifts)`: the floor minus the lifted rules, plus `HARD_DENY` (`git push --force`, `-f`, `--force-with-lease`). The forced rule joins `--allowedTools`. `NEVER_LIFT` can never be lifted: `rm -rf`, `rm -fr`, `sudo`, `Edit(~/.claude/**)`, `Edit(**/.git/**)`. In Settings, a refused entry shows "Force allow". Forced entries show in red with ⚠, and × removes them.
- **claude.ai connectors.** Tested on Claude Code v2.1.325: `--strict-mcp-config` turns off every claude.ai connector, and `--setting-sources project` keeps them. A connector has no command or URL forge can pass in `--mcp-config`. So an agent whose sources name a connector (`- mcp: claude.ai Atlassian`) runs without `--strict-mcp-config`. Every other server from `claude mcp list` (cached a day in `~/.local/state/forge/mcp-list.json`) and from the repo's `.mcp.json` is denied by name, as `mcp__<prefix>`, in `--disallowedTools` and in the settings deny list. Tool prefix: `claude.ai Atlassian` → `claude_ai_Atlassian`. `forge mcp list [--refresh]` prints the list. The Settings MCP row offers connectors to pick.
- **Run window.** The forge footer no longer has Push or Create PR. The Pull request panel owns both. It hides Push when nothing is ahead. It hides Create PR when the run's branch is the repo's default branch, and says why. The cycle line opens on click to show the full reason. The tabs wrap onto more rows instead of being cut off.
- **Credentials from the interactive shell.** Herdr runs forge from a shell that never read `~/.zshrc`, where people export tokens. When a Jira or Confluence credential is missing, `credEnv` reads only the `JIRA_*` and `CONFLUENCE_*` names once from `$SHELL -ic`, after a marker, so a banner is skipped. Variables that are already set win. `FORGE_NO_SHELL_ENV=1` turns this off, and the tests set it.
- **Remove a run.** `forge remove --run <dir>` ends every live agent the run started (all cycles' `.spawn` files). Then it appends `{dir, removed: true}` to the registry, so a later line hides the run, and deletes `.forge/tickets/<ticket>`. Code is never touched: worktrees and branches stay, and the result lists the kept worktrees. In the sidebar, × on a hovered run row asks "remove / keep". `forge init` removes the run when a step after `init` fails (refs store, repos add). The Start dialog removes it when `forge coord` fails. So a failed start leaves no row.
- **Pull request panel only when done.** The run window includes the Pull request panel only when the run's phase is `done` at open time.

## 24. The retry cap: a node that keeps failing waits for the user (2026-11-16)

- Each node counts `fails`: every failure since the user last decided, whatever the error and across evolves. When `fails` reaches `retryCap` (4 by default; `FORGE_RETRY_CAP` sets it for new cycles, stored in `cycle_open` data), the node is `blocked`. Forge refuses `node_start` and `node_evolve` for it. The old rule (retry, then evolve after 2 identical errors) still runs below the cap.
- Only the user moves a blocked node. `forge retry <node>` (event `node_retry`) gives it a new generation and a fresh count. `forge skip <node>` (event `node_skip`) marks it done and skipped, so the phase can end without it. `decide()` tells the live coordinator, or starts one with the note.
- `node_retry`, `node_skip`, and `approved` are the user's. `forge append` refuses them when `FORGE_NODE` is set (an agent's shell). `forge retry`, `forge skip`, and `forge approve` refuse there too.
- `HEAD` and `forge status` list `blocked`. The sidebar row shows ◆ "you" in red when a node is blocked. The forge header shows "◆ N blocked: needs you". A blocked node shows ◆ and "blocked after N failures", and its panel has Retry and Skip.
- The coordinator prompt: when a node is blocked, write a `blocked:` comment, print `BLOCKED: <id> needs you`, go on with nodes that do not need it, and stop when nothing is left.
- TLA+ (`tla/Forge.tla`): `nfail`, `skipped`, `Blocked(n)`, `UserRetry`, `UserSkip`, and the action property `BlockedNeedsUser`. TLC passes (35,728 states). The mutation "Retry ignores the block" is caught by `BlockedNeedsUser`. Liveness now assumes the user decides on a blocked node sooner or later.

## 25. One graph for the whole run (2026-11-16)

- Like meta7, the Run view keeps every cycle in one graph. A loop back no longer looks like a reset. The phases show once. Every cycle's nodes sit under their phase: a later cycle adds nodes and never replaces them. Older cycles' nodes are dimmed and marked `· c<n>`. Clicking one reads its output from its own cycle folder.
- Each later cycle draws a back-arc from what caused it to the phase it restarted at. The arc is coloured by kind (counterexample, gate comment, QA or PR follow-up, other) and labelled `cycle <n>: <kind>`. Clicking the label shows the full reason. Blueprint's layout draws it as a side arc.
- `cycle_open` now always records `from: { cycle, phase }`, plus `node` when the opener names one. The verify coordinator passes `from.node: tla-<slug>` for a counterexample. Forge refuses a `from.node` that is not a node of the current cycle. For old runs without `from`, a `cex-<slug>` cycle is linked to node `tla-<slug>` when it exists, else to the phase the earlier cycle was in.
- `forge history` lists every cycle: start, slug, reason, follow-up, from, the phase it reached, and each node's final state.
- The switch next to the view dropdown ("All N cycles" / "Cycle N only") shows the current cycle alone.
- The TLA+ model does not change: cycles stay forward-only inside, and only the view joins them.

## 26. Repo toolchains that do not block exec (2026-11-16)

- First real workspace run (2 repos): both exec units were blocked at once. The JS repo needed `pnpm install --frozen-lockfile` (a fresh worktree has no `node_modules`) and `pnpm lint` (the short form). The Go repo needed its own codegen script and `gofmt`.
- Repo detection (`toolchainPreset`) now adds:
  - JS: `<pm> install`, `npm ci` for npm, and the short script form `<pm> <script>` for pnpm, yarn, and bun.
  - Go: `go generate`, `go mod download`, `go mod tidy`, `gofmt`.
  - Any repo: the build and check scripts in `script/` or `scripts/` (executable files), and the matching Makefile targets. A name must contain a build or check word (gen, build, test, check, lint, fmt, format, coverage, proto, typecheck, compile, vet). It must not contain a word that reaches outside or deletes (dev, prod, staging, deploy, release, publish, delete, drop, destroy, trigger, push, sync, upload, sonar, insert, seed, migrate, onboard). So `gen` and `check-coverage.sh` are allowed, while `trigger_setup_dev.py` and `deploy.sh` are not.
  - A repo with a `Dockerfile` (at the root, or in `script/` or `scripts/`): `docker build`, so a stale codegen image can be rebuilt. `docker run` and `docker push` stay off the list.
- `forge allowed <node> "<command>"` says whether that node's agent may run the command now, from the same rules the agent gets (`toolRules`, which `claudeArgs` now uses too). A coordinator runs it before it treats a `needs <tool>` node as blocked. A restart then retries nodes whose tool became allowed, and does not trust an old "blocked" note.
- The run window's left side is the coordinator's own Claude terminal (a `{ terminal }` block), so you type into it as usual. Herdr closes a window when its terminal ends, which happens at every phase handoff. So shared `forge.window` records the terminal it shows, and the sidebar checks the open run every 2 s: when the live coordinator changed (a handoff, the gate, the end), it reopens the window in place with the new terminal. With no live coordinator (the gate, done), the left side is a panel that says so. Only the window's × clears `forge.window` and stops the reopening.

## 27. A run's home: its agents in the Agents list (2026-11-16)

> Replaced by section 28: a shell is not an agent, so the Agents list never showed anything under the home. The home code is gone; the Agents list finds forge terminals by their `forge=` label.

- Herdr shows an `hc` terminal under its parent terminal's space and tab, and `hc run` cannot pick a space. A coordinator started from inside Herdr (the Start dialog, the run window) had no parent, so it and its node agents showed nowhere. One started from someone's session showed under that session's tab.
- `run.json` now has `home`: a terminal in the space the run was started from. The Start dialog passes `forge init --home <terminal>` and picks a plain shell in that space first (so no agent of yours gets the run's agents nested under it). `forge home <terminal>` sets it later.
- Every coordinator starts with `--parent <home> --no-notify --outlive-parent` while the home terminal is live. `--no-notify` keeps `hc` from typing notes into the user's own terminal, and `--outlive-parent` keeps the run going when that terminal closes. Node agents stay children of their coordinator, so they nest under it in the Agents list, with their live status. With no live home, a coordinator falls back to the old default parent.

## 28. Runs section, worktree tree, grill with the user, check levels, run chat (2026-11-16)

Decided in a brainstorming round with the user.

- **Runs section.** Forge runs left the space rows. A new `forge-runs` mod sits in the sidebar between Spaces and Agents: one row per run (the space's color, status, title, phase, × remove), and one "+" that starts a run in the active space. The run window, its follow logic, and remove moved there.
- **Worktree tree.** Under a space whose folder is a repo, Spaces lists the repo's linked worktrees by branch name. Under a folder that holds repos, it lists each child repo that has at least one linked worktree, as a header that folds. A worktree open as a space shows as its row with a dot; a click opens or selects it.
- **Grill "With me".** `forge init --grill auto|me` (default: the repo's last pick, `forge config grill`). With `me`, the grill coordinator is `grill-me-coord`: it reads the user's `brainstorming` skill by path (it has `disable-model-invocation`), asks question rounds in its own terminal, sends fact questions to fact-finder nodes, and writes `SPEC.draft.md` with the user's answers tagged `given`. Verify and the gate stay. `skills.md` now also lists `brainstorming` and `call-graph`.
- **Check levels.** `forge init --checks full|light|off` (default: the repo's last pick, `light` when none). The exec coordinator puts `Checks: <level>` on every unit and gate task. Light: units run only their files' tests and the typecheck; per-wave BEH gates run the typecheck and the wave's tests; one end check (`g-beh-final-r<r>`) runs the full suite and build once, with fix rounds and a `commit-final`. Off: no tests or builds; `PR.md` says "Checks not run". A run made before this keeps `full`.
- **Fable.** `fable` is a model alias in `MODELS` and in the dialog.
- **Run chat.** `forge chat [--open [--message <text>]]`: the user's own claude (their settings, skills, MCP, model, permission prompts; no `--setting-sources`), in the run's worktree with `--add-dir` for the run folder and repo worktrees, a brief from `roles/_chat.md` plus the run's facts and file paths, and `FORGE_RUN` through `--settings`. One conversation per run: `run.json` `chat.session`, started with `--session-id` and resumed with `--resume` once claude saved it. It may edit like any claude; only `forge append|spawn|coord|reconcile` are blocked. `--open` starts it in an hc terminal labeled `forge=<ticket>/chat` (reused while live, `chat.terminal` in run.json); `--message` is its first prompt, or is sent to a live chat. The user types `/brainstorming` there when they want it; forge adds nothing.
- **One place for follow-ups: the chat.** The forge panel lost its follow-up and gate comment boxes (Approve stays); the Start dialog lost "Follow up". `forge followup` refuses while a run worktree has changes not committed, unless a coordinator sends it (`FORGE_NODE`). `forge followup --grill auto|me` sets the grill mode of the cycle it opens (kept on the follow-up event; `grillMode()` reads it before `run.json`).
- **Run window.** With no live terminal for the chosen side, the left shows a centered "Start a chat". The bar has a Coordinator | Chat switch (`forge.window.view`). `cmd-escape` (the `forge-close` mod) closes the window like ×, or reopens the last one. Shared keys: `forge.open` {dir, view, at} asks forge-runs to open a run window; `forge.runs` lists runs for other mods.
- **Projects list.** The section header reads "projects". Right-click a row: Rename (`forge rename`, a new registry line; only the shown title changes) and Remove. Remove ends the agents and the chat, takes the run off the list, keeps `.forge/tickets/<ticket>/` and the branches, and removes the worktrees forge made (`git worktree remove`, never forced: a worktree with changes not committed is skipped and named). `--purge` (a failed start) deletes the folder too.
- **Agents list.** `omarchy-agents` shows forge terminals by their `forge=` label: one `⚒ <title>` group per run with the coordinator or chat and its nodes. Coordinators start with `--outlive-parent --no-notify`.
- **Notifications.** forge-runs compares each `forge runs` poll with the last and posts: gate, a blocked node, "With me" waiting, done, a committed wave (`progress.committed` from `commit-w<k>` nodes, of `progress.waves` from the plan), and a counterexample cycle. A click selects the run's space (else the active one, so every notification has an action and reaches the system). The last poll is kept in shared `forge.lastPoll`, so a reload loses no event. A forge chat or coordinator that goes from working to idle or done notifies too ("chat finished", "<role> finished", or "your turn in the grill" for `grill-me-coord`), except while it is on screen in the run window; a click peeks at it. Herdr's own alerts cover only agents in panes.
- **Start "With me"** opens the run window at once (shared `forge.open`, view coord), so round 1 shows up in front of the user. Auto runs open nothing.
- **PR panel.** "Send to forge" became "Send to chat": it still collects failed CI logs and open review threads into `<run>/inbox/`, then opens the chat with a message that points at the file. Push and Create PR are steps in the Progress list (running, done with the result, failed with the error), before a PR exists too.
- Known limit: "Send to chat" types into a live chat with `hc send`; text the user is typing at that moment can mix with it.

Tests: 141 pass (`test/options.test.ts`).


## 29. Blocks from the environment and the allow list (2026-11-16)

Incident: a workspace run's exec cycle stopped with "unit needs pnpm". Two causes. The chat had been opened by a Herdr button, so it had Herdr's short PATH (no nvm), and every terminal after it inherited it: chat, follow-up, classifier, exec coordinator, units. And the planner wrote `npx vitest`, `npm run typecheck`, and `npx eslint`, which the allow list denies (the preset allows the pnpm forms). The coordinator stopped with no button and no notification.

- **Agent PATH.** `env.ts`: agents and the chat get `~/.bun/bin`, then the login shell's PATH (`$SHELL -ilc`, read once per forge process, behind a marker), then the caller's. Where a run starts from no longer matters. `FORGE_NO_SHELL_ENV` turns the shell read off.
- **`forge checks`.** The repo's test, typecheck, lint, and build commands in the exact form the toolchain preset allows (JS package managers, Go, safe Makefile targets), with the programs they need. The exec coordinator passes them to the planner; units and the BEH gate use only those forms (`<test> <paths>` for single tests).
- **`forge doctor`.** claude, hc, git, and every program the checks need, on the agent PATH; `gh auth status` when a repo has a GitHub remote; `docker info` when a repo ships a Dockerfile. Exit 1 when something is missing. The Start dialog runs it before `forge init` (in a workspace, only for the named repos) and shows the misses; the exec coordinator runs it at boot.
- **Needs blocks are state.** A coordinator writes `blocked: <role> needs <tool>: <exact command>`. `forge status` and `forge runs` carry `needs` (role, tool, command, allow prefix, floor: none, force, or never) until a coordinator or node starts after it. The sidebar shows "you" and notifies; the run window offers "Allow for this repo" (or "Force allow" when the deny floor blocks it; nothing for NEVER_LIFT) and "Restart coordinator".
- **Lessons.** `forge lesson "<text>"` adds one line to `<main>/.forge/lessons.md` when a retry gets past a block. Every node's task points at the file. The Start dialog's Settings shows it.

- **Fix after the first real use.** A grill fact-finder was blocked, and "Allow for this repo" wrote the rule under `## exec` (the button had the phase fixed) and also allowed a note as a rule ("kubectl/helm not", from a free-text comment). Now `needs` carries the phase of the blocked agent and the button allows there; the allow prefix takes up to 2 subcommands (`kubectl get pods`, not `kubectl`, which would also allow its write commands); a block whose command is not a program on the agent PATH gets floor `unknown` and no button; `forge config allow|force` refuses a bash value that is not a command prefix (`commandLike`).

Tests: 147 pass (`test/checks.test.ts`).

## 30. Bypass by default, deny rules only (2026-11-16)

Every block so far came from the allow list (pnpm, `npx vitest`, a logs CLI), never from the deny floor. So the allow list goes, and agents run like the user's own claude: in bypass mode.

- **Bypass.** Every agent starts with `--permission-mode bypassPermissions` (and `defaultMode` plus `skipDangerousModePermissionPrompt` in its `--settings`). There is no `--allowedTools`. Claude enforces deny rules in every mode, `bypassPermissions` included (code.claude.com permission-modes). Tested on Claude Code v2.1.325: no bypass warning dialog under `--setting-sources project`, `echo` runs, `git push` is denied. `acceptTrust` also answers "Yes, I accept" if that dialog ever shows.
- **Deny rules** (`toolRules`): the deny floor minus this repo's lifts for the phase (never `NEVER_LIFT`), plus `HARD_DENY`, plus `scriptDenies(cwd)`, plus the `- deny:` entries of the SOURCES layers, plus the state files. The floor gains `kubectl delete|apply`, `helm install|upgrade|uninstall`, `terraform apply|destroy`, and `docker push`.
- **Repo scripts that reach outside** (`scriptDenies`): package.json scripts, `script/` and `scripts/` files, and Makefile targets whose name has an `OUTSIDE_WORDS` word (deploy, prod, publish, migrate, ...), in each form an agent would run them (`pnpm x`, `npm run x`, `./scripts/x`, `bash scripts/x`, `python3 scripts/x`, `make x`). The toolchain preset is gone.
- **SOURCES** keys are now `deny`, `read`, and `write`. A deny value is a command prefix, a tool rule, an `mcp__` server, or a claude.ai connector by name. The old keys (`tools`, `bash`, `mcp`) are read and ignored. Defaults: every agent denies `git checkout|switch|stash` (one shared worktree); roles that report (grill, verify, coordinators, planner, gates) deny git writes.
- **Read-only roles by prompt.** `_common.md` says the limits are the agent's own: a role that reports changes no repo file; MCP tools only to read and only when the task points at them; nothing that changes something outside the machine; no way around a denied command.
- **MCP.** No list and no `--strict-mcp-config`: every server in `~/.claude/mcp-servers.json` and every claude.ai connector loads (`enableAllProjectMcpServers` for a repo `.mcp.json`). The floor still denies Slack, Atlassian, Gmail, and Google Calendar as whole servers; a repo that needs one lifts it.
- **CLI.** `forge config allow|disallow` is replaced by `forge config deny|undeny <phase> <command|tool>`. `forge config force|unforce` stays as "Lift for this repo" and refuses an entry the floor does not deny. `forge allowed` is true unless a deny rule covers the command. `forge settings` → `sources.<phase>` is `{deny, forced}`, plus `scripts` and `project.<phase>` (this repo's deny values).
- **Needs blocks.** `needs.floor` is `lift` (the floor denies it: "Lift for this repo"), `project` (this repo's own `- deny:`: "Remove this repo's deny"), `never` (`NEVER_LIFT`), or `env` (no rule denies it: a missing program, a login, or a note; fix it, then restart). `deniedBy` names the rule.
- **UI.** Settings → "Denied commands" per phase: the default denies, this repo's entries (× removes), lifted floor rules (red ⚠, × puts them back), and an input with Deny and Lift. The MCP picker is gone.
- **Risks accepted.** A prefix rule misses `kubectl -n x delete` and `bash -c "…"`; text in a ref can make an agent run what no rule names; connectors with write tools other than the 4 denied ones can run; every agent loads about 45 MCP servers (slower start, more context).

## 31. Counterexample use cases (2026-11-16)

In TECHSUPP-591 cycle 1, 4 invariants failed. The result files showed only TLC traces. So the user had to ask the grill chat what each failure means for a customer. Now each failure comes with that story.

- **tla-writer.** `result.md` gets a `## Use case` section, only for a counterexample. It holds one short story per failing path, in user terms: who hits it, the steps with clock times and screens from the spec, what goes wrong, and whether it is the reported bug or a new risk. No TLA+ names: the trace stays in `## Counterexample`.
- **verify-coord.** A counterexample result is done only with a `## Use case`. `summary.md` gets a `## Use cases` section, with one or two lines per failed invariant.
- **Grill.** On a `cex` cycle, both grill coordinators read the use cases. `grill-me-coord` shows each story above its fix question. `grill-coord` gives them to the asker.
- No code reads these sections, so the CLI does not change.

## 32. A readable run graph (2026-11-16)

The Run view drew every agent of every cycle: about 110 boxes, fit at 20% zoom, so the text was about 3 px. Raw wave numbers (`wave 101`, `wave 199`) meant nothing to a reader. The new default view follows TLA+ state diagrams: few boxes, labelled arrows, and a legend.

- **Stage summary, top to bottom.** One box per cycle phase (`Cycle 2 · Grill`). Exec splits into `Plan`, one box per plan wave, and `End check`. A second line holds counts: rounds and agents, models and failed models, units, fix rounds, committed. `stageGraph` in `mods/forge/graph.js` builds it from `forge status` and `forge history`.
- **Labelled arrows.** Inside a cycle: "spec written", "all models pass", "you approved", "plan ready", "committed", "done". Into the next cycle: "N counterexamples (first: <slug>)", "gate comment", or the follow-up kind, coloured by kind. A new cycle is a new box under the old one, not a back-arc.
- **Legend and colours.** Boxes are filled by status (done, running, waiting for you, failed, pending). Stages the run went through get a blue border ("Path so far").
- **Failed models.** `forge history` has no verdicts, so the mod reads each cycle's `verify/summary.md` and counts the `COUNTEREXAMPLE` rows (`verdictCounts`). Without the file, the box says "<m> models".
- **Drill-down.** A click on a stage box shows its agents, left to right (`stageDetail`). In exec, agents sit under named wave steps: `waveName` turns `101` into "Wave 1 · gates", `102` into "Wave 1 · fix 1", and `199` into "Wave 1 · commit". "← All stages" goes back.
- `layout.js` does not change. `historyGraph` and `runGraph` no longer back a view.
