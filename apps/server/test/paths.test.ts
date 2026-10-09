import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureProjectsDir, getDataDir, getProjectsDir } from "../src/paths.js";

const ORIGINAL = process.env.STUDIO_DATA_DIR;

beforeEach(() => {
  delete process.env.STUDIO_DATA_DIR;
});

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.STUDIO_DATA_DIR;
  } else {
    process.env.STUDIO_DATA_DIR = ORIGINAL;
  }
});

describe("paths 数据目录解析（Task 4 审查采纳）", () => {
  it("无环境变量时默认 <repoRoot>/data", () => {
    const dir = getDataDir();
    expect(dir.endsWith("data")).toBe(true);
    expect(dir).not.toContain(join("apps", "server"));
  });

  it("相对路径锚定到仓库根（不随 cwd 漂移）", () => {
    process.env.STUDIO_DATA_DIR = "e2e/.data";
    const dir = getDataDir();
    // 锚点必须是 paths.ts 所在模块计算的仓库根：包含 pnpm-workspace.yaml 的目录。
    // 锚点须从测试模块自身位置向上 4 级推导（test → server → apps → 根），与进程 cwd 无关；
    // 不能从被测结果反推锚点：修复后的路径不含 apps/server 段，反推会导致断言不可满足。
    const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");
    expect(existsSync(join(repoRoot, "pnpm-workspace.yaml"))).toBe(true);
    expect(dir).toBe(join(repoRoot, "e2e", ".data"));
    expect(dir).not.toContain(join("apps", "server"));
  });

  it("绝对路径原样生效", async () => {
    const abs = await fs.mkdtemp(join(tmpdir(), "studio-abs-"));
    process.env.STUDIO_DATA_DIR = abs;
    expect(getDataDir()).toBe(abs);
  });

  it("getProjectsDir 是 <dataDir>/projects；ensureProjectsDir 创建并返回该目录", async () => {
    const abs = await fs.mkdtemp(join(tmpdir(), "studio-proj-"));
    process.env.STUDIO_DATA_DIR = abs;
    expect(getProjectsDir()).toBe(join(abs, "projects"));
    const created = ensureProjectsDir();
    expect(created).toBe(join(abs, "projects"));
    expect(existsSync(join(abs, "projects"))).toBe(true);
  });
});
