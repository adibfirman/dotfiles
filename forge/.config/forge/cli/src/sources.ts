import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Refused } from "./append";
import { toolPrefix } from "./mcp";

export const forgeHome = () => process.env.FORGE_HOME ?? join(homedir(), ".config", "forge");

export type Key = "tools" | "bash" | "mcp" | "read" | "write";
const KEYS: Key[] = ["tools", "bash", "mcp", "read", "write"];

export interface Entry { key: Key; value: string; remove: boolean }

/**
 * SOURCES.md: `## grill, verify (comment)` sections with `- key: a, b` lines.
 * `- !key: a` removes `a` that an earlier layer added. Other lines are ignored.
 */
export function parseSources(text: string): Map<string, Entry[]> {
  const out = new Map<string, Entry[]>();
  let names: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const head = /^##\s+(.+)$/.exec(line);
    if (head) {
      names = head[1].replace(/\(.*?\)/g, "").split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
      continue;
    }
    const item = /^-\s+(!?)([a-z]+):\s*(.*)$/.exec(line);
    if (!item || !names.length) continue;
    const key = item[2] as Key;
    if (!KEYS.includes(key)) throw new Refused(`SOURCES: unknown key "${item[2]}" in: ${line}`);
    const values = item[3].split(",").map((v) => v.trim()).filter(Boolean);
    for (const name of names) {
      const list = out.get(name) ?? [];
      for (const value of values) list.push({ key, value, remove: item[1] === "!" });
      out.set(name, list);
    }
  }
  return out;
}

export type Resolved = Record<Key, string[]>;

/** Merge the layers in order for the given sections. A later `!` entry removes an earlier one. */
export function mergeSources(layers: string[], sections: string[]): Resolved {
  const sets: Record<Key, Set<string>> = { tools: new Set(), bash: new Set(), mcp: new Set(), read: new Set(), write: new Set() };
  for (const text of layers) {
    const parsed = parseSources(text);
    for (const section of sections) {
      for (const e of parsed.get(section) ?? []) {
        if (e.remove) sets[e.key].delete(e.value);
        else sets[e.key].add(e.value);
      }
    }
  }
  return Object.fromEntries(KEYS.map((k) => [k, [...sets[k]]])) as Resolved;
}

/** Commands the repo itself defines, as a SOURCES layer for exec. */
export function toolchainPreset(worktree: string): string {
  const lines: string[] = [];
  const pkg = join(worktree, "package.json");
  if (existsSync(pkg)) {
    const pm = existsSync(join(worktree, "bun.lock")) || existsSync(join(worktree, "bun.lockb")) ? "bun"
      : existsSync(join(worktree, "pnpm-lock.yaml")) ? "pnpm"
      : existsSync(join(worktree, "yarn.lock")) ? "yarn" : "npm";
    const scripts = Object.keys(JSON.parse(readFileSync(pkg, "utf8")).scripts ?? {}).filter((s) => /^[A-Za-z0-9:_.-]+$/.test(s));
    // A fresh worktree has no node_modules, so install comes first. pnpm, yarn, and bun also run a script
    // without "run" (`pnpm lint`), and agents use that form, so both are allowed.
    const cmds = [
      ...scripts.map((s) => `${pm} run ${s}`), ...(pm === "npm" ? [] : scripts.map((s) => `${pm} ${s}`)),
      `${pm} install`, ...(pm === "npm" ? ["npm ci"] : []), `${pm} test`, "npx tsc --noEmit",
    ];
    lines.push(`- bash: ${[...new Set(cmds)].join(", ")}`);
  }
  if (existsSync(join(worktree, "go.mod"))) lines.push("- bash: go build, go vet, go test, go generate, go mod download, go mod tidy, gofmt");
  // The repo's own build and check scripts (codegen, coverage, lint): executable files in script/ or scripts/,
  // and Makefile targets, kept only when the name says build or check and never when it says it reaches
  // something outside (an environment, a deploy, a database, a service) or deletes.
  const own: string[] = [];
  for (const dir of ["script", "scripts"]) {
    const d = join(worktree, dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
      if (!f.isFile() || f.name.startsWith(".") || !/^[A-Za-z0-9._-]+$/.test(f.name) || !safeScript(f.name)) continue;
      if (statSync(join(d, f.name)).mode & 0o111) own.push(`./${dir}/${f.name}`);
    }
  }
  // A repo that ships a Dockerfile (at the root or beside its scripts, often for codegen) needs to rebuild that
  // image when it goes stale. Only the local build is allowed: push and run are not.
  const dockerfile = ["", "script", "scripts"].some((dir) => {
    const d = join(worktree, dir);
    return existsSync(d) && readdirSync(d).some((f) => /^Dockerfile(\..+)?$/.test(f));
  });
  if (dockerfile) own.push("docker build");
  const make = join(worktree, "Makefile");
  if (existsSync(make)) {
    for (const m of readFileSync(make, "utf8").matchAll(/^([A-Za-z0-9_.-]+):(?!=)/gm)) if (safeScript(m[1])) own.push(`make ${m[1]}`);
  }
  if (own.length) lines.push(`- bash: ${[...new Set(own)].join(", ")}`);
  // Test files with no package.json to run them (like mods in a dotfiles repo): allow the plain test runners.
  if (hasTestFiles(worktree)) {
    const cmds = ["node --test", "bun test"].filter((c) => !lines.some((l) => l.includes(c))); // a bun repo has bun test already
    lines.push(`- bash: ${cmds.join(", ")}`);
  }
  return lines.length ? `## exec\n${lines.join("\n")}\n` : "";
}

/** Whether git tracks any *.test.{mjs,js,ts} file in the worktree (git's pathspec `*` crosses folders). */
function hasTestFiles(worktree: string): boolean {
  const r = spawnSync("git", ["ls-files", "--", "*.test.mjs", "*.test.js", "*.test.ts"], { cwd: worktree, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

const BUILD_WORDS = /(^|[^a-z])(gen|generate|codegen|build|test|tests|check|lint|fmt|format|coverage|proto|typecheck|compile|vet)/i;
const OUTSIDE_WORDS = /(dev|prod|staging|stage|deploy|release|publish|delet|drop|destroy|trigger|push|sync|upload|sonar|insert|seed|migrat|onboard)/i;
/** A repo script or make target an agent may run: a build or check name, with no word that reaches outside. */
export const safeScript = (name: string) => BUILD_WORDS.test(name) && !OUTSIDE_WORDS.test(name);

/** Role → model from models.md lines `- role: model`. A project file overrides single roles. */
export function modelFor(role: string, texts: string[]): string {
  const map = new Map<string, string>();
  for (const text of texts) {
    for (const m of text.matchAll(/^-\s+([a-z0-9-]+):\s*([A-Za-z0-9.\-]+)\s*$/gm)) map.set(m[1], m[2]);
  }
  const model = map.get(role) ?? map.get("default");
  if (!model) throw new Refused(`models.md has no model for role ${role} and no default`);
  return model;
}

export function denyFloor(file: string): string[] {
  if (!existsSync(file)) throw new Refused(`deny floor missing: ${file}`);
  const deny = JSON.parse(readFileSync(file, "utf8"))?.permissions?.deny;
  if (!Array.isArray(deny) || !deny.length) throw new Refused(`deny floor has no permissions.deny list: ${file}`);
  return deny.map(String);
}

/**
 * Deny floor rules a repo can never lift with "force allow": they protect the machine, your config, and git history.
 * HARD_DENY is always added, so lifting `git push` still never allows a force push.
 */
export const NEVER_LIFT = ["Bash(rm -rf:*)", "Bash(rm -fr:*)", "Bash(sudo:*)", "Edit(~/.claude/**)", "Edit(**/.git/**)"];
export const HARD_DENY = ["Bash(git push --force:*)", "Bash(git push -f:*)", "Bash(git push --force-with-lease:*)"];

/** The deny floor rules that block one allow rule (same rule, or a Bash command that starts with a denied one). */
export function blockersOf(allow: string, deny: string[]): string[] {
  return deny.filter((d) => deniedBy(allow, [d]));
}

/** The floor for one agent: the floor minus what its repo lifted for its phase, plus the hard rules. */
export function effectiveDeny(floor: string[], lifted: string[]): string[] {
  const lift = new Set(lifted.filter((r) => !NEVER_LIFT.includes(r)));
  return [...new Set([...floor.filter((r) => !lift.has(r)), ...HARD_DENY])];
}

const bashBody = (rule: string) => /^Bash\((.*?)(?::\*)?\)$/.exec(rule)?.[1];

/** True when a deny rule covers an allow rule: same rule, or a Bash command that starts with a denied one. */
export function deniedBy(allow: string, deny: string[]): boolean {
  if (deny.includes(allow)) return true;
  const a = bashBody(allow);
  if (a === undefined) return false;
  return deny.some((d) => {
    const b = bashBody(d);
    return b !== undefined && (a === b || a.startsWith(b + " "));
  });
}

export function allowRules(src: Resolved): string[] {
  const mcp = src.mcp.map((m) => {
    // A claude.ai connector is named as `claude mcp list` shows it ("claude.ai Atlassian"); its tools are mcp__claude_ai_Atlassian__*.
    const t = /^(.+?)\((.*)\)$/.exec(m);
    if (!t) return [`mcp__${toolPrefix(m)}`];
    return t[2].split(/\s+/).filter(Boolean).map((tool) => `mcp__${toolPrefix(t[1])}__${tool}`);
  }).flat();
  return [...src.tools, ...src.bash.map((b) => `Bash(${b}:*)`), ...mcp];
}

export const mcpServerName = (m: string) => m.replace(/\(.*$/, "");

/** Expand ~, <worktree>, and . in a SOURCES path. */
export function expandPath(p: string, worktree: string): string {
  if (p === "." || p === "<worktree>") return worktree;
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  if (p.startsWith("<worktree>/")) return join(worktree, p.slice("<worktree>/".length));
  return resolve(worktree, p);
}
