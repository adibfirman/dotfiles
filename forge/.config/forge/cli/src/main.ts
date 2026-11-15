#!/usr/bin/env bun
import { appendEvent, findRun, Refused } from "./append";
import { KINDS, type Data, type Kind } from "./events";
import { init } from "./init";
import { drainQueue, spawnNode } from "./spawn";
import { status } from "./status";
import { tlc } from "./tlc";

const USAGE = `forge: guard and spawner for forge coordinators

  forge init <context.md>                     start a run: ticket worktree, cycle 001 at grill
  forge append <kind> [--node <id>] [--data '<json>']
                                              add one checked event to the current cycle
  forge spawn <role> <node> <task>            start a node in an hc terminal (queues at the cap)
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

export function main(argv: string[]): number {
  const args = [...argv];
  try {
    const runFlag = takeFlag(args, "--run");
    const [cmd, ...rest] = args;
    switch (cmd) {
      case "init": {
        if (rest.length !== 1) throw new UsageError("forge init <context.md>");
        print(status(init(rest[0])));
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
        const { event } = appendEvent(run, { kind, node, data });
        const started = FREES_SLOT.includes(kind) ? drainQueue(run) : [];
        print({ ok: true, event, started });
        return 0;
      }
      case "spawn": {
        if (rest.length !== 3) throw new UsageError("forge spawn <role> <node> <task>");
        const r = spawnNode(findRun(runFlag), rest[0], rest[1], rest[2]);
        print(r);
        return r.status === "queued" ? 3 : 0;
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

if (import.meta.main) process.exit(main(process.argv.slice(2)));
