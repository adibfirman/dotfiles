---
name: brainstorming
description: Stress-test a plan or idea with grilling and domain modeling.
disable-model-invocation: true
---

- Read [grilling](./grilling/SKILL.md) and [domain-modeling](./domain-modeling/SKILL.md). Follow both, except where this file says otherwise.
- Never create or write any file, even when `grilling` or `domain-modeling` says to (for example `GLOSSARY.md` or an ADR). Show the text in chat first. Write the file only after the user says yes. This overrides both skills.
- Do not ask any question while a subagent is still running. This overrides the "Don't block on it" rule in `grilling/SKILL.md`.
  - Wait until every subagent finishes.
  - If a subagent runs for more than 5 minutes, tell the user which subagent is still running and what it searches for. Do not ask a question. Then keep waiting.
  - Keep every question, also the ones that an agent result answered. Mark an answered question with ✅, show the finding with a `file:line` link, and use the finding as the recommended answer. The user confirms or corrects it.
  - Ask the questions in one round, in the `grilling` format. Ask at most 5 open questions per round. ✅ questions do not count toward this limit. Ask first the open questions that unblock the most other questions. Keep the rest for the next round.
- When a question is about a flow, a call path, or a dependency, add a diagram in the `call-graph` skill format. A diagram is often clearer than text alone.
- Before each question round, check:
  - Am I anchoring on the first thing I found, or did I search broadly enough?
  - What did I expect to find but didn't?
  - What related code have I NOT read that could change my understanding? Hint: search with at least 3 different patterns, read callers AND callees, check tests for implicit contracts.
- At the end of the session, when the user confirms a shared understanding, post a short summary in chat: the decisions made, the open risks, and the next step. Include a recap of the final design in the `call-graph` skill format. Offer to save the summary as a file. Write the file only if the user says yes.
