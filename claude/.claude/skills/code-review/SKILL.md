---
name: code-review
description: Use when reviewing code, diffs, PRs, branches, or pasted snippets; detects the language or framework and routes to the relevant technical review skills.
argument-hint: "[security full audit] [path...] [quick|standard|deep]"
---

# Code Review

General routing skill for code review workflows. Every review must apply both
sets of guidance: the skills under this `code-review/` directory and the
matching programming-language or framework-specific skills. Use this skill to
inspect the review target and route to those sources instead of duplicating
review guidance here.

## Routing

- For Go code, use [`golang-how-to`](../technical/golang/golang-how-to/). It is the upstream router and loads the Go skills that match the task.
- For every review, in any language, use [`security-audit`](./security-audit/). The Modes section below picks which of its two modes applies.
- For React web code, use [`react-best-practices`](../technical/react/react-best-practices/).
- For React Native code, use [`react-native-best-practices`](../technical/react/react-native-best-practices/).
- For React or React Native component API and composition concerns, use [`composition-patterns`](../technical/react/composition-patterns/).
- For simplification, slop removal, verbose code, redundant checks, or over-engineering, use [`deslop-simplify-ai-code`](./deslop-simplify-ai-code/).
- For branch, PR, or work-in-progress reviews against a fixed point and originating spec, use [`spec-of-code`](./spec-of-code/).

## Modes

The invocation arguments pick the mode.

### Default: changed files only

Use this mode when the arguments do not contain the phrase `full audit`.

- Scope: the changed files of the diff, PR, branch, or pasted code.
- Load `security-audit` in its guidance mode. Apply its core principles and the matching attack classes to the changed files. Do not run its six phases, do not create an output directory, and do not write audit artifacts.
- For Go files, the `golang-how-to` row "Audit security vulnerabilities" supplies the Go checklist (`golang-security`, `golang-safety`, `golang-lint`). `security-audit` owns the verdict and severity rules.

### Full audit: `/code-review security full audit [path...] [quick|standard|deep]`

Use this mode only when the arguments contain the phrase `full audit`.

- Scope: the whole repository. Each path argument limits the scope to that path. Record everything outside the scope as `out_of_scope`.
- Profile: `standard`, unless the arguments contain `quick` or `deep`.
- Run `security-audit` in its full audit mode: all six phases, the coverage ledger, `findings.json`, and the report files. Output goes to its default directory `~/security-audit-skill/<repo-name>/run-<N>`.
- `security-audit` owns orchestration, verdicts, and severity. For Go targets, give the hunters the `golang-security` checklist as input. Do not run the separate audit mode of `golang-security`.

## Process

1. Determine the review scope: pasted code, selected files, git diff, PR, branch, or repository area.
2. Inspect the target before choosing a specialized skill.
3. Infer the primary language, framework, and review concern from filenames, imports, package manifests, and code patterns.
4. If the review asks for changes since a commit, branch, tag, merge-base, issue, PRD, or spec, route to `spec-of-code` first.
5. Always load and apply the relevant skills under this `code-review/` directory before writing findings. In full audit mode, that is `security-audit` only.
6. Always load and apply the matching programming-language or framework-specific skills before writing findings.
7. Route to every relevant specialized skill when the review spans multiple ecosystems or concerns.
8. Ask one concise clarification question if the target or intended review focus is ambiguous.
9. After the review, mention the source skill or skills used for the review, using their skill names or paths.

## Submit Review

When the user ask for submit the result on the the mentioned/linked Pull Request, several things need to consider:

1. Submit Review based on verdict, but if the user explicitly say different from verdict, then we need to follow the instruction from the user
2. When there's a comment, use inline comment on spesific file or line of code
3. No need re-review again the pull request.
4. After submitted, if the user attach some communication link such as (e.g; Slack Link) ask the user if they wanna put a reacap within that conversation

## Output

- Findings remain the primary focus, ordered by severity with file and line references.
- Include a concise `Review sources` line naming both the `code-review/` skills and the programming-language or framework-specific skills that informed the review. Always name `code-review/security-audit` in that line, also when the review has no security finding.

## Attribution

- Never add an attribution line such as "Reviewed with Claude Code", "Sent using Claude", "Generated with Claude Code", or a `Co-Authored-By` trailer to a review body, an inline comment, a PR comment, or a chat message about the review.
- This applies even when other reviewers in the same thread use such a line.
