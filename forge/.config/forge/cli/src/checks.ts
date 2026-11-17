import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadState, readLines, type Run } from "./append";
import { commandLike, projectForced } from "./config";
import { agentPath, onAgentPath } from "./env";
import { childRepos, isRepo, listRepos } from "./repos";
import { blockersOf, deniedBy, denyFloor, denyRules, effectiveDeny, forgeHome, mergeSources, NEVER_LIFT, ruleOf, safeScript } from "./sources";

// Agents run in bypass mode, so what blocks them is the environment (a program not on their PATH, a login that ran
// out) or a deny rule. These give agents the repo's check commands, find a missing program before any agent runs
// (`forge doctor`), surface a "needs" block, and keep one line per lesson so a repo's next run does not hit the same
// block.

export interface Checks { repo: string; worktree: string; test: string | null; typecheck: string | null; lint: string | null; build: string | null; other: string[]; programs: string[] }

/** The repo's own check commands (test, typecheck, lint, build), so every agent runs the same ones. */
export function checkCommands(worktree: string): Checks {
  const c: Checks = { repo: basename(worktree), worktree, test: null, typecheck: null, lint: null, build: null, other: [], programs: [] };
  const pkg = join(worktree, "package.json");
  if (existsSync(pkg)) {
    const pm = existsSync(join(worktree, "bun.lock")) || existsSync(join(worktree, "bun.lockb")) ? "bun"
      : existsSync(join(worktree, "pnpm-lock.yaml")) ? "pnpm"
      : existsSync(join(worktree, "yarn.lock")) ? "yarn" : "npm";
    const scripts = Object.keys(JSON.parse(readFileSync(pkg, "utf8")).scripts ?? {});
    const run = (s: string) => (pm === "npm" ? `npm run ${s}` : `${pm} ${s}`);
    if (scripts.includes("test")) c.test = `${pm} test`;
    const tc = scripts.find((s) => /^(typecheck|type-check|check-types|types|tsc)$/.test(s));
    c.typecheck = tc ? run(tc) : existsSync(join(worktree, "tsconfig.json")) ? "npx tsc --noEmit" : null;
    const lint = scripts.find((s) => /^lint$/.test(s)) ?? scripts.find((s) => /^lint:/.test(s) && safeScript(s));
    if (lint) c.lint = run(lint);
    if (scripts.includes("build")) c.build = run("build");
    c.programs.push(pm, ...(pm === "bun" ? [] : ["node"]));
  }
  if (existsSync(join(worktree, "go.mod"))) {
    c.test ??= "go test ./...";
    c.typecheck ??= "go vet ./...";
    c.lint ??= "gofmt -l .";
    c.build ??= "go build ./...";
    c.programs.push("go", "gofmt");
  }
  const make = join(worktree, "Makefile");
  if (existsSync(make)) {
    const targets = [...readFileSync(make, "utf8").matchAll(/^([A-Za-z0-9_.-]+):(?!=)/gm)].map((m) => m[1]).filter(safeScript);
    c.other.push(...targets.map((t) => `make ${t}`));
    if (targets.length) c.programs.push("make");
  }
  if (["", "script", "scripts"].some((d) => existsSync(join(worktree, d)) && readdirSync(join(worktree, d)).some((f) => /^Dockerfile(\..+)?$/.test(f)))) c.programs.push("docker");
  c.programs = [...new Set(c.programs)];
  return c;
}

/** The repos a run's checks are for: each repo worktree of a workspace run, else the run's worktree. */
export function runChecks(run: Run, repo?: string): Checks[] {
  const repos = listRepos(run);
  if (repos.length) return repos.filter((r) => !repo || r.name === repo).map((r) => ({ ...checkCommands(r.worktree), repo: r.name }));
  return [checkCommands(run.worktree)];
}

/** The repos to check before a run exists: the folder itself, or the named child repos of a workspace root. */
export function folderChecks(folder: string, repos: string[] = []): Checks[] {
  if (isRepo(folder)) return [checkCommands(folder)];
  // A workspace root: only the repos named for the run (none named: only claude, hc, and git are checked).
  const kids = childRepos(folder).filter((p) => repos.includes(basename(p)));
  return kids.map(checkCommands);
}

export interface DoctorItem { name: string; ok: boolean; detail: string }

/**
 * Whether agents can work here: claude, hc, git, and every program the repos' checks need, on the agents' PATH;
 * gh logged in when a repo has a GitHub remote (Push and Create PR need it); the docker daemon when a repo ships
 * a Dockerfile.
 */
export function doctor(checks: Checks[]): { ok: boolean; path: string; items: DoctorItem[] } {
  const path = agentPath();
  const env = { ...process.env, PATH: path };
  const items: DoctorItem[] = [];
  const programs = [...new Set(["claude", "hc", "git", ...checks.flatMap((c) => c.programs)])];
  for (const p of programs) {
    const at = onAgentPath(p);
    items.push({ name: p, ok: Boolean(at), detail: at ?? "not found on the agents' PATH" });
  }
  const github = checks.some((c) => /github\.com/.test(spawnSync("git", ["remote", "get-url", "origin"], { cwd: c.worktree, encoding: "utf8" }).stdout ?? ""));
  if (github && onAgentPath("gh")) {
    const r = spawnSync("gh", ["auth", "status"], { encoding: "utf8", env, timeout: 20_000 });
    items.push({ name: "gh auth", ok: r.status === 0, detail: r.status === 0 ? "logged in" : "not logged in: run `gh auth login`" });
  } else if (github) items.push({ name: "gh", ok: false, detail: "not found on the agents' PATH (Push and Create PR need it)" });
  if (programs.includes("docker") && onAgentPath("docker")) {
    const r = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8", env, timeout: 15_000 });
    items.push({ name: "docker daemon", ok: r.status === 0, detail: r.status === 0 ? `running (${r.stdout.trim()})` : "not running: start Docker" });
  }
  return { ok: items.every((i) => i.ok), path, items };
}

/**
 * floor: what the user can do about it. "lift": the deny floor blocks it ("Lift for this repo"); "project": this
 * repo's own `- deny:` entry blocks it (remove that entry); "never": NEVER_LIFT blocks it; "env": no rule blocks it,
 * so it is the environment (a missing program, a login) or a note: fix that, then restart.
 */
/** key: what a lift of `prefix` names in `forge config force`: "tools" for a tool rule (`mcp__…`, `WebFetch`), else "bash". */
export interface Needs { role: string; tool: string; command: string; prefix: string; key: "bash" | "tools"; phase: string; floor: "lift" | "project" | "never" | "env"; deniedBy?: string; text: string; at: string }

/**
 * The command prefix a rule names: the program and up to 2 subcommands ("kubectl get pods", not "kubectl", which
 * would also cover its write commands). Arguments, paths, and flags end it.
 */
export function allowPrefix(command: string): string {
  const words = command.trim().replace(/^`|`$/g, "").split(/\s+/);
  const out = [words[0]];
  for (const w of words.slice(1, 3)) {
    if (!/^[A-Za-z][\w:-]*$/.test(w)) break;
    out.push(w);
  }
  return out.join(" ");
}

/**
 * The run's open "needs" block: the newest `blocked: <role> needs <tool>: <command>` comment of the current cycle,
 * unless a coordinator or a node started after it (someone already acted on it).
 */
export function needsOf(run: Run): Needs | null {
  let cycleDir: string;
  let phase: string;
  try {
    const s = loadState(run);
    cycleDir = s.cycleDir;
    phase = s.state.phase;
  } catch {
    return null;
  }
  const evs = readLines(join(cycleDir, "events.jsonl")).map((l) => JSON.parse(l));
  let found: { e: any; i: number } | null = null;
  evs.forEach((e, i) => {
    if (e.kind === "comment" && /^blocked:/i.test(String(e.data?.text ?? ""))) found = { e, i };
  });
  if (!found) return null;
  const { e, i } = found as { e: any; i: number };
  if (evs.slice(i + 1).some((x) => x.kind === "coord_start" || x.kind === "node_start")) return null;
  const text = String(e.data.text);
  const m = /^blocked:\s*(\S+)\s+needs\s+(.+?)(?::\s*(.+))?$/i.exec(text.split("\n")[0]);
  const command = (m?.[3] ?? m?.[2] ?? "").trim().replace(/^`|`$/g, "");
  const prefix = allowPrefix(command);
  // Match the whole command or tool (a rule covers a command that starts with it, or a tool of its MCP server);
  // the prefix is what a lift names.
  const rule = ruleOf(command);
  const floorRules = effectiveDeny(denyFloor(join(forgeHome(), "deny-floor.json")), projectForced(run.main, phase).flatMap((f) => f.lifts));
  const projectRules = denyRules(mergeSources([existsSync(join(run.main, ".forge", "SOURCES.md")) ? readFileSync(join(run.main, ".forge", "SOURCES.md"), "utf8") : ""], [phase, "all"]));
  const by = (rules: string[]) => rules.find((r) => deniedBy(rule, [r]));
  // NEVER_LIFT rules count even when this floor file lacks them: nobody may lift them from a button.
  // A note that is not a command ("cluster access", "kubectl/helm not allowed") gets no button: "env".
  let floor: Needs["floor"] = "env";
  let deniedRule: string | undefined;
  if (commandLike(prefix)) {
    const never = by(NEVER_LIFT) ?? blockersOf(rule, floorRules).find((r) => NEVER_LIFT.includes(r));
    const lift = by(floorRules);
    const own = by(projectRules);
    if (never) [floor, deniedRule] = ["never", never];
    else if (lift) [floor, deniedRule] = ["lift", lift];
    else if (own) [floor, deniedRule] = ["project", own];
  }
  // The phase whose agents need it: a lift in another phase does nothing for them.
  const key: Needs["key"] = rule.startsWith("Bash(") ? "bash" : "tools";
  return { role: m?.[1] ?? "agent", tool: m?.[2] ?? command, command, prefix, key, phase, floor, ...(deniedRule ? { deniedBy: deniedRule } : {}), text, at: String(e.ts ?? i) };
}

/** <main>/.forge/lessons.md: one line per block that was solved, read by every agent of later runs. */
export const lessonsFile = (main: string) => join(main, ".forge", "lessons.md");

export function lessons(main: string): { file: string; text: string } {
  const file = lessonsFile(main);
  return { file, text: existsSync(file) ? readFileSync(file, "utf8") : "" };
}

export function addLesson(main: string, text: string): { file: string; line: string } {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) throw new Error("the lesson is empty");
  const file = lessonsFile(main);
  mkdirSync(join(main, ".forge"), { recursive: true });
  const cur = existsSync(file) ? readFileSync(file, "utf8") : "# Lessons (forge)\n\nOne line per block that was solved. Every forge agent in this repo reads this first.\n\n";
  if (cur.includes(t)) return { file, line: t };
  const line = `- ${new Date().toISOString().slice(0, 10)}: ${t}`;
  appendFileSync(file, (existsSync(file) ? "" : cur) + line + "\n");
  return { file, line };
}
