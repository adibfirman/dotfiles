import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addLesson, allowPrefix, checkCommands, doctor, lessons, needsOf } from "../src/checks";
import { agentPath } from "../src/env";
import { spawnNode } from "../src/spawn";
import { status } from "../src/status";
import { add, hcCalls, setup, toExec } from "./helpers";
import { commandLike, deny, force } from "../src/config";

test("checks: a pnpm repo gets the pnpm forms; a Go repo the go forms", () => {
  const env = setup();
  writeFileSync(join(env.repo, "package.json"), JSON.stringify({ scripts: { test: "vitest run", typecheck: "tsc --noEmit", lint: "eslint .", build: "vite build" } }));
  writeFileSync(join(env.repo, "pnpm-lock.yaml"), "");
  const c = checkCommands(env.repo);
  expect([c.test, c.typecheck, c.lint, c.build]).toEqual(["pnpm test", "pnpm typecheck", "pnpm lint", "pnpm build"]);
  expect(c.programs).toEqual(["pnpm", "node"]);
  const go = join(env.root, "goapp");
  mkdirSync(go);
  writeFileSync(join(go, "go.mod"), "module x\n");
  expect(checkCommands(go)).toMatchObject({ test: "go test ./...", typecheck: "go vet ./...", lint: "gofmt -l .", programs: ["go", "gofmt"] });
});

test("doctor: a program missing from the agents' PATH fails, with that PATH in the report", () => {
  const env = setup(); // a repo with no GitHub remote: no gh login check over the network
  const r = doctor([{ repo: "x", worktree: env.repo, test: null, typecheck: null, lint: null, build: null, other: [], programs: ["git", "no-such-tool-xyz"] }]);
  expect(r.ok).toBe(false);
  expect(r.items.find((i) => i.name === "no-such-tool-xyz")).toEqual({ name: "no-such-tool-xyz", ok: false, detail: "not found on the agents' PATH" });
  expect(r.items.find((i) => i.name === "git")!.ok).toBe(true);
  expect(r.path).toBe(agentPath());
});

test("needs: the newest blocked comment, until a coordinator or node starts; its phase, prefix, and what can lift it", () => {
  const env = setup();
  toExec(env.run);
  expect(needsOf(env.run)).toBeNull();
  add(env.run, "comment", undefined, { text: "blocked: unit needs git: git log --oneline -n 3" });
  expect(needsOf(env.run)).toMatchObject({ role: "unit", tool: "git", command: "git log --oneline -n 3", prefix: "git log", phase: "exec", floor: "env" });
  expect(status(env.run).needs?.prefix).toBe("git log");
  add(env.run, "comment", undefined, { text: "blocked: unit needs git push: git push origin HEAD" });
  expect(needsOf(env.run)).toMatchObject({ key: "bash", floor: "lift", deniedBy: "Bash(git push:*)" });
  deny(env.repo, "exec", "kubectl delete");
  add(env.run, "comment", undefined, { text: "blocked: unit needs kubectl: kubectl delete pod web-1" });
  expect(needsOf(env.run)).toMatchObject({ floor: "project", deniedBy: "Bash(kubectl delete:*)", prefix: "kubectl delete pod" });
  add(env.run, "comment", undefined, { text: "blocked: unit needs sudo: sudo ls" });
  expect(needsOf(env.run)!.floor).toBe("never");
  // A note, not a command: no button.
  add(env.run, "comment", undefined, { text: "blocked: fact-finder needs cluster access: kubectl/helm not allowed, the MCP needs a browser login" });
  expect(needsOf(env.run)!.floor).toBe("env");
  add(env.run, "node_add", "u1", { role: "unit", wave: 100, files: ["a.ts"] });
  spawnNode(env.run, "unit", "u1", "do it");
  expect(needsOf(env.run)).toBeNull();
  expect([allowPrefix("pnpm test src/x"), allowPrefix("go test ./..."), allowPrefix("./scripts/gen.sh --all"), allowPrefix("kubectl get pods -n web"), allowPrefix("kubectl --help")])
    .toEqual(["pnpm test", "go test", "./scripts/gen.sh", "kubectl get pods", "kubectl"]);
});

test("needs: a blocked MCP tool is checked as a tool, so the floor rule that denies it is found", () => {
  const env = setup();
  writeFileSync(join(env.home, "deny-floor.json"), JSON.stringify({ permissions: { deny: ["Bash(git push:*)", "mcp__claude_ai_Gmail", "mcp__claude_ai_Slack__slack_send_message"] } }));
  toExec(env.run);
  add(env.run, "comment", undefined, { text: "blocked: unit needs mcp__claude_ai_Slack__slack_send_message: mcp__claude_ai_Slack__slack_send_message" });
  expect(needsOf(env.run)).toMatchObject({ key: "tools", floor: "lift", deniedBy: "mcp__claude_ai_Slack__slack_send_message" });
  add(env.run, "comment", undefined, { text: "blocked: unit needs Gmail: mcp__claude_ai_Gmail__send_email" });
  expect(needsOf(env.run)).toMatchObject({ key: "tools", prefix: "mcp__claude_ai_Gmail__send_email", floor: "lift", deniedBy: "mcp__claude_ai_Gmail" });
  // The run window lifts with that key: the floor rule that blocks the tool is lifted.
  expect(force(env.repo, "exec", "tools", "mcp__claude_ai_Gmail__send_email").lifts).toEqual(["mcp__claude_ai_Gmail"]);
});

test("needs in grill: the phase is grill, so a lift goes to the grill phase; notes are refused as rules", () => {
  const env = setup();
  add(env.run, "comment", undefined, { text: "blocked: fact-finder needs git: git log -n 1" });
  expect(needsOf(env.run)!.phase).toBe("grill");
  expect(commandLike("kubectl get pods")).toBe(true);
  expect(commandLike("./scripts/gen.sh")).toBe(true);
  expect(commandLike("kubectl/helm not")).toBe(false);
  expect(() => deny(env.repo, "grill", "kubectl/helm not")).toThrow("not a command prefix");
});

test("lessons: one line each, no duplicates; every node's task points at the file", () => {
  const env = setup();
  expect(lessons(env.repo).text).toBe("");
  addLesson(env.repo, "Tests: `pnpm test <paths>`; `npx vitest` is denied.");
  addLesson(env.repo, "Tests: `pnpm test <paths>`; `npx vitest` is denied.");
  const text = lessons(env.repo).text;
  expect(text.match(/npx vitest/g)).toHaveLength(1);
  add(env.run, "node_add", "a", { role: "fact-finder" });
  spawnNode(env.run, "fact-finder", "a", "find it");
  const run = hcCalls(env).filter((c) => c[0] === "run").pop()!;
  expect(run[run.length - 1]).toContain(`Lessons from earlier blocks in this repo: ${join(env.repo, ".forge", "lessons.md")}`);
});

test("agent PATH: ~/.bun/bin and the caller's PATH, once each", () => {
  const parts = agentPath().split(":");
  expect(new Set(parts).size).toBe(parts.length);
  for (const p of (process.env.PATH ?? "").split(":").filter(Boolean)) expect(parts).toContain(p);
});
