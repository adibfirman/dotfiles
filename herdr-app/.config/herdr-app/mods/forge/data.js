// Where the forge mod gets its data: git for the repo, the forge CLI for the run, files for text.
import { exec, home, readTextFile } from "herdr";

const forgeBin = () => `${home()}/.local/bin/forge`;

/** The main checkout and the top folder of the repo that holds cwd, or { error } outside git. */
export async function repoOf(cwd) {
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd }).catch((e) => ({ code: -1, stderr: String(e?.message ?? e) }));
  if (common.code !== 0) {
    // A workspace root (a folder of repos, not a repo itself) holds its runs in .forge/tickets: it is the run's root.
    const ws = await exec("test", ["-d", `${cwd}/.forge/tickets`]).catch(() => null);
    if (ws?.code === 0) return { main: cwd, top: cwd, workspace: true };
    return { error: `${cwd}: ${(common.stderr || "").trim() || `git exit ${common.code}`}` };
  }
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
  return { main: common.stdout.trim().replace(/\/\.git\/?$/, ""), top: top.stdout.trim() };
}

/** The runs of a repo, newest first: [{ dir, ticket, worktree, base }]. */
export async function listRuns(main) {
  const r = await exec("sh", ["-c", 'ls -t "$1"/.forge/tickets/*/HEAD 2>/dev/null', "forge-mod", main]).catch(() => null);
  const dirs = (r?.stdout ?? "").split("\n").filter(Boolean).map((f) => f.replace(/\/HEAD$/, ""));
  const out = [];
  for (const dir of dirs) {
    const meta = await readJson(`${dir}/run.json`);
    if (meta) out.push({ dir, ticket: meta.ticket, worktree: meta.worktree, base: meta.base ?? "main" });
  }
  return out;
}

export async function readJson(path) {
  try {
    const text = await readTextFile(path);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Run the forge CLI. `run` adds --run. */
export async function forge(args, { run, cwd, timeout } = {}) {
  const r = await exec(forgeBin(), [...args, ...(run ? ["--run", run] : [])], { cwd, timeout: timeout ?? 30_000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  return { ok: r.code === 0, out: r.stdout, err: (r.stderr || r.stdout || "").trim() };
}

