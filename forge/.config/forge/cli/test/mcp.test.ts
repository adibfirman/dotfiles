import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentCycleDir } from "../src/append";
import { allow, settings } from "../src/config";
import { parseMcpList } from "../src/mcp";
import { claudeArgs } from "../src/spawn";
import { setup } from "./helpers";

const LIST = `Checking MCP server health…

claude.ai Atlassian: https://mcp.atlassian.com/v1/mcp - ✔ Connected
claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected
fff: fff-mcp - ✔ Connected
context7: https://mcp.context7.com/mcp (HTTP) - ✔ Connected
`;

function withList(root: string) {
  const f = join(root, "mcp-list.json");
  writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), servers: parseMcpList(LIST) }));
  process.env.FORGE_MCP_LIST = f;
}

test("parseMcpList: names, tool prefixes, connectors marked", () => {
  expect(parseMcpList(LIST)).toEqual([
    { name: "claude.ai Atlassian", prefix: "claude_ai_Atlassian", connector: true },
    { name: "claude.ai Slack", prefix: "claude_ai_Slack", connector: true },
    { name: "fff", prefix: "fff", connector: false },
    { name: "context7", prefix: "context7", connector: false },
  ]);
});

test("a claude.ai connector: allowed by name, no strict MCP config, every other server denied", () => {
  const env = setup();
  withList(env.root);
  allow(env.repo, "grill", "mcp", "claude.ai Atlassian");
  allow(env.repo, "grill", "mcp", "context7");
  writeFileSync(join(env.repo, ".mcp.json"), JSON.stringify({ mcpServers: { "repo-db": { command: "x" } } }));
  expect(() => allow(env.repo, "grill", "mcp", "claude.ai Figma")).toThrow("not a claude.ai connector");
  expect(settings(env.repo).sources.grill.allow).toContain("mcp__claude_ai_Atlassian");

  const { args } = claudeArgs(env.run, "grill", "fact-finder", "f1", currentCycleDir(env.run));
  expect(args).not.toContain("--strict-mcp-config");
  const allowed = args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--disallowedTools"));
  const denied = args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--add-dir"));
  expect(allowed).toContain("mcp__claude_ai_Atlassian");
  expect(denied).toEqual(expect.arrayContaining(["mcp__claude_ai_Slack", "mcp__fff", "mcp__repo-db"]));
  expect(denied).not.toContain("mcp__claude_ai_Atlassian");
  expect(denied).not.toContain("mcp__context7");
  const s = JSON.parse(readFileSync(args[args.indexOf("--settings") + 1], "utf8"));
  expect(s.permissions.deny).toContain("mcp__fff");
  // The registry server still comes from --mcp-config; the connector is not in it.
  const cfg = JSON.parse(readFileSync(args[args.indexOf("--mcp-config") + 1], "utf8"));
  expect(Object.keys(cfg.mcpServers)).toEqual(["context7"]);
  delete process.env.FORGE_MCP_LIST;
});

test("no connector: strict MCP config as before", () => {
  const env = setup();
  const { args } = claudeArgs(env.run, "grill", "fact-finder", "f1", currentCycleDir(env.run));
  expect(args).toContain("--strict-mcp-config");
});
