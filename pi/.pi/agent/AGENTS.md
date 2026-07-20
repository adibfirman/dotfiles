# Global Workflow

## Planning and changes

- For non-trivial work, investigate first and present a plan before changing files or system state.
- Wait for an explicit implementation command such as "implement it", "proceed", or "apply the plan" before making non-trivial changes.
- Ask one clarification at a time when a decision is required. Discover facts from the environment instead of asking the user.
- If evidence invalidates the plan, stop and re-plan rather than expanding scope silently.
- Before implementing in a Git repository, inspect the current branch and worktree, then ask whether to use the current branch or create a new one.
- Never commit or push unless explicitly requested.

## Boundaries and safety

- Keep filesystem reads and searches inside the current project unless the user explicitly authorizes another path.
- Do not traverse parent directories or inspect unrelated absolute paths. Global harness configuration may be inspected only when the task is about that configuration.
- Never read or print likely secret files, credentials, private keys, tokens, or untracked secret profiles without explicit authorization for that exact access. Prefer tracked example files and redact accidentally encountered values.
- Never start a development server unless explicitly requested.

## Implementation and verification

- Make the smallest correct change and preserve existing project conventions.
- After implementation approval, run relevant scoped, non-destructive formatting, linting, type-checking, tests, and configuration validation automatically.
- Do not run broad or expensive integration suites without warning, or update snapshots and generated files unless they are part of the approved plan.
- Report what was verified and what remains unverified.
- Use `pm` for package-manager dependency and lifecycle commands. Do not replace one-off package executors such as `npx`, `pnpm dlx`, `yarn dlx`, or `bunx`.
