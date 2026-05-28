---
name: code-review
description: Use when reviewing code, diffs, PRs, branches, or pasted snippets; detects the language or framework and routes to the relevant technical review skills.
---

# Code Review

General routing skill for code review workflows. Use this skill to inspect the
review target, identify the language or framework, and then apply the most
relevant specialized skill instead of duplicating review guidance here.

## Routing

- For Go code, use [`technical/golang`](../technical/golang/).
- For React web code, use [`react-best-practices`](../technical/react/react-best-practices/).
- For React Native code, use [`react-native-best-practices`](../technical/react/react-native-best-practices/).
- For React or React Native component API and composition concerns, use [`composition-patterns`](../technical/react/composition-patterns/).
- For simplification, slop removal, verbose code, redundant checks, or over-engineering, use [`deslop-simplify-ai-code`](./deslop-simplify-ai-code/).

## Process

1. Determine the review scope: pasted code, selected files, git diff, PR, branch, or repository area.
2. Inspect the target before choosing a specialized skill.
3. Infer the primary language, framework, and review concern from filenames, imports, package manifests, and code patterns.
4. Route to every relevant specialized skill when the review spans multiple ecosystems or concerns.
5. Ask one concise clarification question if the target or intended review focus is ambiguous.
