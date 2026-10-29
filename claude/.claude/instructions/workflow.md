# Workflow

## No plan mode

- NEVER enter plan mode. Do not use `EnterPlanMode` or `ExitPlanMode` at any time.
- Write the plan as plain text in the chat, not in plan mode.
- If something goes sideways, STOP and tell me. Don't keep pushing.
- Always ask questions to get more clarity.
- Write detailed specs upfront to reduce ambiguity.
- Always break down tasks with their dependencies.

## General

- after the execution of the plan always put it on plan folder ~/.Claude/plans/ as a reference in the futures of planning
- Never, ever, under any circumstances, ever, not once, no matter what, try to start the fucking dev server.
- DO NOT CREATE ANY claude ARTIFACTS until me allow it do it
- Do NOT use the AskUserQuestion tool. When you have a question for the user, write the raw question directly in the chat as plain text instead.
- For every code edit, shell command, or MCP tool call, delegate to the `coder` subagent. Do not run them in the main session. The brief must have:
  - Numbered steps, in the order to run them.
  - For each step: the file path and the exact code (old and new text), or the exact command. A read-only step may give the goal and the paths instead.
  - How to verify each step that changes something.
  - When to stop and report.
- Never pass the `model` parameter when you spawn any subagent, unless I ask for a specific model in that request. The agent file's `model:` frontmatter or `CLAUDE_CODE_SUBAGENT_MODEL` picks the model.
- If the user communicates in another language (e.g., Indonesian), continue the conversation in that language. However, whenever producing content in the following contexts, use English consistently:
  - Code: Including code comments and inline documentation.
  - Git: Including commit messages, branch names, and other Git-related content.
  - Documentation: Including content written for platforms such as Confluence or Google Docs.
  - Markdown files: All content written to .md files.
