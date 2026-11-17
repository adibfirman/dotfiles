import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Refused } from "./append";
import { toolPrefix } from "./mcp";
import { blockersOf, denyFloor, denyRule, denyRules, effectiveDeny, forgeHome, ignoredLines, mcpServerName, mergeSources, NEVER_LIFT, parseSources, scriptDenies } from "./sources";

// Project settings live in <main>/.forge/ (models.md, SOURCES.md, config.json). The defaults in
// ~/.config/forge/ are never written from here.

export const MODELS = ["fable", "opus", "sonnet", "haiku"] as const;
export const GRILL_MODES = ["auto", "me"] as const;
export const CHECK_LEVELS = ["full", "light", "off"] as const;
export type GrillMode = (typeof GRILL_MODES)[number];
export type CheckLevel = (typeof CHECK_LEVELS)[number];
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

export interface Forced { key: string; value: string; rule: string; lifts: string[] }

function readConfig(main: string): Record<string, any> {
  try {
    return JSON.parse(read(join(projectDir(main), "config.json")) || "{}");
  } catch {
    return {};
  }
}

function writeConfig(main: string, cur: Record<string, unknown>) {
  mkdirSync(projectDir(main), { recursive: true });
  writeFileSync(join(projectDir(main), "config.json"), JSON.stringify(cur, null, 2) + "\n");
}

/** What this repo lifts in one phase ("Lift for this repo"): each entry, its rule, and the floor rules it lifts. */
export function projectForced(main: string, phase: string): Forced[] {
  const list = readConfig(main).force?.[phase];
  return Array.isArray(list) ? list.filter((f) => f && typeof f.rule === "string" && Array.isArray(f.lifts)) : [];
}

/**
 * A command value: a program (a plain name, or a ./path to a repo script) and then plain words. Free text such
 * as "kubectl/helm not allowed" is refused, so a note can never become a rule.
 */
export const commandLike = (v: string) => {
  const [first, ...rest] = v.trim().split(/\s+/);
  return /^(\.\/[\w./-]+|[A-Za-z0-9][\w.+-]*)$/.test(first ?? "") && rest.every((w) => /^[\w:./=@-]+$/.test(w));
};

/** The repo's default grill mode for new runs: "auto" (agents decide) or "me" (the user answers in the coordinator). */
export function projectGrill(main: string): GrillMode {
  const v = readConfig(main).grill;
  return (GRILL_MODES as readonly string[]).includes(v) ? v : "auto";
}

/** The repo's default check level for exec: "full", "light" (the default), or "off". */
export function projectChecks(main: string): CheckLevel {
  const v = readConfig(main).checks;
  return (CHECK_LEVELS as readonly string[]).includes(v) ? v : "light";
}

/** Keep the dialog's last pick of the grill mode or the check level for this repo. */
export function setRunDefault(main: string, key: "grill" | "checks", value: string) {
  const ok: readonly string[] = key === "grill" ? GRILL_MODES : CHECK_LEVELS;
  if (!ok.includes(value)) throw new Refused(`${key} must be ${ok.join(", ")}, not "${value}"`);
  writeConfig(main, { ...readConfig(main), [key]: value });
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
  const layers = [read(join(home, "SOURCES.md")), read(join(projectDir(main), "SOURCES.md"))];
  const scripts = scriptDenies(worktree);
  // Per phase: every deny rule an agent of that phase gets (the floor less this repo's lifts, the repo's own
  // outside scripts, and the SOURCES `- deny:` entries), and what this repo lifted.
  const sources = Object.fromEntries(["grill", "verify", "exec"].map((phase) => {
    const forced = projectForced(main, phase);
    const all = [...new Set([...effectiveDeny(deny, forced.flatMap((f) => f.lifts)), ...scripts, ...denyRules(mergeSources(layers, [phase, "all"]))])];
    return [phase, { deny: all, forced }];
  }));
  // The deny entries this repo's SOURCES.md adds, per phase, so the dialog can offer "remove" on exactly those.
  const projectParsed = parseSources(layers[1]);
  const added = Object.fromEntries(["grill", "verify", "exec"].map((ph) => [ph, (projectParsed.get(ph) ?? []).filter((e) => !e.remove && e.key === "deny").map((e) => e.value)]));
  return {
    main,
    project: added,
    models,
    cap: { value: cap ?? Number(process.env.FORGE_CAP ?? 4), from: cap ? "project" : "default" },
    grill: { value: projectGrill(main), from: readConfig(main).grill ? "project" : "default" },
    checks: { value: projectChecks(main), from: readConfig(main).checks ? "project" : "default" },
    sources,
    scripts,
    deny,
    neverLift: NEVER_LIFT,
    // Old allow lines in this repo's SOURCES.md: read and ignored since bypass mode, shown so the user removes them.
    ignored: ignoredLines(layers[1]),
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
    else throw new Refused(`model must be ${MODELS.join(", ")}, or default, not "${model}"`);
  }
  mkdirSync(projectDir(main), { recursive: true });
  const lines = [...project].sort().map(([r, m]) => `- ${r}: ${m}`);
  writeFileSync(join(projectDir(main), "models.md"), `# models (project override)\n\nRoles not listed use ~/.config/forge/models.md.\n\n${lines.join("\n")}\n`);
}

/** The agent cap for new runs and new cycles of this repo. */
export function setCap(main: string, n: number) {
  if (!Number.isInteger(n) || n < 1 || n > 8) throw new Refused("cap must be 1 to 8");
  writeConfig(main, { ...readConfig(main), cap: n });
}

/**
 * "Lift for this repo": let one entry the deny floor blocks run in one phase of this repo. The floor rules that
 * block it are lifted for this repo and phase only. Refused for the rules in NEVER_LIFT.
 */
export function force(main: string, phase: string, key: string, value: string): Forced {
  const v = value.trim();
  if (!PHASES.includes(phase)) throw new Refused(`phase must be grill, verify, or exec, not "${phase}"`);
  if (!["tools", "bash", "mcp"].includes(key)) throw new Refused("force works for tools, bash, or mcp");
  if (!v || v.includes(",") || v.includes("\n")) throw new Refused("give one value, with no comma");
  if (key === "bash" && !commandLike(v)) throw new Refused(`"${v}" is not a command prefix: give a program and its subcommands`);
  const rule = ruleFor(key, v)!;
  const lifts = blockersOf(rule, denyFloor(join(forgeHome(), "deny-floor.json")));
  const locked = lifts.filter((r) => NEVER_LIFT.includes(r));
  if (locked.length) throw new Refused(`${v} is blocked by ${locked.join(", ")}, which a repo can never lift`);
  if (!lifts.length) throw new Refused(`${v} is not denied by the deny floor: there is nothing to lift`);
  const cur = readConfig(main);
  const list: Forced[] = projectForced(main, phase).filter((f) => f.rule !== rule);
  const entry = { key, value: v, rule, lifts };
  writeConfig(main, { ...cur, force: { ...(cur.force ?? {}), [phase]: [...list, entry] } });
  return entry;
}

/** Remove one lifted entry from a phase (its floor rules apply again). */
export function unforce(main: string, phase: string, key: string, value: string) {
  const cur = readConfig(main);
  const rule = ruleFor(key, value.trim());
  const list = projectForced(main, phase).filter((f) => f.rule !== rule);
  writeConfig(main, { ...cur, force: { ...(cur.force ?? {}), [phase]: list } });
}

const PHASES = ["grill", "verify", "exec"];

function ruleFor(key: string, value: string): string | null {
  return key === "bash" ? `Bash(${value}:*)` : key === "tools" ? value : key === "mcp" ? `mcp__${toolPrefix(mcpServerName(value))}` : null;
}

/** A deny value: a command prefix, a tool rule (`WebFetch`, `Edit(path)`, `mcp__server`), or a claude.ai connector name. */
const denyLike = (v: string) => commandLike(v) || /^mcp__[\w-]+$/.test(v) || /^[A-Z][A-Za-z]*(\(.+\))?$/.test(v) || /^claude[._]ai[ _][\w .-]+$/i.test(v);

/** The `## <phase>` section of the project SOURCES.md: its line index and the index after its last line. */
function section(lines: string[], phase: string): { at: number; end: number } {
  const at = lines.findIndex((l) => l.trim().toLowerCase() === `## ${phase}`);
  let end = at + 1;
  while (at >= 0 && end < lines.length && !lines[end].startsWith("## ")) end++;
  return { at, end };
}

/** Deny one more command (or tool) for agents of one phase in this repo: `- deny: value` under `## <phase>`. */
export function deny(main: string, phase: string, value: string) {
  const v = value.trim();
  if (!PHASES.includes(phase)) throw new Refused(`phase must be grill, verify, or exec, not "${phase}"`);
  if (!v || v.includes(",") || v.includes("\n")) throw new Refused("give one value, with no comma");
  if (!denyLike(v)) throw new Refused(`"${v}" is not a command prefix or a tool: give a program and its subcommands, like "kubectl delete"`);
  const f = ensureProjectSources(main);
  const lines = read(f).split("\n");
  const entry = `- deny: ${v}`;
  let { at, end } = section(lines, phase);
  if (at < 0) {
    lines.push("", `## ${phase}`);
    at = lines.length - 1;
    end = lines.length;
  }
  if (lines.slice(at + 1, end).some((l) => l.trim() === entry)) return denyRule(v);
  let insert = end;
  while (insert > at + 1 && lines[insert - 1].trim() === "") insert--;
  lines.splice(insert, 0, entry);
  writeFileSync(f, lines.join("\n").replace(/\n*$/, "\n"));
  return denyRule(v);
}

/** Remove one deny entry this repo added to a phase (the defaults are never changed here). */
export function undeny(main: string, phase: string, value: string) {
  const f = join(projectDir(main), "SOURCES.md");
  if (!existsSync(f)) return;
  const lines = read(f).split("\n");
  const { at, end } = section(lines, phase);
  if (at < 0) return;
  const i = lines.slice(at + 1, end).findIndex((l) => l.trim() === `- deny: ${value.trim()}`);
  if (i >= 0) lines.splice(at + 1 + i, 1);
  writeFileSync(f, lines.join("\n"));
}

/** A project SOURCES.md to edit, created with a short header when missing. */
export function ensureProjectSources(main: string): string {
  const f = join(projectDir(main), "SOURCES.md");
  if (!existsSync(f)) {
    mkdirSync(projectDir(main), { recursive: true });
    writeFileSync(f, "# SOURCES (project override)\n\nAdds to ~/.config/forge/SOURCES.md. Agents run every command that is not denied.\n`- deny: kubectl delete` denies a command prefix for a phase; `- !deny: a` removes an entry.\n\n## grill\n\n## exec\n");
  }
  return f;
}
