#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { appendEvent, findRun, Refused } from "./append";
import { KINDS, type Data, type Kind } from "./events";
import { init } from "./init";
import { closeTerminal, drainQueue, nodeSpawnId, spawnNode } from "./spawn";
import { approve, followup, reconcile, startCoordinator } from "./agents";
import { registerExisting, runs } from "./registry";
import { addRefs, fetchAll, listRefs, refreshRef, storeRefs } from "./refs";
import { ensureProjectSources, projectCap, setCap, setModels, settings } from "./config";
import { mainCheckout } from "./append";
import { frontMatterList } from "./init";
import { dirname, resolve } from "node:path";
import { status } from "./status";
import { tlc } from "./tlc";

const USAGE = `forge: guard and spawner for forge coordinators

  forge init <context.md> [--here]            start a run: ticket worktree (or this checkout with --here), cycle 001 at grill
  forge append <kind> [--node <id>] [--data '<json>']
                                              add one checked event to the current cycle
  forge spawn <role> <node> <task>            start a node in an hc terminal (queues at the cap)
  forge spawn <role> <node> --task-file <f>   the same, with the task read from a file
  forge coord [--role classifier]             start the coordinator of the current phase
  forge approve                               the gate: approve the spec and start exec
  forge followup <text> [--source <s>] [--ref <url|path>]...
                                              a QA bug, request, gate comment, or PR review, with references
  forge refs add <url|path|JIRA-KEY>...       fetch references into the run (GitHub, Confluence, Jira, https, files, images)
  forge refs list | forge refs refresh <n>
  forge settings [--main <dir>]               models, cap, allowed tools, deny floor (default or project)
  forge config model <role>=<opus|sonnet|haiku|default>... | forge config cap <1-8> [--main <dir>]
  forge config sources-file [--main <dir>]    the project SOURCES.md path (created when missing)
  forge reconcile                             at coordinator boot: fail lost nodes, close old coordinators
  forge runs                                  every registered run on this machine, as JSON
  forge register                              add a run made before the registry existed
  forge status                                the current cycle as JSON
  forge tlc <model dir>                       run TLC on one TLA+ model

  Options: --run <dir> (else $FORGE_RUN, the branch ticket, or the only run)
  Kinds:   ${KINDS.join(", ")}
  Exit:    0 ok, 1 refused, 2 usage, 3 queued`;

// Events after which a queued node may be able to start.
const FREES_SLOT: Kind[] = ["node_done", "node_fail", "node_evolve", "phase_done", "approved", "resume"];

function takeFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined) throw new UsageError(`${name} needs a value`);
  args.splice(i, 2);
  return v;
}

class UsageError extends Error {}

function print(v: unknown) {
  console.log(JSON.stringify(v, null, 2));
}

export async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  try {
    const runFlag = takeFlag(args, "--run");
    const [cmd, ...rest] = args;
    switch (cmd) {
      case "init": {
        const here = rest.includes("--here");
        const files = rest.filter((a) => a !== "--here");
        if (files.length !== 1) throw new UsageError("forge init <context.md> [--here]");
        // refs: in the front matter are fetched first, relative to the context file. A failed ref
        // stops the start before anything is written.
        const fetched = await fetchAll(frontMatterList(readFileSync(files[0], "utf8"), "refs"), dirname(resolve(files[0])));
        const cap = Number(process.env.FORGE_CAP ?? projectCap(mainCheckout(process.cwd())) ?? 4);
        const run = init(files[0], process.cwd(), cap, here);
        storeRefs(run, fetched);
        print(status(run));
        return 0;
      }
      case "append": {
        const node = takeFlag(rest, "--node");
        const dataText = takeFlag(rest, "--data");
        if (rest.length !== 1 || !(KINDS as readonly string[]).includes(rest[0])) throw new UsageError(`forge append <kind>, kind is one of: ${KINDS.join(", ")}`);
        let data: Data | undefined;
        if (dataText !== undefined) {
          try {
            data = JSON.parse(dataText);
          } catch {
            throw new UsageError("--data is not valid JSON");
          }
          if (typeof data !== "object" || data === null || Array.isArray(data)) throw new UsageError("--data must be a JSON object");
        }
        const kind = rest[0] as Kind;
        const run = findRun(runFlag);
        const { event, cycleDir, state } = appendEvent(run, { kind, node, data });
        // A finished agent's terminal is closed (screen saved), so idle agents do not pile up.
        if ((kind === "node_done" || kind === "node_fail") && node) closeTerminal(cycleDir, nodeSpawnId(node, state.nodes.get(node)!.gen));
        const started = FREES_SLOT.includes(kind) ? drainQueue(run) : [];
        print({ ok: true, event, started });
        return 0;
      }
      case "spawn": {
        const taskFile = takeFlag(rest, "--task-file");
        if (taskFile !== undefined && rest.length === 2) {
          if (!existsSync(taskFile)) throw new UsageError(`task file not found: ${taskFile}`);
          rest.push(readFileSync(taskFile, "utf8").trim());
        }
        if (rest.length !== 3) throw new UsageError("forge spawn <role> <node> <task> | --task-file <path>");
        const r = spawnNode(findRun(runFlag), rest[0], rest[1], rest[2]);
        print(r);
        return r.status === "queued" ? 3 : 0;
      }
      case "coord": {
        const role = takeFlag(rest, "--role");
        if (rest.length) throw new UsageError("forge coord [--role classifier]");
        print(startCoordinator(findRun(runFlag), role));
        return 0;
      }
      case "approve": {
        if (rest.length) throw new UsageError("forge approve takes no arguments");
        print(approve(findRun(runFlag)));
        return 0;
      }
      case "followup": {
        const source = takeFlag(rest, "--source");
        const refs: string[] = [];
        for (let r = takeFlag(rest, "--ref"); r !== undefined; r = takeFlag(rest, "--ref")) refs.push(r);
        if (rest.length !== 1) throw new UsageError("forge followup <text> [--source qa|gate|pr|user] [--ref <url|path>]...");
        const run = findRun(runFlag);
        const added = await addRefs(run, refs); // all or nothing: a failed ref sends no follow-up
        const text = added.length ? `${rest[0]}\n\nNew references: ${added.map((e) => `refs/${e.file}`).join(", ")}` : rest[0];
        print(followup(run, text, source));
        return 0;
      }
      case "refs": {
        const [sub, ...items] = rest;
        const run = findRun(runFlag);
        if (sub === "add" && items.length) {
          print(await addRefs(run, items));
          return 0;
        }
        if (sub === "list" && !items.length) {
          print(listRefs(run));
          return 0;
        }
        if (sub === "refresh" && items.length === 1 && /^\d+$/.test(items[0])) {
          print(await refreshRef(run, Number(items[0])));
          return 0;
        }
        throw new UsageError("forge refs add <url|path|KEY>... | forge refs list | forge refs refresh <n>");
      }
      case "reconcile": {
        if (rest.length) throw new UsageError("forge reconcile takes no arguments");
        print(reconcile(findRun(runFlag)));
        return 0;
      }
      case "runs": {
        if (rest.length) throw new UsageError("forge runs takes no arguments");
        print(runs());
        return 0;
      }
      case "register": {
        if (rest.length) throw new UsageError("forge register takes no arguments");
        registerExisting(findRun(runFlag));
        print({ ok: true });
        return 0;
      }
      case "settings": {
        const main = takeFlag(rest, "--main") ?? mainCheckout(process.cwd());
        if (rest.length) throw new UsageError("forge settings [--main <dir>]");
        print(settings(main));
        return 0;
      }
      case "config": {
        const main = takeFlag(rest, "--main") ?? mainCheckout(process.cwd());
        const [what, ...vals] = rest;
        if (what === "model" && vals.length) setModels(main, vals);
        else if (what === "cap" && vals.length === 1) setCap(main, Number(vals[0]));
        else if (what === "sources-file" && !vals.length) {
          print({ file: ensureProjectSources(main) });
          return 0;
        } else throw new UsageError("forge config model <role>=<model>... | forge config cap <n> | forge config sources-file");
        print(settings(main));
        return 0;
      }
      case "status": {
        if (rest.length) throw new UsageError("forge status takes no arguments");
        print(status(findRun(runFlag)));
        return 0;
      }
      case "tlc": {
        if (rest.length !== 1) throw new UsageError("forge tlc <model dir>");
        const r = tlc(rest[0]);
        console.log(r.tail);
        console.log(`verdict: ${r.verdict}`);
        return r.verdict === "ERROR" ? 1 : 0;
      }
      case undefined:
      case "help":
      case "--help":
      case "-h":
        console.log(USAGE);
        return cmd === undefined ? 2 : 0;
      default:
        throw new UsageError(`unknown command: ${cmd}`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`usage: ${e.message}\n\n${USAGE}`);
      return 2;
    }
    if (e instanceof Refused) {
      console.error(`refused: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
