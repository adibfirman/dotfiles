import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { appendEvent, loadState, readLines, Refused, withLock, type Run } from "./append";
import { startBlock } from "./events";
import { refsIndexPath } from "./refs";
import { isWorkspace, repoWorktree } from "./repos";
import { allowRules, deniedBy, denyFloor, effectiveDeny, expandPath, forgeHome, mcpServerName, mergeSources, modelFor, toolchainPreset } from "./sources";
import { projectForced } from "./config";
import { findConnector, isConnector, knownServers, toolPrefix } from "./mcp";

const hcBin = () => process.env.FORGE_HC ?? "hc";
export const isCoordinator = (role: string) => role.endsWith("-coord") || role === "classifier";

function read(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

export function hc(args: string[]) {
  const r = spawnSync(hcBin(), args, { encoding: "utf8", env: process.env });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

/** hc names: 1-32 of a-z 0-9 - _, unique among live terminals. */
export function terminalName(ticket: string, cycle: number, id: string, gen: number): string {
  const full = `f-${ticket}-${cycle}-${id}-g${gen}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  if (full.length <= 32) return full;
  return `${full.slice(0, 23)}-${createHash("sha256").update(full).digest("hex").slice(0, 8)}`;
}

const abs = (p: string) => `//${p.replace(/^\//, "")}`;

/**
 * The plugin folder agents load with --plugin-dir, built at run time (no symlinks in the repo): one link
 * per skill in skills.md, pointing at ~/.claude/skills/<name> on this machine. Missing skills are skipped.
 */
export function skillsPlugin(home = forgeHome()): string {
  const dir = process.env.FORGE_PLUGIN_DIR ?? join(homedir(), ".local", "share", "forge", "skills-plugin");
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(dir, "skills"), { recursive: true });
  const manifest = join(dir, ".claude-plugin", "plugin.json");
  const want = JSON.stringify({ name: "forge-skills", version: "0.1.0", description: "User skills that forge agents load" }, null, 2) + "\n";
  if (!existsSync(manifest) || readFileSync(manifest, "utf8") !== want) writeFileSync(manifest, want);
  const names = [...read(join(home, "skills.md")).matchAll(/^-\s+([A-Za-z0-9._-]+)\s*$/gm)].map((m) => m[1]);
  const skillsRoot = process.env.FORGE_SKILLS_ROOT ?? join(homedir(), ".claude", "skills");
  for (const name of names) {
    const target = join(skillsRoot, name);
    const link = join(dir, "skills", name);
    let current: string | null = null;
    try {
      current = lstatSync(link).isSymbolicLink() ? readlinkSync(link) : "not a link";
    } catch {
      current = null;
    }
    if (!existsSync(join(target, "SKILL.md"))) {
      if (current !== null) unlinkSync(link);
      continue;
    }
    if (current === target) continue;
    if (current !== null) unlinkSync(link);
    symlinkSync(target, link);
  }
  return dir;
}

/** The role prompt: _common.md, then _coordinator.md for coordinators, then roles/<role>.md. */
function promptFile(home: string, role: string, spawnDir: string, id: string): string {
  const roleFile = join(home, "roles", `${role}.md`);
  if (!existsSync(roleFile)) throw new Refused(`no role prompt: ${roleFile}`);
  const parts = [join(home, "roles", "_common.md"), ...(isCoordinator(role) ? [join(home, "roles", "_coordinator.md")] : []), roleFile];
  const file = join(spawnDir, `${id}-prompt.md`);
  writeFileSync(file, parts.filter(existsSync).map((p) => readFileSync(p, "utf8").trim()).join("\n\n---\n\n") + "\n");
  return file;
}

export interface ClaudeCommand { args: string[]; model: string; mcpConfig: string; outDir: string }

/**
 * The claude argv for one agent: SOURCES layers + toolchain preset + deny floor, role prompt, model.
 * A node writes only its phase folder; a coordinator writes the whole cycle folder. The run's state
 * files (events, queue, HEAD, run.json) are never writable.
 */
/** The allow and deny rules an agent of this role and phase gets in this folder (no files written). */
export function toolRules(run: Run, phase: string, role: string, cwd = run.worktree) {
  const home = forgeHome();
  const sections = [phase, "all", ...(isCoordinator(role) ? ["coordinator"] : []), role];
  const src = mergeSources([read(join(home, "SOURCES.md")), toolchainPreset(cwd), read(join(run.main, ".forge", "SOURCES.md"))], sections);
  const forced = projectForced(run.main, phase);
  const deny = effectiveDeny(denyFloor(join(home, "deny-floor.json")), forced.flatMap((f) => f.lifts));
  const allow = [...new Set([...allowRules(src), ...forced.map((f) => f.rule)])].filter((r) => !deniedBy(r, deny));
  return { allow, deny };
}

/**
 * Whether a node's agent may run one shell command now: on its allow list (a Bash rule whose command it
 * starts with) and not denied. A coordinator checks this before it treats a "needs <tool>" node as blocked.
 */
export function allowedFor(run: Run, nodeId: string, command: string) {
  const { state } = loadState(run);
  const node = state.nodes.get(nodeId);
  if (!node) throw new Refused(`unknown node ${nodeId}`);
  const cwd = node.repo ? repoWorktree(run, node.repo) ?? run.worktree : run.worktree;
  const { allow, deny } = toolRules(run, node.phase, node.role ?? "unit", cwd);
  const cmd = command.trim().replace(/\s+/g, " ");
  const body = (r: string) => /^Bash\((.*?)(?::\*)?\)$/.exec(r)?.[1];
  const covers = (r: string) => { const b = body(r); return b !== undefined && (cmd === b || cmd.startsWith(b + " ")); };
  const denied = deny.find(covers);
  const rule = allow.find(covers);
  return { node: nodeId, command: cmd, allowed: Boolean(rule) && !denied, ...(rule ? { rule } : {}), ...(denied ? { deniedBy: denied } : {}) };
}

export function claudeArgs(run: Run, phase: string, role: string, id: string, cycleDir: string, cwd = run.worktree): ClaudeCommand {
  const home = forgeHome();
  const spawnDir = join(cycleDir, ".spawn");
  mkdirSync(spawnDir, { recursive: true });
  const prompt = promptFile(home, role, spawnDir, id);
  const sections = [phase, "all", ...(isCoordinator(role) ? ["coordinator"] : []), role];
  const src = mergeSources([read(join(home, "SOURCES.md")), toolchainPreset(cwd), read(join(run.main, ".forge", "SOURCES.md"))], sections);
  // SOURCES layers, the repo's toolchain, and its force-allowed entries (which lift floor rules, never the
  // NEVER_LIFT ones; HARD_DENY is always added). The same rules `forge allowed` checks.
  const rules = toolRules(run, phase, role, cwd);
  const deny = rules.deny;

  const outDir = isCoordinator(role) ? cycleDir : join(cycleDir, phase);
  mkdirSync(outDir, { recursive: true });
  // Edit(path) rules cover every file tool, Write included; Write(path) rules are not matched.
  const allow = [...rules.allow, `Read(${abs(join(run.dir, "**"))})`, `Edit(${abs(join(outDir, "**"))})`];
  const stateDeny = ["**/events.jsonl", "**/queue.jsonl", "run.json", "HEAD"].map((f) => `Edit(${abs(join(run.dir, f))})`);

  const registryFile = process.env.FORGE_MCP_REGISTRY ?? join(homedir(), ".claude", "mcp-servers.json");
  const registry = existsSync(registryFile) ? JSON.parse(readFileSync(registryFile, "utf8")).mcpServers ?? {} : {};
  const servers: Record<string, unknown> = {};
  const connectors: string[] = [];
  for (const name of new Set(src.mcp.map(mcpServerName))) {
    if (isConnector(name)) {
      connectors.push(name);
      continue;
    }
    if (!registry[name]) throw new Refused(`SOURCES names MCP server "${name}", which is not in ${registryFile}`);
    servers[name] = registry[name];
  }
  // claude.ai connectors only load without --strict-mcp-config. Then every other server Claude Code knows here
  // (yours and the other connectors) is denied by name, so the agent still gets only what SOURCES gives it.
  let mcpDeny: string[] = [];
  if (connectors.length) {
    // The repo's own .mcp.json servers are not in the cached list (it is not per folder): deny them too.
    const local = existsSync(join(cwd, ".mcp.json")) ? Object.keys(JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf8")).mcpServers ?? {}) : [];
    const known = [...knownServers(), ...local.map((name) => ({ name, prefix: toolPrefix(name), connector: false }))];
    const wanted = new Set([...connectors.map((c) => findConnector(c, known).prefix), ...Object.keys(servers).map(toolPrefix)]);
    mcpDeny = known.filter((s) => !wanted.has(s.prefix)).map((s) => `mcp__${s.prefix}`);
  }
  const mcpConfig = join(spawnDir, `${id}-mcp.json`);
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: servers }, null, 2) + "\n");

  const dirs = [...new Set([outDir, ...[...src.read, ...src.write].map((p) => expandPath(p, cwd))])].filter((d) => d !== cwd);
  const model = modelFor(role, [read(join(home, "models.md")), read(join(run.main, ".forge", "models.md"))]);

  // Deny floor + the run address for the agent's shell (forge commands find the run with it).
  // An env wrapper would hide claude from hc, which then shows no agent status.
  const settings = join(spawnDir, `${id}-settings.json`);
  // hc terminals start with a short PATH (no ~/.bun/bin), so the agent gets the caller's PATH.
  const bunBin = join(homedir(), ".bun", "bin");
  const path = [...new Set([...(existsSync(bunBin) ? [bunBin] : []), ...(process.env.PATH ?? "").split(":").filter(Boolean)])].join(":");
  // No co-author trailer: commits follow the repo's own format (tested: the attribution keys turn it off).
  writeFileSync(settings, JSON.stringify({
    permissions: { deny: [...deny, ...mcpDeny] },
    attribution: { commit: "", pr: "" }, includeCoAuthoredBy: false,
    // Under $HOME, Claude also reads ~/.claude/CLAUDE.md as a parent folder's project file, so agents would get
    // the user's own global rules (and an import dialog nobody answers). The repo's own CLAUDE.md still loads.
    claudeMdExcludes: [join(homedir(), ".claude", "**"), join(homedir(), "CLAUDE.md"), join(homedir(), "CLAUDE.local.md")],
    env: { FORGE_RUN: run.dir, FORGE_NODE: id, PATH: path },
  }, null, 2) + "\n");

  // Variadic flags (--allowedTools, --disallowedTools, --add-dir) are always followed by another flag,
  // so they never swallow the task text at the end.
  const args = [
    "--setting-sources", "project",
    ...(connectors.length ? [] : ["--strict-mcp-config"]), "--mcp-config", mcpConfig,
    "--allowedTools", ...allow,
    "--disallowedTools", ...deny, ...mcpDeny, ...stateDeny,
    "--add-dir", ...dirs,
    "--permission-mode", "dontAsk",
    "--settings", settings,
    "--plugin-dir", skillsPlugin(home),
    "--append-system-prompt-file", prompt,
    "--model", model,
  ];
  return { args, model, mcpConfig, outDir };
}

/**
 * Claude asks to trust each new folder, and its default answer is "No, exit". Agents run only in the
 * worktree forge made for this run, so forge answers "Yes, I trust this folder" (down, enter).
 * Waits up to FORGE_TRUST_WAIT_MS (default 20 s) for either the dialog or claude's prompt.
 */
function acceptTrust(terminal: string): boolean {
  const until = Date.now() + Number(process.env.FORGE_TRUST_WAIT_MS ?? 20_000);
  while (Date.now() < until) {
    const screen = hc(["read", "--lines", "0", terminal]).out;
    if (/Yes, I trust this folder/.test(screen)) return hc(["keys", terminal, "down", "enter"]).code === 0;
    // A project CLAUDE.md that imports outside files asks first; its default ("No, disable external imports") is the safe answer.
    if (/Allow external CLAUDE\.md file imports/.test(screen)) {
      hc(["keys", terminal, "enter"]);
      continue;
    }
    if (/^\s*❯ \s*$/m.test(screen) || /esc to interrupt|⏺/.test(screen)) return false;
    Bun.sleepSync(500);
  }
  return false;
}

export interface Launched { terminal: string; name: string; model: string; trusted: boolean; recovered: boolean }

/** Run claude in a new hc terminal. Writes .spawn/<id>.json with the address. */
export function launch(run: Run, opts: { role: string; id: string; name: string; phase: string; cycle: number; cycleDir: string; task: string; label: string; cwd?: string; onFail?: (detail: string) => void }): Launched {
  const cwd = opts.cwd ?? run.worktree;
  const { args, model } = claudeArgs(run, opts.phase, opts.role, opts.id, opts.cycleDir, cwd);
  const r = hc([
    "run", "--bg", "--json", "--name", opts.name, "--cwd", cwd, "--label", `forge=${opts.label}`,
    ...(isCoordinator(opts.role) ? ["--outlive-parent"] : []),
    "claude", ...args, opts.task,
  ]);
  if (r.code !== 0) {
    opts.onFail?.((r.err || r.out).slice(0, 500));
    throw new Refused(`hc run failed for ${opts.id}: ${r.err || r.out}`);
  }
  let info: Record<string, any> = {};
  try {
    info = JSON.parse(r.out);
  } catch {
    /* hc printed text: keep the name as the address */
  }
  const terminal = String(info.id ?? info.terminal ?? info.address ?? opts.name);
  const trusted = acceptTrust(terminal);
  let recovered = false;
  if (info.first_message?.sent === false) {
    // hc manual: read first; send again only when the task did not arrive.
    if (!hc(["read", "--lines", "80", terminal]).out.includes(opts.task.slice(0, 40))) recovered = hc(["send", terminal, opts.task]).code === 0;
  }
  writeFileSync(join(opts.cycleDir, ".spawn", `${opts.id}.json`), JSON.stringify({ role: opts.role, name: opts.name, terminal, model, hc: info, trusted, recovered }, null, 2) + "\n");
  return { terminal, name: opts.name, model, trusted, recovered };
}

export function spawnInfo(cycleDir: string, id: string): { terminal: string; name: string; role: string } | null {
  const f = join(cycleDir, ".spawn", `${id}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}

/** Live means hc still runs it. A missing terminal or an exit code means it is gone. */
export function isLive(terminal: string): boolean {
  const r = hc(["get", terminal, "--json"]);
  if (r.code !== 0) return false;
  try {
    const d = JSON.parse(r.out);
    return d.state === "live" && (d.exit_code === null || d.exit_code === undefined);
  } catch {
    return false;
  }
}

/** Save the screen next to the spawn file, then end the terminal. */
export function closeTerminal(cycleDir: string, id: string): boolean {
  const info = spawnInfo(cycleDir, id);
  if (!info || !isLive(info.terminal)) return false;
  const screen = hc(["read", "--lines", "400", info.terminal]).out;
  writeFileSync(join(cycleDir, ".spawn", `${id}-${Date.now()}.screen.txt`), screen + "\n");
  return hc(["kill", info.terminal]).code === 0;
}

export const nodeSpawnId = (node: string, gen: number) => `${node}-g${gen}`;

function taskText(run: Run, cycle: number, phase: string, node: string, gen: number, task: string, outDir: string, reportTo: string | undefined): string {
  const out = join(outDir, `${node}.md`);
  const report = reportTo ? `When you are done or stuck, report by running exactly one of these commands, alone:\nhc send ${reportTo} "${node}: done"\nhc send ${reportTo} "${node}: failed: <short reason>"` : "When you are done or stuck, say so on screen.";
  const refs = refsIndexPath(run);
  const refLine = refs ? `\nReferences for this run: ${refs} (read it first; open only the refs you need).` : "";
  return `${task}\n\n---\nforge: run ${run.ticket}, cycle ${cycle}, phase ${phase}, node ${node} (generation ${gen}).${refLine}\nWrite your full output to ${out}. ${report}`;
}

export interface SpawnResult { status: "started" | "queued" | "failed"; node: string; terminal?: string; name?: string; reason?: string; trusted?: boolean; recovered?: boolean }

const queueable = (msg: string) => /^cap reached|^wave \d+ waits/.test(msg);

/** Start one node, or queue it when the cap or the wave order blocks it. Other blocks are refusals. */
export function spawnNode(run: Run, role: string, nodeId: string, task: string, reportTo = process.env.HC_TERMINAL_ID): SpawnResult {
  if (isCoordinator(role)) throw new Refused(`${role} is not a node role: use forge coord`);
  const { state, cycleDir } = loadState(run);
  const node = state.nodes.get(nodeId);
  if (!node) throw new Refused(`unknown node ${nodeId}: add it first with forge append node_add`);
  const block = startBlock(state, node);
  if (block) {
    if (!queueable(block)) throw new Refused(block);
    enqueue(run, cycleDir, { role, node: nodeId, task, reportTo });
    return { status: "queued", node: nodeId, reason: block };
  }
  // Workspace runs: a node with a repo works in that repo's worktree; one without works at the root.
  let cwd = run.worktree;
  if (node.repo) {
    const wt = repoWorktree(run, node.repo);
    if (!wt) throw new Refused(`node ${nodeId} names repo ${node.repo}, which is not in this run: forge repo add ${node.repo}`);
    cwd = wt;
  } else if (isWorkspace(run) && (role === "unit" || role === "commit" || role.startsWith("gate-"))) {
    // These run git (diff, commit) and the repo's checks; the workspace root has no git.
    throw new Refused(`in a workspace run, a ${role} node needs data.repo (one repo per node)`);
  }
  const id = nodeSpawnId(nodeId, node.gen);
  const name = terminalName(run.ticket, state.cycle, nodeId, node.gen);
  // A retry reuses the name: end the old terminal first.
  closeTerminal(cycleDir, id);

  // Reserve the slot first, so a refused start never leaves an agent running.
  // Another spawn can take the last slot between our check and this append: queue instead.
  try {
    appendEvent(run, { kind: "node_start", node: nodeId, data: { role, name } });
  } catch (e) {
    if (e instanceof Refused && queueable(e.message)) {
      enqueue(run, cycleDir, { role, node: nodeId, task, reportTo });
      return { status: "queued", node: nodeId, reason: e.message };
    }
    throw e;
  }
  const outDir = join(cycleDir, state.phase);
  const l = launch(run, {
    role, id, name, phase: state.phase, cycle: state.cycle, cycleDir,
    task: taskText(run, state.cycle, state.phase, nodeId, node.gen, task, outDir, reportTo),
    label: `${run.ticket}/${state.cycle}/${nodeId}`,
    cwd,
    onFail: (detail) => appendEvent(run, { kind: "node_fail", node: nodeId, data: { sig: "spawn: hc run failed", detail } }),
  });
  return { status: "started", node: nodeId, terminal: l.terminal, name: l.name, trusted: l.trusted, recovered: l.recovered };
}

interface Queued { role: string; node: string; task: string; reportTo?: string }

function enqueue(run: Run, cycleDir: string, q: Queued) {
  withLock(run, () => {
    const file = join(cycleDir, "queue.jsonl");
    const items = readLines(file).map((l) => JSON.parse(l) as Queued).filter((i) => i.node !== q.node);
    items.push(q);
    writeFileSync(file, items.map((i) => JSON.stringify(i)).join("\n") + "\n");
  });
}

export function queued(cycleDir: string): Queued[] {
  return readLines(join(cycleDir, "queue.jsonl")).map((l) => JSON.parse(l));
}

/** Start every queued node that can start now, in queue order. Called after events that free a slot. */
export function drainQueue(run: Run): SpawnResult[] {
  const results: SpawnResult[] = [];
  for (;;) {
    const { state, cycleDir } = loadState(run);
    const ready = queued(cycleDir).find((i) => {
      const n = state.nodes.get(i.node);
      return n && !startBlock(state, n);
    });
    if (!ready) break;
    withLock(run, () => {
      const rest = queued(cycleDir).filter((i) => i.node !== ready.node);
      writeFileSync(join(cycleDir, "queue.jsonl"), rest.map((i) => JSON.stringify(i)).join("\n") + (rest.length ? "\n" : ""));
    });
    try {
      results.push(spawnNode(run, ready.role, ready.node, ready.task, ready.reportTo));
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      results.push({ status: "failed", node: ready.node, reason: e.message });
    }
  }
  return results;
}
