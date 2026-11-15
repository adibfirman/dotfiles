import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentCycleDir } from "../src/append";
import { allowRules, deniedBy, mergeSources, modelFor, parseSources, toolchainPreset } from "../src/sources";
import { claudeArgs } from "../src/spawn";
import { setup } from "./helpers";

describe("SOURCES layers", () => {
  test("sections, comments, and removal across layers", () => {
    const base = "## all\n- tools: Read, Grep\n## grill, verify (read only)\n- bash: git log, gh pr view\n";
    const project = "## grill\n- !bash: gh pr view\n- bash: gh issue view\n";
    const src = mergeSources([base, project], ["grill", "all"]);
    expect(src.tools).toEqual(["Read", "Grep"]);
    expect(src.bash).toEqual(["git log", "gh issue view"]);
    expect(mergeSources([base, project], ["verify"]).bash).toEqual(["git log", "gh pr view"]);
  });

  test("an unknown key is refused", () => {
    expect(() => parseSources("## all\n- tool: Read\n")).toThrow(/unknown key "tool"/);
  });

  test("MCP entries become server or tool rules", () => {
    const src = mergeSources(["## all\n- mcp: context7, sentry(search_issues get_issue_details)\n- bash: git log\n"], ["all"]);
    expect(allowRules(src)).toEqual(["Bash(git log:*)", "mcp__context7", "mcp__sentry__search_issues", "mcp__sentry__get_issue_details"]);
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

  test("a SOURCES entry cannot unlock a deny floor entry", () => {
    const { run } = setup({ sources: "## exec\n- bash: git push, git commit\n" });
    const { args } = claudeArgs(run, "exec", "unit", "u1", currentCycleDir(run));
    const allowed = args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--disallowedTools"));
    expect(allowed).toContain("Bash(git commit:*)");
    expect(allowed).not.toContain("Bash(git push:*)");
    expect(args).toContain("Bash(git push:*)");
  });
});

describe("toolchain preset", () => {
  test("bun scripts", () => {
    const { root } = setup();
    const dir = join(root, "bunrepo");
    mkdirSync(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { lint: "x", typecheck: "y" } }));
    writeFileSync(join(dir, "bun.lock"), "");
    expect(toolchainPreset(dir)).toBe("## exec\n- bash: bun run lint, bun run typecheck, bun test, npx tsc --noEmit\n");
  });

  test("go module", () => {
    const { root } = setup();
    const dir = join(root, "gorepo");
    mkdirSync(dir);
    writeFileSync(join(dir, "go.mod"), "module x\n");
    expect(toolchainPreset(dir)).toBe("## exec\n- bash: go build, go vet, go test\n");
  });

  test("nothing to add", () => {
    const { repo } = setup();
    expect(toolchainPreset(repo)).toBe("");
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
  test("flags, MCP config, state protection, and the order before the task", () => {
    const { run } = setup({ sources: "## grill\n- mcp: context7\n- read: ~/.claude/plans\n" });
    const cycleDir = currentCycleDir(run);
    const { args, model } = claudeArgs(run, "grill", "grill-coord", "coord", cycleDir);
    expect(model).toBe("opus");
    expect(args.slice(0, 3)).toEqual(["--setting-sources", "project", "--strict-mcp-config"]);
    expect(args.slice(-2)).toEqual(["--model", "opus"]);
    expect(args).toContain("mcp__context7");
    expect(args).toContain(cycleDir); // a coordinator writes the whole cycle folder
    expect(args).toContain(`Edit(/${join(cycleDir, "**")})`);
    expect(args).toContain(`Edit(/${join(run.dir, "**/events.jsonl")})`);
    expect(args).toContain(`Read(/${join(run.dir, "**")})`);
    expect(args.indexOf("--permission-mode")).toBeGreaterThan(args.indexOf("--add-dir"));
  });

  test("an MCP server missing from the registry is refused", () => {
    const { run } = setup({ sources: "## grill\n- mcp: nope\n" });
    expect(() => claudeArgs(run, "grill", "grill-coord", "c", currentCycleDir(run))).toThrow(/MCP server "nope"/);
  });

  test("a role without a prompt file is refused", () => {
    const { run } = setup();
    expect(() => claudeArgs(run, "grill", "nobody", "c", currentCycleDir(run))).toThrow(/no role prompt/);
  });
});
