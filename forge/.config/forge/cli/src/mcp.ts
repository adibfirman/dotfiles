import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { Refused } from "./append";

// claude.ai connectors (the account's remote MCP servers, shown as "claude.ai <Name>" by `claude mcp list`).
// They have no command or URL forge can pass in --mcp-config, and --strict-mcp-config turns them all off
// (tested). So an agent that needs one runs without --strict-mcp-config, and every MCP server it was not
// given is denied by name instead.

export interface McpServer { name: string; prefix: string; connector: boolean }

/** "claude.ai Atlassian" → "claude_ai_Atlassian": the server part of its tool names (mcp__<prefix>__<tool>). */
export const toolPrefix = (name: string) => name.trim().replace(/[^A-Za-z0-9_-]/g, "_");
export const isConnector = (name: string) => /^claude[._]ai[ _]/i.test(name.trim());

const cacheFile = () => process.env.FORGE_MCP_LIST ?? join(homedir(), ".local", "state", "forge", "mcp-list.json");
const DAY = 24 * 3600 * 1000;

/** Every MCP server Claude Code knows here (yours and the claude.ai connectors), from `claude mcp list`, cached a day. */
export function knownServers(refresh = false): McpServer[] {
  const f = cacheFile();
  if (!refresh && existsSync(f)) {
    try {
      const c = JSON.parse(readFileSync(f, "utf8"));
      if (process.env.FORGE_MCP_LIST || Date.now() - Date.parse(c.at) < DAY) return c.servers;
    } catch {
      // stale or broken: list again
    }
  }
  const r = spawnSync("claude", ["mcp", "list"], { encoding: "utf8", timeout: 90_000, env: process.env });
  if (r.status !== 0) throw new Refused(`claude mcp list failed: ${(r.stderr || r.stdout || "").trim().slice(0, 200)}`);
  const servers = parseMcpList(r.stdout);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), servers }, null, 2) + "\n");
  return servers;
}

/** Lines like "claude.ai Atlassian: https://… - ✔ Connected" or "fff: fff-mcp - ✔ Connected". */
export function parseMcpList(text: string): McpServer[] {
  const out: McpServer[] = [];
  for (const line of text.split("\n")) {
    const m = /^(.+?): \S.* - /.exec(line.trim());
    if (!m) continue;
    out.push({ name: m[1], prefix: toolPrefix(m[1]), connector: isConnector(m[1]) });
  }
  return out;
}

/** The connector a SOURCES value names ("claude.ai Atlassian" or "claude_ai_Atlassian"), or a refusal. */
export function findConnector(value: string, servers = knownServers()): McpServer {
  const p = toolPrefix(value);
  const hit = servers.find((s) => s.connector && s.prefix === p);
  if (!hit) throw new Refused(`"${value}" is not a claude.ai connector here (see forge mcp list)`);
  return hit;
}
