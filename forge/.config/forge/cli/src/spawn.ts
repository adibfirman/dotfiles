import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { appendEvent, loadState, readLines, Refused, withLock, type Run } from "./append";
import { startBlock, type NodeState, type State } from "./events";
import { allowRules, deniedBy, denyFloor, expandPath, forgeHome, mcpServerName, mergeSources, modelFor, toolchainPreset } from "./sources";

const hcBin = () => process.env.FORGE_HC ?? "hc";
const isCoordinator = (role: string) => role.endsWith("-coord");

function read(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

/** hc names: 1-32 of a-z 0-9 - _, unique among live terminals. */
export function terminalName(ticket: string, cycle: number, node: string, gen: number): string {
  const full = `f-${ticket}-${cycle}-${node}-g${gen}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  if (full.length <= 32) return full;
  return `${full.slice(0, 23)}-${createHash("sha256").update(full).digest("hex").slice(0, 8)}`;
}

export interface ClaudeCommand { args: string[]; model: string; mcpConfig: string }

/** The claude argv for one node: SOURCES layers + toolchain preset + deny floor, role prompt, model. */
export function claudeArgs(run: Run, phase: string, role: string, node: string, cycleDir: string): ClaudeCommand {
  const home = forgeHome();
  const roleFile = join(home, "roles", `${role}.md`);
  if (!existsSync(roleFile)) throw new Refused(`no role prompt: ${roleFile}`);
  const sections = [phase, "all", ...(isCoordinator(role) ? ["coordinator"] : [])];
  const src = mergeSources([read(join(home, "SOURCES.md")), toolchainPreset(run.worktree), read(join(run.main, ".forge", "SOURCES.md"))], sections);
  const denyFile = join(home, "deny-floor.json");
  const deny = denyFloor(denyFile);
  const allow = allowRules(src).filter((r) => !deniedBy(r, deny));

  const registryFile = process.env.FORGE_MCP_REGISTRY ?? join(homedir(), ".claude", "mcp-servers.json");
  const registry = existsSync(registryFile) ? JSON.parse(readFileSync(registryFile, "utf8")).mcpServers ?? {} : {};
  const servers: Record<string, unknown> = {};
  for (const name of new Set(src.mcp.map(mcpServerName))) {
    if (!registry[name]) throw new Refused(`SOURCES names MCP server "${name}", which is not in ${registryFile}`);
    servers[name] = registry[name];
  }
  const spawnDir = join(cycleDir, ".spawn");
  mkdirSync(spawnDir, { recursive: true });
  const mcpConfig = join(spawnDir, `${node}-mcp.json`);
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: servers }, null, 2) + "\n");

  // The agent writes only into its phase folder. The run's state files stay out of reach.
  const outDir = join(cycleDir, phase);
  mkdirSync(outDir, { recursive: true });
  const dirs = [...new Set([outDir, ...[...src.read, ...src.write].map((p) => expandPath(p, run.worktree))])].filter((d) => d !== run.worktree);
  const abs = (p: string) => `//${p.replace(/^\//, "")}`;
  // Edit(path) rules cover every file-editing tool, Write included; Write(path) rules are not matched.
  const stateDeny = ["**/events.jsonl", "**/queue.jsonl", "run.json", "HEAD"].map((f) => `Edit(${abs(join(run.dir, f))})`);
  allow.push(`Read(${abs(join(run.dir, "**"))})`);
  const model = modelFor(role, [read(join(home, "models.md")), read(join(run.main, ".forge", "models.md"))]);

  // Deny floor + the run address for the agent's shell (forge append/spawn/status find the run with it).
  // An env wrapper would hide claude from hc, which then shows no agent status.
  const settings = join(spawnDir, `${node}-settings.json`);
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(denyFile, "utf8")), env: { FORGE_RUN: run.dir, FORGE_NODE: node } }, null, 2) + "\n");

  // Variadic flags (--allowedTools, --disallowedTools, --add-dir) are always followed by another flag,
  // so they never swallow the task text at the end.
  const args = [
    "--setting-sources", "project",
    "--strict-mcp-config", "--mcp-config", mcpConfig,
    ...(allow.length ? ["--allowedTools", ...allow] : []),
    "--disallowedTools", ...deny, ...stateDeny,
    ...(dirs.length ? ["--add-dir", ...dirs] : []),
    "--permission-mode", "dontAsk",
    "--settings", settings,
    "--plugin-dir", join(home, "skills-plugin"),
    "--append-system-prompt-file", roleFile,
    "--model", model,
  ];
  return { args, model, mcpConfig };
}

function taskText(run: Run, state: State, node: NodeState, task: string, cycleDir: string, reportTo: string | undefined): string {
  const out = join(cycleDir, state.phase, `${node.id}.md`);
  const report = reportTo ? `When you are done or stuck, report with: hc send ${reportTo} "${node.id}: done | failed: <one line>"` : "When you are done or stuck, say so on screen.";
  return `${task}\n\n---\nforge: run ${run.ticket}, cycle ${state.cycle}, phase ${state.phase}, node ${node.id} (generation ${node.gen}).\nWrite your full output to ${out}. ${report}`;
}

function hc(args: string[]) {
  const r = spawnSync(hcBin(), args, { encoding: "utf8", env: process.env });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

export interface SpawnResult { status: "started" | "queued" | "failed"; node: string; terminal?: string; name?: string; reason?: string; trusted?: boolean; recovered?: boolean }

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

/** Start one node, or queue it when the cap or the wave order blocks it. Other blocks are refusals. */
export function spawnNode(run: Run, role: string, nodeId: string, task: string, reportTo = process.env.HC_TERMINAL_ID): SpawnResult {
  const { state, cycleDir } = loadState(run);
  const node = state.nodes.get(nodeId);
  if (!node) throw new Refused(`unknown node ${nodeId}: add it first with forge append node_add`);
  const block = startBlock(state, node);
  if (block) {
    if (/^cap reached|^wave \d+ waits/.test(block)) {
      enqueue(run, cycleDir, { role, node: nodeId, task, reportTo });
      return { status: "queued", node: nodeId, reason: block };
    }
    throw new Refused(block);
  }
  const { args, model } = claudeArgs(run, state.phase, role, nodeId, cycleDir);
  const name = terminalName(run.ticket, state.cycle, nodeId, node.gen);
  const text = taskText(run, state, node, task, cycleDir, reportTo);

  // Reserve the slot first, so a refused start never leaves an agent running.
  // Another spawn can take the last slot between our check and this append: queue instead.
  try {
    appendEvent(run, { kind: "node_start", node: nodeId, data: { role, name, model } });
  } catch (e) {
    if (e instanceof Refused && /^cap reached|^wave \d+ waits/.test(e.message)) {
      enqueue(run, cycleDir, { role, node: nodeId, task, reportTo });
      return { status: "queued", node: nodeId, reason: e.message };
    }
    throw e;
  }
  const r = hc([
    "run", "--bg", "--json", "--name", name, "--cwd", run.worktree,
    "--label", `forge=${run.ticket}/${state.cycle}/${nodeId}`,
    ...(isCoordinator(role) ? ["--outlive-parent"] : []),
    "claude", ...args, text,
  ]);
  if (r.code !== 0) {
    appendEvent(run, { kind: "node_fail", node: nodeId, data: { sig: "spawn: hc run failed", detail: (r.err || r.out).slice(0, 500) } });
    throw new Refused(`hc run failed for ${nodeId}: ${r.err || r.out}`);
  }
  let info: Record<string, any> = {};
  try {
    info = JSON.parse(r.out);
  } catch {
    /* hc printed text: keep the name as the address */
  }
  const terminal = String(info.id ?? info.terminal ?? info.address ?? name);
  const trusted = acceptTrust(terminal);
  let recovered = false;
  if (info.first_message?.sent === false) {
    // hc manual: read first; send again only when the task did not arrive.
    const screen = hc(["read", "--lines", "80", terminal]).out;
    if (!screen.includes(task.slice(0, 40))) {
      recovered = hc(["send", terminal, text]).code === 0;
    }
  }
  writeFileSync(join(cycleDir, ".spawn", `${nodeId}-g${node.gen}.json`), JSON.stringify({ role, name, terminal, model, hc: info, trusted, recovered }, null, 2) + "\n");
  return { status: "started", node: nodeId, terminal, name, trusted, recovered };
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
    const items = queued(cycleDir);
    const ready = items.find((i) => {
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
