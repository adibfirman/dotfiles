import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { findRun, loadRun } from "../src/append";
import { init } from "../src/init";
import { addRepos, branchRepos, childRepos, listRepos } from "../src/repos";
import { spawnNode } from "../src/spawn";
import { status } from "../src/status";
import { runs } from "../src/registry";
import { add, hcCalls, setup, toExec } from "./helpers";

const g = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A workspace root (not git) with repos, each pushed to its own bare origin with a default branch. */
function workspace(repos: Record<string, string>) {
  const env = setup(); // forge home, fake hc, registry
  const root = realpathSync(mkdtempSync(join(tmpdir(), "forge-ws-")));
  for (const [name, base] of Object.entries(repos)) {
    const bare = join(root, `.origins/${name}.git`);
    mkdirSync(bare, { recursive: true });
    g(bare, "init", "-q", "--bare", "-b", base);
    const path = join(root, name);
    mkdirSync(path);
    g(path, "init", "-q", "-b", base);
    writeFileSync(join(path, "README.md"), `# ${name}\n`);
    g(path, "add", "-A");
    g(path, "commit", "-q", "-m", "init");
    g(path, "remote", "add", "origin", bare);
    g(path, "push", "-q", "origin", base);
    g(path, "remote", "set-head", "origin", base);
    g(path, "checkout", "-q", "-b", "my-own-work"); // the user's checkout is elsewhere; forge must not touch it
  }
  mkdirSync(join(root, "loose-folder"));
  const ctx = join(root, "ctx.md");
  writeFileSync(ctx, "---\nticket: ABC-42\ntype: fix\n---\n# Cross-repo change\n");
  return { env, root, ctx };
}

describe("workspace mode", () => {
  test("a root with repos starts a workspace run at its own .forge/", () => {
    const { root, ctx } = workspace({ api: "develop", web: "main" });
    expect(childRepos(root)).toEqual(["api", "web"]);
    const run = init(ctx, root);
    expect(run.dir).toBe(join(root, ".forge", "tickets", "ABC-42"));
    expect(status(run)).toMatchObject({ mode: "workspace", repos: [] });
    expect(findRun(undefined, root).dir).toBe(run.dir); // found from the root with no git
  });

  test("a root without repos is refused with a hint", () => {
    const env = setup();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "forge-empty-")));
    writeFileSync(join(root, "c.md"), "---\nticket: none\n---\nx\n");
    expect(() => init(join(root, "c.md"), root)).toThrow(/holds no git repos. Run git init/);
  });

  test("repo add: base from origin/HEAD, detached worktree at origin/<base>, checkout untouched", () => {
    const { root, ctx } = workspace({ api: "develop", web: "main" });
    const run = init(ctx, root);
    const added = addRepos(run, ["api", "web"]);
    expect(added.map((r) => [r.name, r.base])).toEqual([["api", "develop"], ["web", "main"]]);
    const wt = join(root, "worktrees", "ABC-42", "api");
    expect(existsSync(join(wt, "README.md"))).toBe(true);
    expect(g(wt, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD"); // detached
    expect(g(join(root, "api"), "rev-parse", "--abbrev-ref", "HEAD")).toBe("my-own-work");
    expect(addRepos(run, ["api"])).toEqual([]); // already in the run
    expect(() => addRepos(run, ["loose-folder"])).toThrow(/not a git repo/);
    expect(runs().find((r) => r.dir === run.dir)?.repos?.map((r: any) => r.name)).toEqual(["api", "web"]);
  });

  test("repo add with a base override", () => {
    const { root, ctx } = workspace({ api: "develop" });
    const run = init(ctx, root);
    g(join(root, "api"), "push", "-q", "origin", "my-own-work:main");
    expect(addRepos(run, ["api@main"])[0].base).toBe("main");
  });

  test("repo branch: <type>/<ticket> from the newest origin/<base>", () => {
    const { root, ctx } = workspace({ api: "develop" });
    const run = init(ctx, root);
    addRepos(run, ["api"]);
    // someone pushes to develop after grill read it
    const other = join(root, "other");
    g(root, "clone", "-q", "-b", "develop", join(root, ".origins/api.git"), other);
    writeFileSync(join(other, "NEW.md"), "new\n");
    g(other, "add", "-A");
    g(other, "commit", "-q", "-m", "newer");
    g(other, "push", "-q", "origin", "develop");
    const [r] = branchRepos(run);
    expect(r.branch).toBe("fix/ABC-42");
    expect(g(r.worktree, "rev-parse", "--abbrev-ref", "HEAD")).toBe("fix/ABC-42");
    expect(existsSync(join(r.worktree, "NEW.md"))).toBe(true);
  });

  test("a unit runs in its repo's worktree; one without a repo is refused", () => {
    const { env, root, ctx } = workspace({ api: "develop" });
    const run = init(ctx, root);
    addRepos(run, ["api"]);
    toExec(run);
    add(run, "node_add", "u-api", { wave: 100, files: ["api/src/a.ts"], repo: "api", role: "unit" });
    add(run, "node_add", "u-bad", { wave: 100, files: ["x"], role: "unit" });
    spawnNode(run, "unit", "u-api", "change api");
    const call = hcCalls(env).find((c) => c[0] === "run")!;
    expect(call[call.indexOf("--cwd") + 1]).toBe(join(root, "worktrees", "ABC-42", "api"));
    expect(() => spawnNode(run, "unit", "u-bad", "x")).toThrow(/needs data.repo/);
    add(run, "node_add", "g-bad", { wave: 100, role: "gate-beh" });
    expect(() => spawnNode(run, "gate-beh", "g-bad", "x")).toThrow(/needs data.repo/);
  });

  test("units of two repos may use the same relative path (files carry the repo)", () => {
    const { root, ctx } = workspace({ api: "develop", web: "main" });
    const run = init(ctx, root);
    toExec(run);
    add(run, "node_add", "u-api", { wave: 100, files: ["api/src/index.ts"], repo: "api" });
    add(run, "node_add", "u-web", { wave: 100, files: ["web/src/index.ts"], repo: "web" });
    expect(() => add(run, "node_add", "u-api2", { wave: 100, files: ["api/src/index.ts"], repo: "api" })).toThrow(/both change/);
  });
});
