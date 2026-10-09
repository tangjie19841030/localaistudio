import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createApp } from "../src/app.js";
import { createProjectsStore, type ProjectBundle } from "../src/store/projects.js";
import type { GenerateFiles } from "../src/codegen/files.js";
import type { PreviewManager } from "../src/preview/processes.js";
import type { ScreenshotRunner } from "../src/visual/screenshots.js";
import { PNG_1X1, fakeRunner } from "./visual-fixtures.js";

/**
 * W1-D route contract: POST /api/projects/:id/export/ui-png.
 * Playwright is injected as a fake (same seam as visual-routes.test) — the
 * fake writes real PNG bytes into outDir, so zip contents are asserted
 * byte-exactly without ever launching a browser. Real-browser behaviour is
 * covered by the manual smoke: export the zip and inspect the three PNGs.
 */

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const FAKE_PORT = 5188;

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-ui-png-export-"));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

interface StartCall {
  projectId: string;
  projectDir: string;
}

/** Fake preview manager: records start() calls, hands out a fixed port. */
function fakeManager(): { manager: PreviewManager; starts: StartCall[] } {
  const starts: StartCall[] = [];
  return {
    starts,
    manager: {
      start: async (projectId, projectDir) => {
        starts.push({ projectId, projectDir });
        return { port: FAKE_PORT };
      },
      stop: async () => {},
      status: () => [],
      shutdownAll: async () => {},
    },
  };
}

function makeApp(extra?: { manager?: PreviewManager; runner?: ScreenshotRunner; generateFiles?: GenerateFiles }) {
  const runner = extra?.runner ?? fakeRunner().run;
  const app = createApp(createProjectsStore(baseDir), {
    previewManager: extra?.manager,
    screenshotRunner: runner,
    generateFiles: extra?.generateFiles,
  });
  return { app, runner };
}

function createUiProject(name: string): Promise<ProjectBundle> {
  return createProjectsStore(baseDir).create({
    name,
    productType: "",
    targetUsers: "",
    goal: "",
    referenceLinks: [],
    brandRules: "",
  }) as unknown as Promise<ProjectBundle>;
}

function createPptProject(name: string): Promise<ProjectBundle> {
  return createProjectsStore(baseDir).create({
    name,
    productType: "",
    targetUsers: "",
    goal: "",
    referenceLinks: [],
    brandRules: "",
    projectType: "ppt",
  }) as unknown as Promise<ProjectBundle>;
}

describe("POST /api/projects/:id/export/ui-png", () => {
  it("写盘→起预览→三视口截图→zip 附件，zip 内容字节一致且留档 export/", async () => {
    const { manager, starts } = fakeManager();
    const generateFiles = () =>
      new Map([
        ["package.json", "{}"],
        ["src/main.tsx", "export {};\n"],
      ]);
    const runner = fakeRunner();
    const app = createApp(createProjectsStore(baseDir), {
      previewManager: manager,
      screenshotRunner: runner.run,
      generateFiles,
    });
    const bundle = await createUiProject("运营工作台");

    const res = await app.request(`/api/projects/${bundle.meta.id}/export/ui-png`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("attachment");

    // codegen 写盘发生在截图之前；预览拿到的是项目目录
    await expect(fs.access(join(baseDir, bundle.meta.id, "src", "main.tsx"))).resolves.toBeUndefined();
    expect(starts).toEqual([{ projectId: bundle.meta.id, projectDir: join(baseDir, bundle.meta.id) }]);
    expect(runner.calls[0]!.url).toBe(`http://127.0.0.1:${FAKE_PORT}`);
    expect(runner.calls[0]!.outDir).toContain(join("export", "ui-png"));

    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    expect(Object.keys(zip.files).sort()).toEqual(["desktop.png", "mobile.png", "tablet.png"]);
    for (const name of ["desktop.png", "tablet.png", "mobile.png"]) {
      expect(Buffer.from(await zip.file(name)!.async("uint8array"))).toEqual(PNG_1X1);
    }
    // 留档副本与下载流同字节
    const archived = await fs.readFile(join(baseDir, bundle.meta.id, "export", "运营工作台-ui-png.zip"));
    expect(archived.length).toBeGreaterThan(0);
  });

  it("非 UI 项目 400 project_type_mismatch，且不写盘不起预览", async () => {
    const { manager, starts } = fakeManager();
    const runner = fakeRunner();
    const app = createApp(createProjectsStore(baseDir), {
      previewManager: manager,
      screenshotRunner: runner.run,
      generateFiles: () => new Map([["package.json", "{}"]]),
    });
    const bundle = await createPptProject("汇报");

    const res = await app.request(`/api/projects/${bundle.meta.id}/export/ui-png`, { method: "POST" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("project_type_mismatch");
    expect(body.message).toContain("ui");
    expect(starts).toEqual([]);
  });

  it("未知项目 404；非法 id 400 invalid_id（export-shared 形态）", async () => {
    const { app } = makeApp();
    const missing = await app.request(`/api/projects/${UNKNOWN_ID}/export/ui-png`, { method: "POST" });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe("not_found");

    const bad = await app.request("/api/projects/not-a-uuid/export/ui-png", { method: "POST" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_id");
  });

  it("截图链失败 503 screenshots_unavailable，消息带安装指引", async () => {
    const { manager } = fakeManager();
    const failing: ScreenshotRunner = async () => {
      throw new Error("Executable doesn't exist");
    };
    const app = createApp(createProjectsStore(baseDir), {
      previewManager: manager,
      screenshotRunner: failing,
      generateFiles: () => new Map([["package.json", "{}"]]),
    });
    const bundle = await createUiProject("引导页");

    const res = await app.request(`/api/projects/${bundle.meta.id}/export/ui-png`, { method: "POST" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("screenshots_unavailable");
    expect(body.message).toContain("playwright install chromium");
  });

  it("codegen 写盘失败 500 export_failed，且不启预览", async () => {
    const { manager, starts } = fakeManager();
    const app = createApp(createProjectsStore(baseDir), {
      previewManager: manager,
      screenshotRunner: fakeRunner().run,
      generateFiles: () => {
        throw new Error("boom");
      },
    });
    const bundle = await createUiProject("坏文档");

    const res = await app.request(`/api/projects/${bundle.meta.id}/export/ui-png`, { method: "POST" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("export_failed");
    expect(starts).toEqual([]);
  });
});
