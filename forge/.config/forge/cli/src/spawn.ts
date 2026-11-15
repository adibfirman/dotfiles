import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { appendEvent, loadState, readLines, Refused, withLock, type Run } from "./append";
import { startBlock } from "./events";
import { allowRules, deniedBy, denyFloor, expandPath, forgeHome, mcpServerName, mergeSources, modelFor, toolchainPreset } from "./sources";

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
export function claudeArgs(run: Run, phase: string, role: string, id: string, cycleDir: string): ClaudeCommand {
  const home = forgeHome();
  const spawnDir = join(cycleDir, ".spawn");
  mkdirSync(spawnDir, { recursive: true });
  const prompt = promptFile(home, role, spawnDir, id);
  const sections = [phase, "all", ...(isCoordinator(role) ? ["coordinator"] : []), role];
  const src = mergeSources([read(join(home, "SOURCES.md")), toolchainPreset(run.worktree), read(join(run.main, ".forge", "SOURCES.md"))], sections);
  const denyFile = join(home, "deny-floor.json");
  const deny = denyFloor(denyFile);

  const outDir = isCoordinator(role) ? cycleDir : join(cycleDir, phase);
  mkdirSync(outDir, { recursive: true });
  // Edit(path) rules cover every file tool, Write included; Write(path) rules are not matched.
  const allow = [...allowRules(src).filter((r) => !deniedBy(r, deny)), `Read(${abs(join(run.dir, "**"))})`, `Edit(${abs(join(outDir, "**"))})`];
  const stateDeny = ["**/events.jsonl", "**/queue.jsonl", "run.json", "HEAD"].map((f) => `Edit(${abs(join(run.dir, f))})`);

  const registryFile = process.env.FORGE_MCP_REGISTRY ?? join(homedir(), ".claude", "mcp-servers.json");
  const registry = existsSync(registryFile) ? JSON.parse(readFileSync(registryFile, "utf8")).mcpServers ?? {} : {};
  const servers: Record<string, unknown> = {};
  for (const name of new Set(src.mcp.map(mcpServerName))) {
    if (!registry[name]) throw new Refused(`SOURCES names MCP server "${name}", which is not in ${registryFile}`);
    servers[name] = registry[name];
  }
  const mcpConfig = join(spawnDir, `${id}-mcp.json`);
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: servers }, null, 2) + "\n");

  const dirs = [...new Set([outDir, ...[...src.read, ...src.write].map((p) => expandPath(p, run.worktree))])].filter((d) => d !== run.worktree);
  const model = modelFor(role, [read(join(home, "models.md")), read(join(run.main, ".forge", "models.md"))]);

  // Deny floor + the run address for the agent's shell (forge commands find the run with it).
  // An env wrapper would hide claude from hc, which then shows no agent status.
  const settings = join(spawnDir, `${id}-settings.json`);
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(denyFile, "utf8")), env: { FORGE_RUN: run.dir, FORGE_NODE: id } }, null, 2) + "\n");

  // Variadic flags (--allowedTools, --disallowedTools, --add-dir) are always followed by another flag,
  // so they never swallow the task text at the end.
  const args = [
    "--setting-sources", "project",
    "--strict-mcp-config", "--mcp-config", mcpConfig,
    "--allowedTools", ...allow,
    "--disallowedTools", ...deny, ...stateDeny,
    "--add-dir", ...dirs,
    "--permission-mode", "dontAsk",
    "--settings", settings,
    "--plugin-dir", join(home, "skills-plugin"),
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
    if (/^\s*❯ \s*$/m.test(screen) || /esc to interrupt|⏺/.test(screen)) return false;
    Bun.sleepSync(500);
  }
  return false;
}

export interface Launched { terminal: string; name: string; model: string; trusted: boolean; recovered: boolean }

/** Run claude in a new hc terminal. Writes .spawn/<id>.json with the address. */
export function launch(run: Run, opts: { role: string; id: string; name: string; phase: string; cycle: number; cycleDir: string; task: string; label: string; onFail?: (detail: string) => void }): Launched {
  const { args, model } = claudeArgs(run, opts.phase, opts.role, opts.id, opts.cycleDir);
  const r = hc([
    "run", "--bg", "--json", "--name", opts.name, "--cwd", run.worktree, "--label", `forge=${opts.label}`,
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
  const report = reportTo ? `When you are done or stuck, report with: hc send ${reportTo} "${node}: done" or hc send ${reportTo} "${node}: failed: <short reason>"` : "When you are done or stuck, say so on screen.";
  return `${task}\n\n---\nforge: run ${run.ticket}, cycle ${cycle}, phase ${phase}, node ${node} (generation ${gen}).\nWrite your full output to ${out}. ${report}`;
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
