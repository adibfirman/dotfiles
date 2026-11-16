import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currentCycleDir } from "../src/append";
import { parseMcpList } from "../src/mcp";
import { claudeArgs } from "../src/spawn";
import { setup } from "./helpers";

const LIST = `Checking MCP server health…

claude.ai Atlassian: https://mcp.atlassian.com/v1/mcp - ✔ Connected
claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected
fff: fff-mcp - ✔ Connected
context7: https://mcp.context7.com/mcp (HTTP) - ✔ Connected
`;

test("parseMcpList: names, tool prefixes, connectors marked", () => {
  expect(parseMcpList(LIST)).toEqual([
    { name: "claude.ai Atlassian", prefix: "claude_ai_Atlassian", connector: true },
    { name: "claude.ai Slack", prefix: "claude_ai_Slack", connector: true },
    { name: "fff", prefix: "fff", connector: false },
    { name: "context7", prefix: "context7", connector: false },
  ]);
});

test("every agent loads the registry servers with no strict MCP config, so connectors load too; the floor denies some", () => {
  const env = setup();
  const fs = require("node:fs");
  fs.writeFileSync(join(env.home, "deny-floor.json"), JSON.stringify({ permissions: { deny: ["Bash(git push:*)", "mcp__claude_ai_Slack"] } }));
  const { args } = claudeArgs(env.run, "grill", "fact-finder", "f1", currentCycleDir(env.run));
  expect(args).not.toContain("--strict-mcp-config");
  const denied = args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--add-dir"));
  expect(denied).toContain("mcp__claude_ai_Slack");
  const cfg = JSON.parse(readFileSync(args[args.indexOf("--mcp-config") + 1], "utf8"));
  expect(Object.keys(cfg.mcpServers)).toEqual(["context7"]);
});
