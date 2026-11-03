# Chat messages

Rules for every message I post to a chat platform, for example Slack.

## Markup

- The Slack MCP tools take standard markdown. Use `**bold**`, `_italic_`, `` `code` ``, and `[text](url)`.
- Never use Slack mrkdwn: no `*bold*`, no `<url|text>`. Never post a bare URL.
- Do not use headers or tables. Slack can drop the blank line before a header, and wide tables are hard to read on a phone.
- When you brief the `coder` subagent, give the exact message text in standard markdown. Do not write "Slack mrkdwn" in the brief.

## Language and style

- Write in English, unless I ask for another language.
- Follow the `/bro` rules and the glossary.
- No preamble and no closing pleasantries.
- Never add an attribution line such as "Sent using Claude".
- Never quote a secret, a token, or exploit steps in a chat message. Link to the PR comment instead.

## Send flow

1. Show the full message text in the chat.
2. Send it only after I say yes. A Slack message is a Level 3 action.
3. Reply in the thread I shared, with `reply_broadcast: false`, unless I ask to post in the channel.
4. After sending, give me the message link.
