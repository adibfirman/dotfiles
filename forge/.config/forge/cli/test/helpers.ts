import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { appendEvent, type Run } from "../src/append";
import { init } from "../src/init";
import type { Data, Kind } from "../src/events";

const FAKE_HC = `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_HC_LOG, JSON.stringify(args) + "\\n");
const mode = process.env.FAKE_HC_MODE ?? "ok";
if (args[0] === "run") {
  if (mode === "fail") { console.error("core not running"); process.exit(1); }
  const name = args[args.indexOf("--name") + 1];
  console.log(JSON.stringify({ id: "t-" + name, first_message: { sent: mode !== "unsent" } }));
} else if (args[0] === "get") {
  const fs = require("node:fs");
  const dead = fs.existsSync(process.env.FAKE_HC_LOG + ".dead") ? fs.readFileSync(process.env.FAKE_HC_LOG + ".dead", "utf8").split("\\n") : [];
  console.log(JSON.stringify(dead.includes(args[1]) ? { state: "exited", exit_code: 0 } : { state: "live", exit_code: null }));
} else if (args[0] === "kill") {
  appendFileSync(process.env.FAKE_HC_LOG + ".dead", args[1] + "\\n");
} else if (args[0] === "keys") {
  appendFileSync(process.env.FAKE_HC_LOG + ".trusted", "1");
} else if (args[0] === "read") {
  const fs = require("node:fs");
  const trusted = fs.existsSync(process.env.FAKE_HC_LOG + ".trusted");
  // FAKE_HC_SCREENS: a JSON list of screens; each hc keys call moves to the next one, then the prompt shows.
  const screens = process.env.FAKE_HC_SCREENS ? JSON.parse(process.env.FAKE_HC_SCREENS) : null;
  const answered = trusted ? fs.readFileSync(process.env.FAKE_HC_LOG + ".trusted", "utf8").length : 0;
  if (screens) console.log(answered < screens.length ? screens[answered] : "❯ ");
  else if (mode === "trust" && !trusted) console.log(" ❯ No, exit\\n   Yes, I trust this folder");
  else if (mode === "unsent") console.log("Welcome to Claude Code");
  else console.log("❯ ");
}
`;

export interface Env { root: string; repo: string; home: string; log: string; run: Run }

/** A temp git repo, a temp forge home, a fake hc, and a run with cycle 001 at grill. */
export function setup(opts: { cap?: number; sources?: string; registry?: Record<string, unknown> } = {}): Env {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "forge-test-")));
  const repo = join(root, "repo");
  mkdirSync(repo);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });

  const home = join(root, "forge-home");
  mkdirSync(join(home, "roles"), { recursive: true });
  for (const role of ["_common", "_coordinator", "unit", "fact-finder", "grill-coord", "verify-coord", "exec-coord", "classifier", "gate-beh"]) writeFileSync(join(home, "roles", `${role}.md`), `You are ${role}.\n`);
  writeFileSync(join(home, "SOURCES.md"), opts.sources ?? "## all\n- tools: Read\n## grill\n- bash: git log\n## exec\n- tools: Edit\n- bash: git commit\n");
  writeFileSync(join(home, "deny-floor.json"), JSON.stringify({ permissions: { deny: ["Bash(git push:*)", "Edit(~/.claude/**)"] } }));
  writeFileSync(join(home, "models.md"), "- default: sonnet\n- grill-coord: opus\n");
  const registry = join(root, "mcp-servers.json");
  writeFileSync(registry, JSON.stringify({ mcpServers: opts.registry ?? { context7: { type: "http", url: "https://example.invalid/mcp" } } }));

  const hc = join(root, "hc");
  writeFileSync(hc, FAKE_HC);
  chmodSync(hc, 0o755);
  const log = join(root, "hc.log");
  writeFileSync(log, "");

  mkdirSync(join(root, "skills", "code-review"), { recursive: true });
  writeFileSync(join(root, "skills", "code-review", "SKILL.md"), "---\nname: code-review\n---\n");
  writeFileSync(join(home, "skills.md"), "- code-review\n- not-installed\n");
  Object.assign(process.env, { FORGE_PLUGIN_DIR: join(root, "plugin"), FORGE_SKILLS_ROOT: join(root, "skills"), FORGE_REF_RETRY_MS: "0,0", FORGE_REGISTRY: join(root, "runs.jsonl"), FORGE_TRUST_WAIT_MS: "300", FORGE_HOME: home, FORGE_HC: hc, FAKE_HC_LOG: log, FAKE_HC_MODE: "ok", FORGE_MCP_REGISTRY: registry, FORGE_NO_SHELL_ENV: "1" });
  delete process.env.FORGE_RUN;
  delete process.env.HC_TERMINAL_ID;
  delete process.env.FAKE_HC_SCREENS;

  const ctx = join(root, "task.md");
  writeFileSync(ctx, "---\nticket: none\n---\nBuild the thing.\n");
  const run = init(ctx, repo, opts.cap ?? 4);
  return { root, repo, home, log, run };
}

export const add = (run: Run, kind: Kind, node?: string, data?: Data) => appendEvent(run, { kind, node, data });

export function hcCalls(env: Env): string[][] {
  return existsSync(env.log) ? readFileSync(env.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}

/** Walk the current cycle to the exec phase with an approval. */
export function toExec(run: Run) {
  add(run, "phase_done");
  add(run, "phase_done");
  add(run, "approved");
}
