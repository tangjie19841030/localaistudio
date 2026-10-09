import { spawn, spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import JSZip from "jszip";

const EXCLUDED_DIRS = new Set(["node_modules", ".vite", "dist"]);

/** Zip the project dir (excluding node_modules/.vite/dist) into a Buffer. */
export async function exportZip(projectDir: string): Promise<Buffer> {
  const zip = new JSZip();
  const files = await collectFiles(projectDir, projectDir);
  for (const [relPath, abs] of files) {
    zip.file(relPath, await fs.readFile(abs));
  }
  const content = await zip.generateAsync({ type: "nodebuffer" });
  return content;
}

/** Walk the tree skipping excluded dirs; returns [relative, absolute] pairs. */
async function collectFiles(root: string, dir: string): Promise<[string, string][]> {
  const out: [string, string][] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw err;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(root, abs)));
    } else if (entry.isFile()) {
      out.push([abs.slice(root.length + 1).replaceAll("\\", "/"), abs]);
    }
  }
  return out;
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
}

export interface CommandSpec {
  cmd: string;
  args: string[];
  label: string;
}

export interface CheckRunner {
  /** Run one command; resolve with exit code, reject on spawn failure. */
  (spec: CommandSpec, cwd: string, timeoutMs: number): Promise<{ code: number | null; output: string }>;
}

export interface RunChecksOptions {
  /** Test seam: replace real subprocess execution. */
  runner?: CheckRunner;
  /** Skip the install step entirely (tests without a real toolchain). */
  skipInstall?: boolean;
  /** Total budget for all steps; default 180s. */
  timeoutMs?: number;
  /** Treat an existing node_modules dir as "installed". */
  isInstalled?: (projectDir: string) => Promise<boolean>;
  /** Force the eslint step even when no config file is present (tests). */
  forceEslint?: boolean;
}

const OUTPUT_TAIL_CHARS = 5000;

/**
 * pnpm entry resolution for Windows (P1: drop the shell:true injection
 * surface). `spawn("pnpm", ...)` needs a shell on Windows because pnpm
 * installs as pnpm.cmd — but shell:true also re-parses every argument
 * through cmd.exe. Instead:
 * 1. pnpm's local shim home (same entry preview/processes.ts uses);
 * 2. `where pnpm` result when it is a real .exe (spawn can exec it directly);
 * 3. last resort: pnpm.cmd through an explicit cmd /c invocation — args are
 *    passed as argv entries (spawn with an .exe never re-parses them), only
 *    the fixed literal command name goes through cmd.
 * Resolved once and cached; null on non-Windows (spawn finds "pnpm" on PATH).
 */
let pnpmSpawnCache: { cmd: string; args: string[] } | null | undefined;

function resolvePnpmSpawn(): { cmd: string; args: string[] } | null {
  if (process.platform !== "win32") return null;
  const cjs = resolve(
    process.env.USERPROFILE ?? "",
    ".local",
    "pnpm",
    "package",
    "bin",
    "pnpm.cjs",
  );
  if (existsSync(cjs)) return { cmd: process.execPath, args: [cjs] };
  const where = spawnSync("where", ["pnpm"], { encoding: "utf8" });
  const exe = where.status === 0 ? where.stdout.split(/\r?\n/).find((l) => l.endsWith(".exe")) : undefined;
  if (exe) return { cmd: exe, args: [] };
  return { cmd: "cmd", args: ["/d", "/s", "/c", "pnpm.cmd"] };
}

/** Spawn spec for "pnpm <args...>" on the current platform (no shell). */
function pnpmSpawnSpec(args: string[]): { cmd: string; args: string[] } {
  pnpmSpawnCache ??= resolvePnpmSpawn();
  return pnpmSpawnCache ? { cmd: pnpmSpawnCache.cmd, args: [...pnpmSpawnCache.args, ...args] } : { cmd: "pnpm", args };
}

/** Real runner: spawn, collect stdout+stderr tail, enforce a per-step timeout. */
const defaultRunner: CheckRunner = (spec, cwd, timeoutMs) =>
  new Promise((resolve, reject) => {
    // pnpm steps run through the resolved pnpm entry; other cmds (none today,
    // but the spec allows them) spawn directly. Never shell:true (P1 hardening).
    const launch = spec.cmd === "pnpm" ? pnpmSpawnSpec(spec.args) : { cmd: spec.cmd, args: spec.args };
    const child = spawn(launch.cmd, launch.args, {
      cwd,
      env: { ...process.env },
    });
    let output = "";
    const append = (chunk: Buffer | string) => {
      output = (output + String(chunk)).slice(-OUTPUT_TAIL_CHARS * 2);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`检查步骤超时（${spec.label}）`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output: output.slice(-OUTPUT_TAIL_CHARS) });
    });
  });

const defaultIsInstalled = async (projectDir: string): Promise<boolean> => {
  try {
    await fs.access(join(projectDir, "node_modules"));
    return true;
  } catch {
    return false;
  }
};

/** eslint only runs when a config file is present (generated scaffolds may omit it). */
const defaultHasEslintConfig = async (projectDir: string): Promise<boolean> => {
  const candidates = [
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "eslint.config.ts",
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
  ];
  for (const name of candidates) {
    try {
      await fs.access(join(projectDir, name));
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
};

/**
 * Pre-export checks inside the project dir:
 * optional offline install → tsc --noEmit → eslint (when configured) → vite build.
 * Every step runs even after a failure (collect all errors); any failure → ok=false.
 * eslint is skipped when the project has no eslint config (generated scaffolds
 * without lint setup stay green rather than failing on a missing binary).
 *
 * KNOWN RISK (out of scope for this change): these commands run inside the
 * exported project's directory, so a malicious package.json there could run
 * arbitrary lifecycle scripts via pnpm install. Generated projects come from
 * our own scaffold, so the exposure is a corrupted store payload.
 */
export async function runChecks(
  projectDir: string,
  opts?: RunChecksOptions,
): Promise<CheckResult> {
  const runner = opts?.runner ?? defaultRunner;
  const deadline = Date.now() + (opts?.timeoutMs ?? 180_000);
  const errors: string[] = [];

  const steps: CommandSpec[] = [];
  const installed = opts?.isInstalled
    ? await opts.isInstalled(projectDir)
    : await defaultIsInstalled(projectDir);
  if (!opts?.skipInstall && !installed) {
    steps.push({
      cmd: "pnpm",
      args: ["install", "--offline", "--config.proxy=", "--config.https-proxy="],
      label: "pnpm install --offline",
    });
  }
  steps.push({ cmd: "pnpm", args: ["exec", "tsc", "--noEmit"], label: "tsc --noEmit" });
  const hasEslint = opts?.forceEslint === true || (await defaultHasEslintConfig(projectDir));
  if (hasEslint) {
    steps.push({ cmd: "pnpm", args: ["exec", "eslint", "."], label: "eslint" });
  }
  steps.push({ cmd: "pnpm", args: ["exec", "vite", "build"], label: "vite build" });

  for (const spec of steps) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      errors.push(`${spec.label} 跳过：检查总时限（${(opts?.timeoutMs ?? 180_000) / 1000}s）已耗尽`);
      continue;
    }
    try {
      const { code, output } = await runner(spec, projectDir, remaining);
      if (code !== 0) {
        errors.push(
          `${spec.label} 失败（exit ${code ?? "killed"}）\n${output.slice(-OUTPUT_TAIL_CHARS)}`,
        );
      }
    } catch (err) {
      errors.push(`${spec.label} 无法执行: ${(err as Error).message}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
