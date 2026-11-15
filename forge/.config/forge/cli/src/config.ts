import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Refused } from "./append";
import { homedir } from "node:os";
import { allowRules, deniedBy, denyFloor, forgeHome, mcpServerName, mergeSources, parseSources, toolchainPreset, type Key } from "./sources";

// Project settings live in <main>/.forge/ (models.md, SOURCES.md, config.json). The defaults in
// ~/.config/forge/ are never written from here.

export const MODELS = ["opus", "sonnet", "haiku"] as const;
const projectDir = (main: string) => join(main, ".forge");
const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");

function parseModels(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of text.matchAll(/^-\s+([a-z0-9-]+):\s*([A-Za-z0-9.\-]+)\s*$/gm)) m.set(x[1], x[2]);
  return m;
}

export function roles(): string[] {
  const dir = join(forgeHome(), "roles");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_")).map((f) => f.replace(/\.md$/, "")).sort() : [];
}

export function projectCap(main: string): number | null {
  try {
    const cap = JSON.parse(read(join(projectDir(main), "config.json")) || "{}").cap;
    return Number.isInteger(cap) && cap >= 1 && cap <= 8 ? cap : null;
  } catch {
    return null;
  }
}

/** The effective settings of a repo, each marked "default" or "project". */
export function settings(main: string, worktree = main) {
  const home = forgeHome();
  const defaults = parseModels(read(join(home, "models.md")));
  const project = parseModels(read(join(projectDir(main), "models.md")));
  const models = Object.fromEntries(roles().map((r) => {
    const value = project.get(r) ?? defaults.get(r) ?? defaults.get("default") ?? "sonnet";
    return [r, { value, from: project.has(r) ? "project" : "default" }];
  }));
  const cap = projectCap(main);
  const deny = denyFloor(join(home, "deny-floor.json"));
  const layers = [read(join(home, "SOURCES.md")), toolchainPreset(worktree), read(join(projectDir(main), "SOURCES.md"))];
  const sources = Object.fromEntries(["grill", "verify", "exec"].map((phase) => {
    const src = mergeSources(layers, [phase, "all"]);
    return [phase, { allow: allowRules(src).filter((r) => !deniedBy(r, deny)), mcp: [...new Set(src.mcp.map(mcpServerName))] }];
  }));
  // What this repo's SOURCES.md adds, per phase, so the dialog can offer "remove" on exactly those.
  const projectParsed = parseSources(layers[2]);
  const added = Object.fromEntries(["grill", "verify", "exec"].map((ph) => [ph, (projectParsed.get(ph) ?? []).filter((e) => !e.remove).map((e) => ({ key: e.key, value: e.value }))]));
  return {
    main,
    project: added,
    models,
    cap: { value: cap ?? Number(process.env.FORGE_CAP ?? 4), from: cap ? "project" : "default" },
    sources,
    deny,
    files: { models: join(projectDir(main), "models.md"), sources: join(projectDir(main), "SOURCES.md"), config: join(projectDir(main), "config.json") },
  };
}

/** Set models in the project file. "default" removes the project line for that role. */
export function setModels(main: string, pairs: string[]) {
  const known = new Set(roles());
  const project = parseModels(read(join(projectDir(main), "models.md")));
  for (const p of pairs) {
    const [role, model] = p.split("=");
    if (!known.has(role)) throw new Refused(`unknown role ${role}: one of ${[...known].join(", ")}`);
    if (model === "default") project.delete(role);
    else if ((MODELS as readonly string[]).includes(model)) project.set(role, model);
    else throw new Refused(`model must be opus, sonnet, haiku, or default, not "${model}"`);
  }
  mkdirSync(projectDir(main), { recursive: true });
  const lines = [...project].sort().map(([r, m]) => `- ${r}: ${m}`);
  writeFileSync(join(projectDir(main), "models.md"), `# models (project override)\n\nRoles not listed use ~/.config/forge/models.md.\n\n${lines.join("\n")}\n`);
}

/** The agent cap for new runs and new cycles of this repo. */
export function setCap(main: string, n: number) {
  if (!Number.isInteger(n) || n < 1 || n > 8) throw new Refused("cap must be 1 to 8");
  mkdirSync(projectDir(main), { recursive: true });
  const f = join(projectDir(main), "config.json");
  let cur: Record<string, unknown> = {};
  try {
    cur = JSON.parse(read(f) || "{}");
  } catch {
    cur = {};
  }
  writeFileSync(f, JSON.stringify({ ...cur, cap: n }, null, 2) + "\n");
}

const PHASES = ["grill", "verify", "exec"];
const ADD_KEYS: Key[] = ["tools", "bash", "mcp", "read", "write"];

function ruleFor(key: Key, value: string): string | null {
  return key === "bash" ? `Bash(${value}:*)` : key === "tools" ? value : key === "mcp" ? `mcp__${mcpServerName(value)}` : null;
}

/**
 * Add one allowed entry to a phase in the project SOURCES.md (`- key: value` under `## <phase>`).
 * Refused when the deny floor blocks it (it would never apply) or an MCP server is unknown.
 */
export function allow(main: string, phase: string, key: string, value: string) {
  const v = value.trim();
  if (!PHASES.includes(phase)) throw new Refused(`phase must be grill, verify, or exec, not "${phase}"`);
  if (!(ADD_KEYS as string[]).includes(key)) throw new Refused(`key must be one of ${ADD_KEYS.join(", ")}`);
  if (!v || v.includes(",") || v.includes("\n")) throw new Refused("give one value, with no comma");
  const rule = ruleFor(key as Key, v);
  if (rule && deniedBy(rule, denyFloor(join(forgeHome(), "deny-floor.json")))) throw new Refused(`${v} is blocked by the deny floor, so it would never apply`);
  if (key === "mcp") {
    const registry = JSON.parse(read(process.env.FORGE_MCP_REGISTRY ?? join(homedir(), ".claude", "mcp-servers.json")) || "{}").mcpServers ?? {};
    if (!registry[mcpServerName(v)]) throw new Refused(`MCP server "${mcpServerName(v)}" is not in ~/.claude/mcp-servers.json`);
  }
  const f = ensureProjectSources(main);
  const lines = read(f).split("\n");
  const entry = `- ${key}: ${v}`;
  let at = lines.findIndex((l) => l.trim().toLowerCase() === `## ${phase}`);
  if (at < 0) {
    lines.push("", `## ${phase}`);
    at = lines.length - 1;
  }
  let end = at + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end++;
  if (lines.slice(at + 1, end).some((l) => l.trim() === entry)) return;
  let insert = end;
  while (insert > at + 1 && lines[insert - 1].trim() === "") insert--;
  lines.splice(insert, 0, entry);
  writeFileSync(f, lines.join("\n").replace(/\n*$/, "\n"));
}

/** Remove one entry this repo added to a phase (the defaults are never changed here). */
export function disallow(main: string, phase: string, key: string, value: string) {
  const f = join(projectDir(main), "SOURCES.md");
  if (!existsSync(f)) return;
  const lines = read(f).split("\n");
  const at = lines.findIndex((l) => l.trim().toLowerCase() === `## ${phase}`);
  if (at < 0) return;
  let end = at + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end++;
  const entry = `- ${key}: ${value.trim()}`;
  const i = lines.slice(at + 1, end).findIndex((l) => l.trim() === entry);
  if (i >= 0) lines.splice(at + 1 + i, 1);
  writeFileSync(f, lines.join("\n"));
}

/** A project SOURCES.md to edit, created with a short header when missing. */
export function ensureProjectSources(main: string): string {
  const f = join(projectDir(main), "SOURCES.md");
  if (!existsSync(f)) {
    mkdirSync(projectDir(main), { recursive: true });
    writeFileSync(f, "# SOURCES (project override)\n\nAdds to ~/.config/forge/SOURCES.md. `- !key: a` removes an entry. The deny floor always wins.\n\n## grill\n\n## exec\n");
  }
  return f;
}
