import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadState } from "../src/append";
import { allow, disallow, force, settings, setCap, setModels, unforce } from "../src/config";
import { claudeArgs } from "../src/spawn";
import { currentCycleDir } from "../src/append";
import { add, setup, toExec } from "./helpers";

test("settings: defaults, then project overrides marked as project", () => {
  const env = setup();
  let s = settings(env.repo);
  expect(s.models["grill-coord"]).toEqual({ value: "opus", from: "default" });
  expect(s.models["unit"]).toEqual({ value: "sonnet", from: "default" });
  expect(s.cap).toEqual({ value: 4, from: "default" });
  expect(s.sources.grill.allow).toContain("Bash(git log:*)");
  setModels(env.repo, ["unit=opus", "grill-coord=haiku"]);
  setCap(env.repo, 2);
  s = settings(env.repo);
  expect(s.models["unit"]).toEqual({ value: "opus", from: "project" });
  expect(s.cap).toEqual({ value: 2, from: "project" });
  setModels(env.repo, ["unit=default"]);
  expect(settings(env.repo).models["unit"].from).toBe("default");
  expect(readFileSync(join(env.repo, ".forge", "models.md"), "utf8")).toContain("- grill-coord: haiku");
});

test("allow and disallow: project entries per phase, deny floor and unknown MCP refused", () => {
  const env = setup();
  allow(env.repo, "exec", "bash", "pnpm lint");
  allow(env.repo, "exec", "bash", "pnpm lint"); // no duplicate
  allow(env.repo, "grill", "mcp", "context7");
  let s = settings(env.repo);
  expect(s.project.exec).toEqual([{ key: "bash", value: "pnpm lint" }]);
  expect(s.sources.exec.allow).toContain("Bash(pnpm lint:*)");
  expect(s.sources.grill.mcp).toContain("context7");
  expect(() => allow(env.repo, "exec", "bash", "git push --force")).toThrow(/blocked by the deny floor/);
  expect(() => allow(env.repo, "grill", "mcp", "nope")).toThrow(/not in ~\/.claude\/mcp-servers.json/);
  expect(() => allow(env.repo, "deploy", "bash", "x")).toThrow(/phase must be/);
  disallow(env.repo, "exec", "bash", "pnpm lint");
  s = settings(env.repo);
  expect(s.project.exec).toEqual([]);
  expect(s.sources.exec.allow).not.toContain("Bash(pnpm lint:*)");
});

test("bad values are refused", () => {
  const env = setup();
  expect(() => setModels(env.repo, ["nobody=opus"])).toThrow(/unknown role/);
  expect(() => setModels(env.repo, ["unit=gpt"])).toThrow(/opus, sonnet, haiku, or default/);
  expect(() => setCap(env.repo, 9)).toThrow(/1 to 8/);
});

test("the project cap applies from the next cycle", () => {
  const env = setup({ cap: 4 });
  setCap(env.repo, 2);
  expect(loadState(env.run).state.cap).toBe(4); // this cycle keeps its cap
  toExec(env.run);
  add(env.run, "phase_done");
  add(env.run, "cycle_open", undefined, { start: "exec", slug: "next" });
  expect(loadState(env.run).state.cap).toBe(2);
});

test("force: lifts the floor rule for this repo and phase only; never-lift rules refused; force push stays denied", () => {
  const env = setup();
  const run = env.run;
  expect(() => allow(env.repo, "exec", "bash", "git push")).toThrow("deny floor");
  const f = force(env.repo, "exec", "bash", "git push");
  expect(f).toEqual({ key: "bash", value: "git push", rule: "Bash(git push:*)", lifts: ["Bash(git push:*)"] });
  const s = settings(env.repo);
  expect(s.sources.exec.allow).toContain("Bash(git push:*)");
  expect(s.sources.grill.allow).not.toContain("Bash(git push:*)");
  expect(s.sources.exec.forced).toHaveLength(1);

  const { args } = claudeArgs(run, "exec", "unit", "u1", currentCycleDir(run));
  const allowed = args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--disallowedTools"));
  const denied = args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--add-dir"));
  expect(allowed).toContain("Bash(git push:*)");
  expect(denied).not.toContain("Bash(git push:*)");
  expect(denied).toContain("Bash(git push --force:*)");
  const settingsFile = JSON.parse(readFileSync(args[args.indexOf("--settings") + 1], "utf8"));
  expect(settingsFile.permissions.deny).not.toContain("Bash(git push:*)");
  // Another phase still has the full floor.
  const grill = claudeArgs(run, "grill", "fact-finder", "f1", currentCycleDir(run)).args;
  expect(grill.slice(grill.indexOf("--disallowedTools") + 1)).toContain("Bash(git push:*)");

  expect(() => force(env.repo, "exec", "tools", "Edit(~/.claude/**)")).toThrow("never lift");
  unforce(env.repo, "exec", "bash", "git push");
  expect(settings(env.repo).sources.exec.allow).not.toContain("Bash(git push:*)");
});
