import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Refused } from "./append";

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
    const scripts = Object.keys(JSON.parse(readFileSync(pkg, "utf8")).scripts ?? {});
    const cmds = [...scripts.map((s) => `${pm} run ${s}`), `${pm} test`, "npx tsc --noEmit"];
    lines.push(`- bash: ${cmds.join(", ")}`);
  }
  if (existsSync(join(worktree, "go.mod"))) lines.push("- bash: go build, go vet, go test");
  return lines.length ? `## exec\n${lines.join("\n")}\n` : "";
}

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
    const t = /^([A-Za-z0-9_-]+)\((.*)\)$/.exec(m);
    if (!t) return [`mcp__${m}`];
    return t[2].split(/\s+/).filter(Boolean).map((tool) => `mcp__${t[1]}__${tool}`);
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
