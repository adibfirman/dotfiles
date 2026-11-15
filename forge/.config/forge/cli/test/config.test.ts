import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadState } from "../src/append";
import { allow, disallow, settings, setCap, setModels } from "../src/config";
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
