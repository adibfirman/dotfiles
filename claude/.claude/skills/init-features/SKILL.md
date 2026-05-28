---
name: init-features
description: Use when starting a feature: first grill the idea with docs, then turn the clarified feature into a PRD.
---

# Init Features

This skill orchestrates two nested skills from `mattpocock/skills`, MIT License:

- `grill-with-docs`
- `to-prd`

Use it to turn a feature idea into a clarified, documented PRD.

## Flow

First, use `./grill-with-docs/SKILL.md` to question the feature idea. Challenge assumptions against repo docs, code, domain language, and architectural decisions. Ask one question at a time, and provide a recommended answer with each question.

When the feature is clear enough and the user agrees the grilling phase is done, use `./to-prd/SKILL.md` to synthesize the clarified context into a PRD.

## Rules

- Do not skip the grilling phase unless the user explicitly asks for a PRD only.
- If a question can be answered by exploring the codebase, explore the codebase instead of asking.
- Keep documentation updates from `grill-with-docs` inline as decisions crystallize.
- Draft the PRD by default. Publish it to an issue tracker only if the project issue tracker setup is known and the user explicitly asks you to publish.
