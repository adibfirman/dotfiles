import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Refused } from "./append";
import { toolPrefix } from "./mcp";

export const forgeHome = () => process.env.FORGE_HOME ?? join(homedir(), ".config", "forge");

export type Key = "deny" | "read" | "write";
const KEYS: Key[] = ["deny", "read", "write"];
/** Keys of the old allow list: agents now run in bypass mode, so these lines are read and ignored. */
const OLD_KEYS = ["tools", "bash", "mcp"];

export interface Entry { key: Key; value: string; remove: boolean }

/**
 * SOURCES.md: `## grill, verify (comment)` sections with `- key: a, b` lines.
 * `- !key: a` removes `a` that an earlier layer added. Other lines, and the old allow keys, are ignored.
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
    if (OLD_KEYS.includes(item[2])) continue;
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
  const sets: Record<Key, Set<string>> = { deny: new Set(), read: new Set(), write: new Set() };
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

/**
 * Deny rules for the repo's own scripts that reach something outside (an environment, a deploy, a database, a
 * service) or delete: package.json scripts, files in script/ or scripts/, and Makefile targets whose name has an
 * OUTSIDE_WORDS word. Agents run in bypass mode, so these are what keeps `./scripts/deploy.sh` from running.
 */
export function scriptDenies(worktree: string): string[] {
  const out: string[] = [];
  const pkg = join(worktree, "package.json");
  if (existsSync(pkg)) {
    let scripts: string[] = [];
    try {
      scripts = Object.keys(JSON.parse(readFileSync(pkg, "utf8")).scripts ?? {});
    } catch {
      /* a broken package.json has no scripts to deny */
    }
    for (const s of scripts.filter((x) => /^[A-Za-z0-9:_.-]+$/.test(x) && OUTSIDE_WORDS.test(x))) {
      for (const pm of ["npm", "pnpm", "yarn", "bun"]) out.push(`${pm} run ${s}`, ...(pm === "npm" ? [] : [`${pm} ${s}`]));
    }
  }
  for (const dir of ["script", "scripts"]) {
    const d = join(worktree, dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (!f.isFile() || !/^[A-Za-z0-9._-]+$/.test(f.name) || !OUTSIDE_WORDS.test(f.name)) continue;
      const path = `${dir}/${f.name}`;
      out.push(`./${path}`, path, ...["bash", "sh", "zsh", "python", "python3", "node", "bun"].map((r) => `${r} ${path}`));
    }
  }
  const make = join(worktree, "Makefile");
  if (existsSync(make)) {
    for (const m of readFileSync(make, "utf8").matchAll(/^([A-Za-z0-9_.-]+):(?!=)/gm)) if (OUTSIDE_WORDS.test(m[1])) out.push(`make ${m[1]}`);
  }
  return [...new Set(out)].map((c) => `Bash(${c}:*)`);
}

const BUILD_WORDS = /(^|[^a-z])(gen|generate|codegen|build|test|tests|check|lint|fmt|format|coverage|proto|typecheck|compile|vet)/i;
const OUTSIDE_WORDS = /(dev|prod|staging|stage|deploy|release|publish|delet|drop|destroy|trigger|push|sync|upload|sonar|insert|seed|migrat|onboard)/i;
/** A repo script or make target that is a check: a build or check name, with no word that reaches outside. */
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

/**
 * A `- deny:` value as a rule: a tool rule as written (`WebFetch`, `Edit(path)`, `mcp__server`), a claude.ai connector
 * by name (`claude.ai Sentry` → `mcp__claude_ai_Sentry`), else a command prefix (`kubectl delete` → `Bash(kubectl delete:*)`).
 */
export function denyRule(value: string): string {
  const v = value.trim();
  if (/^mcp__/.test(v) || /^[A-Z][A-Za-z]*(\(.*\))?$/.test(v)) return v;
  if (/^claude[._]ai[ _]/i.test(v)) return `mcp__${toolPrefix(v)}`;
  return `Bash(${v}:*)`;
}

export const denyRules = (src: Resolved) => src.deny.map(denyRule);

export const mcpServerName = (m: string) => m.replace(/\(.*$/, "");

/** Expand ~, <worktree>, and . in a SOURCES path. */
export function expandPath(p: string, worktree: string): string {
  if (p === "." || p === "<worktree>") return worktree;
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  if (p.startsWith("<worktree>/")) return join(worktree, p.slice("<worktree>/".length));
  return resolve(worktree, p);
}
