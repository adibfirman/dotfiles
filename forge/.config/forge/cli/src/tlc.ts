import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Refused } from "./append";

/** A real JDK: $FORGE_JAVA, $JAVA_HOME, Homebrew OpenJDK, then java on PATH (on macOS /usr/bin/java is only a placeholder). */
export function javaBin(): string {
  const candidates = [
    process.env.FORGE_JAVA,
    process.env.JAVA_HOME && join(process.env.JAVA_HOME, "bin", "java"),
    "/opt/homebrew/opt/openjdk/bin/java",
    "/opt/homebrew/opt/openjdk@21/bin/java",
    "/opt/homebrew/opt/openjdk@17/bin/java",
  ].filter((c): c is string => Boolean(c));
  return candidates.find((c) => existsSync(c)) ?? "java";
}

/** Run TLC on the one .tla + .cfg pair in a model folder. Output goes to <dir>/tlc.out. */
export function tlc(dirArg: string): { code: number; verdict: "PASS" | "COUNTEREXAMPLE" | "ERROR"; tail: string } {
  const dir = resolve(dirArg);
  const jar = process.env.FORGE_TLA_JAR ?? join(homedir(), ".local", "share", "forge", "tla2tools.jar");
  if (!existsSync(jar)) throw new Refused(`tla2tools.jar not found: ${jar}`);
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const tla = files.filter((f) => f.endsWith(".tla") && !f.includes("_TTrace_"));
  const cfg = files.filter((f) => f.endsWith(".cfg"));
  if (tla.length !== 1 || cfg.length !== 1) throw new Refused(`${dir} needs exactly one .tla and one .cfg (found ${tla.length} and ${cfg.length})`);
  const r = spawnSync(javaBin(), ["-XX:+UseParallelGC", "-cp", jar, "tlc2.TLC", "-workers", "auto", "-metadir", join(dir, ".tlc"), "-config", cfg[0], tla[0]], {
    cwd: dir, encoding: "utf8", env: process.env, timeout: 10 * 60_000,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  writeFileSync(join(dir, "tlc.out"), out);
  const verdict = /No error has been found/.test(out) ? "PASS" : /is violated|were violated|Deadlock reached/.test(out) ? "COUNTEREXAMPLE" : "ERROR";
  return { code: r.status ?? 1, verdict, tail: out.split("\n").slice(-25).join("\n") };
}
