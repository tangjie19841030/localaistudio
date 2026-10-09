import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Atomic JSON write: serialize to a sibling tmp file, then rename over the
 * target. A crash/partial write in the middle can only leave the *.tmp file
 * behind — the destination always stays a complete (previous) document,
 * which keeps projects openable after kill -9 / power loss.
 */
let seq = 0;

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = join(
    dirname(path),
    `.${path.split(/[\\/]/).pop() ?? "file"}.${process.pid}.${(seq += 1)}.tmp`,
  );
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, path);
}

/** Best-effort cleanup of stale tmp files left by an interrupted write. */
export async function removeStaleTmp(dir: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith(".") && name.endsWith(".tmp"))
      .map((name) => fs.rm(join(dir, name), { force: true }).catch(() => {})),
  );
}
