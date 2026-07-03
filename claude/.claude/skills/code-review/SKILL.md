---
name: code-review
description: Use when reviewing code, diffs, PRs, branches, or pasted snippets; detects the language or framework and routes to the relevant technical review skills.
---

# Code Review

General routing skill for code review workflows. Every review must apply both
sets of guidance: the skills under this `code-review/` directory and the
matching programming-language or framework-specific skills. Use this skill to
inspect the review target and route to those sources instead of duplicating
review guidance here.

## Routing

- For Go code, use [`technical/golang`](../technical/golang/).
- For React web code, use [`react-best-practices`](../technical/react/react-best-practices/).
- For React Native code, use [`react-native-best-practices`](../technical/react/react-native-best-practices/).
- For React or React Native component API and composition concerns, use [`composition-patterns`](../technical/react/composition-patterns/).
- For simplification, slop removal, verbose code, redundant checks, or over-engineering, use [`deslop-simplify-ai-code`](./deslop-simplify-ai-code/).
- For branch, PR, or work-in-progress reviews against a fixed point and originating spec, use [`spec-of-code`](./spec-of-code/).

## Process

1. Determine the review scope: pasted code, selected files, git diff, PR, branch, or repository area.
2. Inspect the target before choosing a specialized skill.
3. Infer the primary language, framework, and review concern from filenames, imports, package manifests, and code patterns.
4. If the review asks for changes since a commit, branch, tag, merge-base, issue, PRD, or spec, route to `spec-of-code` first.
5. Always load and apply the relevant skills under this `code-review/` directory before writing findings.
6. Always load and apply the matching programming-language or framework-specific skills before writing findings.
7. Route to every relevant specialized skill when the review spans multiple ecosystems or concerns.
8. Ask one concise clarification question if the target or intended review focus is ambiguous.
9. After the review, mention the source skill or skills used for the review, using their skill names or paths.

## Output

- Findings remain the primary focus, ordered by severity with file and line references.
- Include a concise `Review sources` line naming both the `code-review/` skills and the programming-language or framework-specific skills that informed the review.
