# skills (forge default)

Skills from `~/.claude/skills/<name>` that forge agents load. `forge spawn` links them into
`~/.local/share/forge/skills-plugin/` at run time and passes that folder with `--plugin-dir`.
Agents call them as `forge-skills:<name>`. A name that is not installed is skipped.

- brainstorming
- call-graph
- code-review
- technical
