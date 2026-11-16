import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentCycleDir } from "../src/append";
import { deniedBy, denyRule, denyRules, mergeSources, modelFor, parseSources, safeScript, scriptDenies } from "../src/sources";
import { claudeArgs } from "../src/spawn";
import { setup } from "./helpers";

describe("SOURCES layers", () => {
  test("deny entries per section, removal across layers; the old allow keys are ignored", () => {
    const base = "## all\n- deny: git stash\n- tools: Read\n## grill, verify (read only)\n- deny: git commit, gh pr view\n- bash: git log\n";
    const project = "## grill\n- !deny: gh pr view\n- deny: kubectl delete\n- mcp: context7\n";
    const src = mergeSources([base, project], ["grill", "all"]);
    expect(src.deny).toEqual(["git commit", "git stash", "kubectl delete"]);
    expect(mergeSources([base, project], ["verify"]).deny).toEqual(["git commit", "gh pr view"]);
    expect(Object.keys(src)).toEqual(["deny", "read", "write"]);
  });

  test("an unknown key is refused", () => {
    expect(() => parseSources("## all\n- tool: Read\n")).toThrow(/unknown key "tool"/);
  });

  test("deny values: command prefixes, tool rules, MCP servers, and connectors by name", () => {
    expect(["kubectl delete", "WebFetch", "Edit(/x/**)", "mcp__sentry", "claude.ai Sentry", "./scripts/x.sh"].map(denyRule))
      .toEqual(["Bash(kubectl delete:*)", "WebFetch", "Edit(/x/**)", "mcp__sentry", "mcp__claude_ai_Sentry", "Bash(./scripts/x.sh:*)"]);
    expect(denyRules(mergeSources(["## all\n- deny: gcloud run deploy\n"], ["all"]))).toEqual(["Bash(gcloud run deploy:*)"]);
  });
});

describe("deny floor", () => {
  test("covers the same rule and longer commands of a denied prefix", () => {
    const deny = ["Bash(git push:*)", "Edit(~/.claude/**)"];
    expect(deniedBy("Bash(git push:*)", deny)).toBe(true);
    expect(deniedBy("Bash(git push --force:*)", deny)).toBe(true);
    expect(deniedBy("Bash(git pushy:*)", deny)).toBe(false);
    expect(deniedBy("Edit(~/.claude/**)", deny)).toBe(true);
    expect(deniedBy("Bash(git log:*)", deny)).toBe(false);
  });

  test("agents get the floor, HARD_DENY, and the SOURCES denies; no allow list", () => {
    const { run } = setup({ sources: "## exec\n- deny: kubectl delete\n- bash: git push\n" });
    const { args } = claudeArgs(run, "exec", "unit", "u1", currentCycleDir(run));
    expect(args).not.toContain("--allowedTools");
    const denied = args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--add-dir"));
    expect(denied).toEqual(expect.arrayContaining(["Bash(git push:*)", "Bash(git push --force:*)", "Bash(kubectl delete:*)"]));
  });
});

describe("repo scripts that reach outside", () => {
  test("package scripts, script files, and make targets with an outside word are denied; checks are not", () => {
    const { root } = setup();
    const dir = join(root, "scripted");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    for (const name of ["gen", "check-coverage.sh", "trigger_setup_dev.py", "deploy.sh"]) writeFileSync(join(dir, "scripts", name), "#!/bin/sh\n");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "x", "db:migrate": "y", "build:prod": "z" } }));
    writeFileSync(join(dir, "Makefile"), "test:\n\tgo test\ndeploy-prod:\n\tx\nVAR:=1\n");
    const d = scriptDenies(dir);
    expect(d).toEqual(expect.arrayContaining([
      "Bash(pnpm db:migrate:*)", "Bash(npm run db:migrate:*)", "Bash(pnpm run build:prod:*)",
      "Bash(./scripts/deploy.sh:*)", "Bash(scripts/deploy.sh:*)", "Bash(bash scripts/deploy.sh:*)", "Bash(python3 scripts/trigger_setup_dev.py:*)",
      "Bash(make deploy-prod:*)",
    ]));
    expect(d.some((r) => /gen|coverage|make test|pnpm test|npm run test/.test(r))).toBe(false);
    expect(safeScript("gen-proto.sh")).toBe(true);
    expect(safeScript("trigger_setup_dev.py")).toBe(false);
  });

  test("nothing to deny", () => {
    const { repo } = setup();
    expect(scriptDenies(repo)).toEqual([]);
  });
});

describe("models", () => {
  test("project overrides one role, default covers the rest", () => {
    const base = "- default: sonnet\n- asker: opus\n";
    expect(modelFor("asker", [base, "- asker: haiku\n"])).toBe("haiku");
    expect(modelFor("unit", [base])).toBe("sonnet");
    expect(() => modelFor("unit", ["- asker: opus\n"])).toThrow(/no model for role unit/);
  });
});

describe("claude argv", () => {
  test("bypass mode, every registry MCP server, state protection, and the order before the task", () => {
    const { run } = setup({ sources: "## grill\n- read: ~/.claude/plans\n", registry: { context7: { command: "c7" }, fff: { command: "fff" } } });
    const cycleDir = currentCycleDir(run);
    const { args, model } = claudeArgs(run, "grill", "grill-coord", "coord", cycleDir);
    expect(model).toBe("opus");
    expect(args.slice(0, 2)).toEqual(["--setting-sources", "project"]);
    expect(args).not.toContain("--strict-mcp-config");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    expect(args.slice(-2)).toEqual(["--model", "opus"]);
    expect(args).toContain(cycleDir); // a coordinator writes the whole cycle folder
    expect(args).toContain(run.dir);
    expect(args).toContain(`Edit(/${join(run.dir, "**/events.jsonl")})`);
    const cfg = JSON.parse(readFileSync(args[args.indexOf("--mcp-config") + 1], "utf8"));
    expect(Object.keys(cfg.mcpServers)).toEqual(["context7", "fff"]);
    const settings = JSON.parse(readFileSync(args[args.indexOf("--settings") + 1], "utf8"));
    expect(settings).toMatchObject({ skipDangerousModePermissionPrompt: true, enableAllProjectMcpServers: true, permissions: { defaultMode: "bypassPermissions" } });
    expect(settings.permissions.deny).toContain("Bash(git push:*)");
  });

  test("the skills plugin is built at run time: installed skills linked, missing ones skipped", () => {
    const { run, root } = setup();
    const { args } = claudeArgs(run, "exec", "unit", "u1", currentCycleDir(run));
    const dir = args[args.indexOf("--plugin-dir") + 1];
    expect(dir).toBe(join(root, "plugin"));
    const fs = require("node:fs");
    expect(fs.readlinkSync(join(dir, "skills", "code-review"))).toBe(join(root, "skills", "code-review"));
    expect(fs.existsSync(join(dir, "skills", "not-installed"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8")).name).toBe("forge-skills");
  });

  test("a role without a prompt file is refused", () => {
    const { run } = setup();
    expect(() => claudeArgs(run, "grill", "nobody", "c", currentCycleDir(run))).toThrow(/no role prompt/);
  });
});
