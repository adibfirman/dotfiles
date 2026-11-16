import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { currentCycleDir } from "../src/append";
import { claudeArgs } from "../src/spawn";
import { setup } from "./helpers";

// The real forge home in dotfiles, not the temp one from setup().
const HOME = join(import.meta.dir, "..", "..");
const roles = readdirSync(join(HOME, "roles")).filter((f) => f.endsWith(".md") && !f.startsWith("_")).map((f) => f.replace(/\.md$/, ""));
const PHASE: Record<string, string> = {
  "grill-coord": "grill", "grill-me-coord": "grill", asker: "grill", "fact-finder": "grill", decider: "grill",
  "verify-coord": "verify", "tla-writer": "verify",
  "exec-coord": "exec", planner: "exec", unit: "exec", "gate-beh": "exec", "gate-spec": "exec", "gate-sec": "exec", "gate-review": "exec", commit: "exec",
  classifier: "gate",
};

describe("real role files", () => {
  test("every role has a phase here and a model in models.md", () => {
    const models = readFileSync(join(HOME, "models.md"), "utf8");
    expect(roles.sort()).toEqual(Object.keys(PHASE).sort());
    for (const r of roles) expect(models).toMatch(new RegExp(`^- ${r}: `, "m"));
  });

  test.each(roles)("%s: builds flags from the real SOURCES, deny floor, and prompt parts", (role) => {
    const { run } = setup();
    process.env.FORGE_HOME = HOME;
    process.env.FORGE_MCP_REGISTRY = join(HOME, "..", "..", "..", "claude", ".claude", "mcp-servers.json");
    const { args } = claudeArgs(run, PHASE[role], role, `${role}-1`, currentCycleDir(run));
    const prompt = readFileSync(args[args.indexOf("--append-system-prompt-file") + 1], "utf8");
    expect(prompt).toContain("# forge agent: shared rules");
    expect(prompt.includes("# forge coordinator: shared protocol")).toBe(role.endsWith("-coord") || role === "classifier");
    const allowed = args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--disallowedTools"));
    const writesCode = allowed.includes("Edit") || allowed.includes("Write");
    expect(writesCode).toBe(["unit", "commit"].includes(role));
    if (role.endsWith("-coord") || role === "classifier") expect(allowed).toContain("Bash(forge append:*)");
    else expect(allowed).not.toContain("Bash(forge append:*)");
    expect(allowed.some((a) => a.startsWith("Bash(git push"))).toBe(false);
  });
});
