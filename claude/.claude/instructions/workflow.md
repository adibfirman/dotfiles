# Workflow

## No plan mode

- NEVER enter plan mode. Do not use `EnterPlanMode` or `ExitPlanMode` at any time.
- Write the plan as plain text in the chat, not in plan mode.
- If something goes wrong, STOP and tell me. Do not continue.
- Ask questions only as "Before you ask me" allows. Do not ask before a cheap action. See "Cheap actions".
- Write detailed specs upfront to reduce ambiguity.
- Always break down tasks with their dependencies.

## Before you ask me

- Find the answer yourself before you ask me. Check the code, the git history (`git log -S`, `git blame`), code comments, ADRs, PR threads, and `~/.claude/plans/`.
- A question that a read-only check can answer is not a question. Run the check (Level 1), then report the result.
- Test each question before you send it: "Can a read-only check answer this in about 2 minutes?" If yes, run the check first.
- Ask me only in these cases:
  - The facts do not exist anywhere you can read.
  - The facts exist, but the choice is still mine: product, scope, priority, or risk.
- When you ask, show the facts first, then ask:
  - What you found, with `file:line`, a commit, or a link.
  - Your recommendation and the reason.
  - The question, with options on separate lines.
- Never ask me where something came from, why it exists, or what it does. Find out and tell me.

## General

- After the work in a plan is done, save the plan in `~/.claude/plans/`. Use the saved plans as a reference when you make new plans.
- Never, ever, under any circumstances, ever, not once, no matter what, try to start the fucking dev server.
- Do NOT create any Claude artifacts until I allow it.
- Do NOT use the AskUserQuestion tool. When you have a question for the user, write the raw question directly in the chat as plain text instead.
- For every code edit, shell command, or MCP tool call, delegate to the `coder` subagent. Do not run them in the main session. Exception: a Level 1 cheap action runs in the main session. The brief must have:
  - Numbered steps, in the order to run them.
  - For each step: the file path and the exact code (old and new text), or the exact command. A read-only step may give the goal and the paths instead.
  - How to verify each step that changes something.
  - When to stop and report.
  - Why: one line on the reason this task exists. The `coder` uses it to see when a brief is wrong.
- When a `coder` report comes back, compare each step in the report with the brief, or with the brief file when there is one. If the report has a step that the brief did not ask for, or misses a step, stop and tell me.
- While a subagent still runs, or you plan to resume or spawn one, do not post a report or a question. Post one status line: what the subagent does now. Post the full report once, after every subagent finishes.
- Give each MCP tool call its own `coder`. Spawn independent calls in one message. Wait for a report before a call that needs its result.
- Browser automation (`playwright-cli`, Claude in Chrome) stays Level 3: ask first, then run it through `coder`.
- For code search or go to definition, delegate to the `coder` subagent. Spawn independent searches in one message. The main session may still `Read` a file with a known path. The brief must have:
  - The question in one sentence.
  - The identifiers to find, with name variants.
  - Path or extension limits, if any.
  - Why: one line on the reason for the search.
- Use the built-in `Explore` subagent only for broad sweeps that are not code: docs, config, transcripts. Explore and Plan do not load my CLAUDE.md. When you brief Explore, include the user rules that apply.
- Never pass the `model` parameter when you spawn any subagent, unless I ask for a specific model in that request. The agent file's `model:` frontmatter or `CLAUDE_CODE_SUBAGENT_MODEL` picks the model.
- If the user communicates in another language (e.g., Indonesian), continue the conversation in that language. However, whenever producing content in the following contexts, use English consistently:
  - Code: Including code comments and inline documentation.
  - Git: Including commit messages, branch names, and other Git-related content.
  - Documentation: Including content written for platforms such as Confluence or Google Docs.
  - Markdown files: All content written to .md files.

## Coder brief files

Use brief files for every edit and shell command that goes to `coder`. A code search, a single MCP call, and a single shell command keep the inline brief.

- One brief holds one business logic change, with at most 2 files and at most 5 steps. Split a bigger change into more briefs.
- Group the briefs in waves:
  - In one wave, a file is in at most one brief.
  - A brief that shares a file with an earlier brief, or needs its result, goes to a later wave.
- Each brief verifies with a local check only. Examples: lint on its own files, or a `grep` for the new text.
- The full build and tests run once, at the end:
  - The last wave has 1 coder: add them as the final step of that brief. This step does not count toward the 5-step limit.
  - The last wave has 2 or more coders: add a brief `99-build-test.md`, and run it alone as the final wave.
- Files go in `briefs/` in the session scratchpad folder. Always give the absolute path.
  - `00-index.md`: the brief files, grouped by wave, in run order.
  - `NN-<business-change>.md`: one brief, in the brief format from "General".
- Flow:
  1. Spawn one writer `coder`. Give it the full text of `00-index.md` and of every brief file. It writes these files and nothing else. Its own brief stays inline.
  2. Run `cat` on each brief file (Level 1). Compare it with the text you sent. On any difference, stop and tell me.
  3. Run the first wave. Spawn every coder of the wave in one message. Prompt: "Read `<absolute path>` and run it."
  4. After every coder of the wave reports, compare each report with its brief file. On a failed, missing, or extra step, stop and tell me. Do not start the next wave.
  5. Repeat steps 3 and 4 for each next wave.
  6. Post one full report: each brief with ✅ or ❌.

## Helicopter view: reuse before you add

Before you build something new, stop and think from above.

- Look at the whole picture first, not only the part in front of you.
- Ask: "Is there something that already exists that can do this?" Prefer to reuse, extend or adjust what is there.
- Give this question real thinking time before you choose. Do not jump to the first new idea.
- Choose the simplest change that solves the real problem. Something new is also something new to keep, explain and maintain.
- Make something new only when the existing parts cannot do the job, and say why in one sentence.
- When the user suggests a simpler path, take it seriously. Do not defend the first idea.

## Cheap actions

Do not ask "run the recommended action?" for a cheap action. Run it, then report.

- Level 1, read-only. Run it in the main session, without `coder`.
  - Examples: `ls`, `cat`, `git status`, `git diff`, `git log`, `gh ... view`, `sonar list`.
  - Limit the output. Example: `git log -n 20`, `LIMIT 50` in SQL.
  - A read-only MCP call, for example a SELECT query, needs no question but runs through `coder`. A code search runs through `coder` too.
  - Report: short findings.
- Level 2, a text edit that I can revert.
  - You showed its full text in an earlier turn. My reply did not ask for changes.
  - Examples: a PR body (`gh pr edit`), a Jira description, a local spec or markdown file.
  - Run it through `coder`. Do not ask "apply?" first.
  - Report: a `call-graph` in the "Change Output" form.
- Level 3, everything else. Ask first.
  - Examples: a new branch, a commit, a push, a new Jira issue, a Slack message, any delete, browser automation, Confluence pages, destructive actions.
  - Every PR action except a body edit: create, merge, close.
- Database queries:
  - Run only SELECT queries. `WITH … SELECT` counts as a SELECT query.
  - Never run `INSERT`, `UPDATE`, `DELETE`, `MERGE`, or DDL such as `CREATE`, `ALTER`, or `DROP`.
  - Do not use `FOR UPDATE`, and do not call functions that change data.
  - A SELECT query needs no question, on a dev DB and on a prod DB. Run it through `coder`.
  - Select only the columns you need. Do not use `SELECT *`.
  - Filter by date, partition, or key. Add a `LIMIT`.
  - Do not tell me before the query, even when another instruction file asks for it. Name the DB in the report.
- In a `/brainstorming` session, the brainstorming rules override this section.
