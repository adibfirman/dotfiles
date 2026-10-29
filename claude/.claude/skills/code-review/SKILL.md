---
name: code-review
description: Use when reviewing code, diffs, PRs, branches, or pasted snippets; detects the language or framework and routes to the relevant technical review skills.
argument-hint: "[security full audit] [submit <PR>] [path...] [quick|standard|deep]"
---

# Code Review

General routing skill for code review workflows. Every review must apply both
sets of guidance: the skills under this `code-review/` directory and the
matching programming-language or framework-specific skills. `technical` is the
only router for language and framework skills. This skill routes only to the
skills under `code-review/`, and calls `Skill(technical)` for the rest.

## Routing

- For language and framework skills, call `Skill(technical)`. It picks the matching skills for the files under review. Do not link or load a language or framework skill from this file.
- For every review, in any language, use [`security-audit`](./security-audit/). The Modes section below picks which of its two modes applies.
- For simplification, slop removal, verbose code, redundant checks, or over-engineering, use [`deslop-simplify-ai-code`](./deslop-simplify-ai-code/).
- For branch, PR, or work-in-progress reviews against a fixed point and originating spec, use [`spec-of-code`](./spec-of-code/).

## Modes

The invocation arguments pick the mode.

### Default: changed files only

Use this mode when the arguments do not contain the phrase `full audit` and the first argument is not `submit`.

- Scope: the changed files of the diff, PR, branch, or pasted code.
- Load `security-audit` in its guidance mode. Apply its core principles and the matching attack classes to the changed files. Do not run its six phases, do not create an output directory, and do not write audit artifacts.
- Tell `technical` that the review includes a security check. It loads the language security checklist. `security-audit` owns the verdict and severity rules.

### Full audit: `/code-review security full audit [path...] [quick|standard|deep]`

Use this mode only when the arguments contain the phrase `full audit`.

- Scope: the whole repository. Each path argument limits the scope to that path. Record everything outside the scope as `out_of_scope`.
- Profile: `standard`, unless the arguments contain `quick` or `deep`.
- Run `security-audit` in its full audit mode: all six phases, the coverage ledger, `findings.json`, and the report files. Output goes to its default directory `~/security-audit-skill/<repo-name>/run-<N>`.
- `security-audit` owns orchestration, verdicts, and severity. Call `Skill(technical)` for the target language's security checklist, and give it to the hunters as input. Do not run a separate audit mode from a language skill.

### Submit: `/code-review submit <PR URL or number>`

Use this mode when the first argument is `submit`, or when the user asks to send a finished review to a pull request.

This mode is not a way to review code. Use it only after a review was done in this session. If no review was done yet, run the default mode first, then ask the user before you submit.

1. Before you submit, check whether the pull request is already merged or closed, for example with `gh pr view <PR> --json state,mergedAt`. If it is merged or closed, do not submit. Tell the user.
2. Use the verdict from the review already done in this session: approve, request changes, or comment. If the user asks for a different verdict, follow the user.
3. Do not run the review again before you submit.
4. Put each finding as an inline comment on its file and line. Put the summary and the verdict in the review body.
5. After you submit, if the user shared a chat link such as a Slack thread, ask whether they want a recap posted there.

## Process

1. Determine the review scope: pasted code, selected files, git diff, PR, branch, or repository area.
2. Inspect the target before choosing a specialized skill.
3. Infer the primary language, framework, and review concern from filenames, imports, package manifests, and code patterns.
4. If the review asks for changes since a commit, branch, tag, merge-base, issue, PRD, or spec, route to `spec-of-code` first.
5. Always load and apply the relevant skills under this `code-review/` directory before writing findings. In full audit mode, that is `security-audit` only.
6. Always call `Skill(technical)` and apply the language or framework skills it loads before writing findings.
7. Route to every relevant specialized skill when the review spans multiple ecosystems or concerns.
8. Ask one concise clarification question if the target or intended review focus is ambiguous.
9. After the review, mention the source skill or skills used for the review, using their skill names or paths.

## Output

- Findings remain the primary focus, ordered by severity with file and line references.
- Include a concise `Review sources` line naming both the `code-review/` skills and the programming-language or framework-specific skills that informed the review. Always name `code-review/security-audit` in that line, also when the review has no security finding.

## Attribution

- Never add an attribution line such as "Reviewed with Claude Code", "Sent using Claude", "Generated with Claude Code", or a `Co-Authored-By` trailer to a review body, an inline comment, a PR comment, or a chat message about the review.
- This applies even when other reviewers in the same thread use such a line.
