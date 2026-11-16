import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Refused, type Run } from "./append";
import { listRepos, runMeta, updateMeta } from "./repos";
import { forgeHome } from "./sources";
import { agentPath } from "./env";
import { hc, isLive } from "./spawn";
import { status } from "./status";

// The run chat: the user's own claude (their settings, skills, MCP, model, permission prompts), started in the
// run's worktree with a brief about the run. It may edit like any claude; `forge followup` refuses while edits are
// not committed. One conversation per run: its session id is kept in run.json, so every later open resumes it.

/** Only forge's own coordinator commands are blocked: they change the run's state behind its coordinators. */
export const CHAT_DENY = ["append", "spawn", "coord", "reconcile"].map((c) => `Bash(forge ${c}:*)`);

const claudeHome = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");

/** Whether claude saved a conversation with this id (any project folder), so it can be resumed. */
export function sessionSaved(id: string, root = join(claudeHome(), "projects")): boolean {
  if (!existsSync(root)) return false;
  return readdirSync(root).some((d) => existsSync(join(root, d, `${id}.jsonl`)));
}

/** The run's chat session: the one in run.json, or a new id written there now. */
export function chatSession(run: Run): { session: string; resume: boolean } {
  const cur = runMeta(run).chat ?? {};
  const session = typeof cur.session === "string" && /^[0-9a-f-]{36}$/.test(cur.session) ? cur.session : randomUUID();
  if (session !== cur.session) updateMeta(run, { chat: { ...cur, session } });
  return { session, resume: sessionSaved(session) };
}

/** The brief the chat gets as its system prompt: roles/_chat.md, then the run's facts and file paths. */
export function chatBrief(run: Run): string {
  const s = status(run) as any;
  const spec = s.spec ?? {};
  const execDir = join(s.cyclePath, "exec");
  const prs = existsSync(execDir) ? readdirSync(execDir).filter((f) => /^PR.*\.md$/.test(f) || f === "review-notes.md" || f === "plan.md").map((f) => join(execDir, f)) : [];
  const template = join(forgeHome(), "roles", "_chat.md");
  const facts = [
    "## This run",
    "",
    `- Ticket: ${run.ticket}`,
    `- Run folder: ${run.dir} (cycles/<NNN-slug>/ hold each cycle: context.md, grill/, verify/, gate, exec/)`,
    `- Mode: ${s.mode}; grill: ${s.grill}; checks: ${s.checks}`,
    `- Now: cycle ${s.cycle} (${s.cycleDir}), phase ${s.phase}${s.approved ? ", spec approved" : ""}`,
    `- Code: ${run.worktree}`,
    ...(s.repos ?? []).map((r: any) => `  - ${r.name}: ${r.worktree} (branch ${r.branch ?? "?"}, base ${r.base})`),
    `- Spec: ${spec.approved ?? spec.gate ?? spec.draft ?? "none yet"}`,
    ...prs.map((p) => `- ${p}`),
    "",
    "Run `forge status` and `forge history` for the state now. They may be newer than this brief.",
  ];
  const text = `${existsSync(template) ? readFileSync(template, "utf8").trim() : ""}\n\n${facts.join("\n")}\n`;
  const file = join(run.dir, "chat-brief.md");
  writeFileSync(file, text);
  return file;
}

/** The claude argv for the chat (no --setting-sources: the user's own setup loads). */
export function chatArgs(run: Run): { args: string[]; cwd: string; session: string; resume: boolean } {
  const { session, resume } = chatSession(run);
  const brief = chatBrief(run);
  // FORGE_RUN so `forge followup` and `forge status` find this run; PATH because hc terminals start with a short one.
  const path = agentPath();
  const settings = join(run.dir, "chat-settings.json");
  writeFileSync(settings, JSON.stringify({ env: { FORGE_RUN: run.dir, PATH: path } }, null, 2) + "\n");
  const dirs = [...new Set([run.dir, ...listRepos(run).map((r) => r.worktree)])].filter((d) => d !== run.worktree && existsSync(d));
  // Variadic flags are each followed by another flag.
  const args = [
    ...(resume ? ["--resume", session] : ["--session-id", session]),
    "--disallowedTools", ...CHAT_DENY,
    ...(dirs.length ? ["--add-dir", ...dirs] : []),
    "--settings", settings,
    "--append-system-prompt-file", brief,
  ];
  return { args, cwd: run.worktree, session, resume };
}

/** `forge chat`: the chat in this terminal. Returns claude's exit code. */
export function chatHere(run: Run): number {
  const { args, cwd } = chatArgs(run);
  const r = spawnSync(process.env.FORGE_CLAUDE ?? "claude", args, { cwd, stdio: "inherit", env: { ...process.env, FORGE_RUN: run.dir } });
  return r.status ?? 1;
}

/**
 * `forge chat --open`: the chat in its own hc terminal (labeled forge=<ticket>/chat, so the Agents list shows it),
 * for the run window. A chat terminal that is still live is reused. message: the chat's next prompt (the first
 * prompt of a new chat, or sent to a live one).
 */
export function openChat(run: Run, message?: string): { terminal: string; session: string; reused: boolean } {
  const cur = runMeta(run).chat ?? {};
  if (typeof cur.terminal === "string" && cur.session && isLive(cur.terminal)) {
    if (message && hc(["send", cur.terminal, message]).code !== 0) throw new Refused(`could not send the message to the chat ${cur.terminal}`);
    return { terminal: cur.terminal, session: cur.session, reused: true };
  }
  const { args, cwd, session } = chatArgs(run);
  const name = `f-${run.ticket}-chat`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 32);
  const r = hc([
    "run", "--bg", "--json", "--name", name, "--cwd", cwd, "--label", `forge=${run.ticket}/chat`,
    "--outlive-parent", "--no-notify",
    "claude", ...args, ...(message ? [message] : []),
  ]);
  if (r.code !== 0) throw new Refused(`hc run failed for the chat: ${r.err || r.out}`);
  let info: Record<string, any> = {};
  try {
    info = JSON.parse(r.out);
  } catch {
    /* hc printed text: keep the name as the address */
  }
  const terminal = String(info.id ?? info.terminal ?? info.address ?? name);
  updateMeta(run, { chat: { ...(runMeta(run).chat ?? {}), session, terminal } });
  return { terminal, session, reused: false };
}
