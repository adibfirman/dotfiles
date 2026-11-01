---
name: brainstorming
description: Stress-test a plan or idea with grilling and domain modeling.
disable-model-invocation: true
---

- Read [grilling](./grilling/SKILL.md) and [domain-modeling](./domain-modeling/SKILL.md). Follow both, except where this file says otherwise.
- Never create or write any file, even when `grilling` or `domain-modeling` says to (for example `GLOSSARY.md` or an ADR). This overrides both skills. Show the text in chat first. Exception: the recap file.
- Never ask an execution question in a question round. An execution question asks to run an action, for example "apply the drafts?" or "run this query?".
  - A Level 1 cheap action (see "Cheap actions" in `workflow.md`) is fact finding. Run it without a question.
  - Collect every other action for the recap.
- Do not ask any question while a subagent is still running. This overrides the "Don't block on it" rule in `grilling/SKILL.md`.
  - Wait until every subagent finishes.
  - If a subagent runs for more than 5 minutes, tell the user which subagent is still running and what it searches for. Do not ask a question. Then keep waiting.
  - Keep every question, also the ones that an agent result answered. Mark an answered question with ✅, show the finding with a `file:line` link, and use the finding as the recommended answer. The user confirms or corrects it.
  - Ask the questions in one round, in the `grilling` format. Ask at most 5 open questions per round. ✅ questions do not count toward this limit. Ask first the open questions that unblock the most other questions. Keep the rest for the next round.
- When a question is about a flow, a call path, or a dependency, add a diagram in the `call-graph` skill format. A diagram is often clearer than text alone.
- Before each question round, check:
  - Do I look at the whole system? Check every rule, file, and flow that the topic changes or uses, not only the file the user named. Never narrow the scope on my own.
  - Do I stop at the first result I found, or did I search broadly enough?
  - What did I expect to find but didn't?
  - What related code have I NOT read that could change my understanding? Hint: search with at least 3 different patterns, read callers AND callees, and check tests for behavior that tests expect but no doc states.
  - If a function comes from a dependency or a third-party package, check its docs with Context7 first. Use web docs only when Context7 has nothing.
- When the user confirms a shared understanding, post a short recap in chat. Put in it: the decisions, the open risks, the actions to run with their level, and the next step.
  - Show the final design in the `call-graph` skill format.
  - End with one execution statement for all the actions. Write it as a plain statement, not a question, and not in the `grilling` question format. Example: "Say yes and I run actions 1 to 4."
  - Run the actions only after the user says yes.
  - Save each recap to `~/.claude/plans/<topic>-recap.md`. Do not ask first. After a compact, read this file again.
- When the user adds a request or a question after a recap, do not treat it as a separate topic.
  - Load the last recap as context. If it is not in context, read the recap file.
  - Continue the brainstorming from that recap. Ask a new question round when there are new decisions.
  - Post a new full recap that merges the last recap and the new decisions. Do not post only the difference.
- Put questions only at the end of the response, never in the middle of a topic or an explanation.
- When a question has options, put each option on its own line, never in the same paragraph.
