import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// apps/server/src/paths.ts → 仓库根（向上 4 级：src → server → apps → 根）
const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");

/**
 * 数据目录解析：绝对路径原样生效；相对路径锚定到仓库根（与默认值同锚点），
 * 不随进程 cwd 漂移（pnpm 脚本的 cwd 是 apps/server，E2E/测试依赖这一点）。
 */
export function getDataDir(): string {
  return process.env.STUDIO_DATA_DIR
    ? resolve(repoRoot, process.env.STUDIO_DATA_DIR)
    : join(repoRoot, "data");
}

export function getProjectsDir(): string {
  return join(getDataDir(), "projects");
}

export function ensureProjectsDir(): string {
  const dir = getProjectsDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
