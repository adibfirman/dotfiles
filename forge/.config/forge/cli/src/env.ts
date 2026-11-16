import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// The PATH agents get. A run can start from a terminal (full PATH), from a Herdr button, or from the chat that a
// button opened (Herdr's short PATH, without what the shell profile adds: nvm, pyenv, goenv, cargo, ...). So the
// login shell's PATH comes first, read once per forge process, then the caller's. FORGE_NO_SHELL_ENV turns the
// shell read off (tests).

let shellPath: string[] | null = null;

/** The PATH of the user's interactive login shell, or [] when it cannot be read. */
export function loginShellPath(): string[] {
  if (shellPath) return shellPath;
  shellPath = [];
  if (process.env.FORGE_NO_SHELL_ENV) return shellPath;
  // A marker first: an interactive shell may print a banner before the value.
  const r = spawnSync(process.env.SHELL || "/bin/zsh", ["-ilc", `printf '\\0FORGE-PATH\\0%s' "$PATH"`], { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] });
  const out = (r.stdout ?? "").split("\0FORGE-PATH\0")[1] ?? "";
  shellPath = out.trim().split(":").filter(Boolean);
  return shellPath;
}

/** ~/.bun/bin (forge itself runs on bun), the login shell's PATH, then the caller's: no duplicates. */
export function agentPath(): string {
  const bunBin = join(homedir(), ".bun", "bin");
  return [...new Set([...(existsSync(bunBin) ? [bunBin] : []), ...loginShellPath(), ...(process.env.PATH ?? "").split(":").filter(Boolean)])].join(":");
}

/** Whether a program is on the agent PATH. */
export function onAgentPath(program: string): string | null {
  for (const dir of agentPath().split(":")) {
    const f = join(dir, program);
    if (existsSync(f)) return f;
  }
  return null;
}
