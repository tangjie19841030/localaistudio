import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createImageGenerator } from "../src/ai/imageGen.js";
import type { ImageGenError, ImageGenerator } from "../src/ai/imageGen.js";
import { createProjectsStore } from "../src/store/projects.js";
import { defaultSettings, writeSettings, type StudioSettings } from "../src/store/settings.js";
import { PNG_1X1 } from "./visual-fixtures.js";

/**
 * U7 contract tests for POST /api/projects/:id/image-gen and the shared asset
 * hash chain. The generator is ALWAYS a scripted deps seam or a stubbed fetch
 * — no real image model is called. A static source lock (C5) asserts the
 * production wiring constructs no fake: tests own every fake in THIS file.
 */

let dataDir: string;
let baseDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(join(tmpdir(), "studio-image-gen-"));
  baseDir = join(dataDir, "projects");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(dataDir, { recursive: true, force: true });
});

const PROJECT_INPUT = {
  name: "图像生成页",
  productType: "移动端",
  targetUsers: "设计师",
  goal: "出图",
  referenceLinks: [],
  brandRules: "",
  projectType: "ui",
};

async function createProject(app: ReturnType<typeof createApp>, type: "ui" | "ppt" = "ui"): Promise<string> {
  const res = await app.request("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...PROJECT_INPUT, projectType: type }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { meta: { id: string } };
  return body.meta.id;
}

function makeApp(generator?: ImageGenerator) {
  return createApp(createProjectsStore(baseDir), { dataDir, imageGenerator: generator });
}

function post(app: ReturnType<typeof createApp>, id: string, body: unknown) {
  return app.request(`/api/projects/${id}/image-gen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const PNG_DATA_URL = `data:image/png;base64,${PNG_1X1.toString("base64")}`;

/** Scripted generator seam: outcomes are queued per call. */
function fakeGenerator(outcome: Awaited<ReturnType<ImageGenerator["generate"]>>, available = true): ImageGenerator {
  return {
    available,
    generate: vi.fn(async () => outcome),
  };
}

describe("C1 POST /api/projects/:id/image-gen 成功路径", () => {
  it("200：生成 PNG 经 saveProjectImage 哈希落盘，src 可 GET 回同字节", async () => {
    const app = makeApp(fakeGenerator({ ok: true, dataUrl: PNG_DATA_URL }));
    const id = await createProject(app);
    const res = await post(app, id, { prompt: "一张蓝色登录页头图" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { src: string; bytes: number };
    expect(body.bytes).toBe(PNG_1X1.length);
    expect(body.src).toMatch(new RegExp(`^/api/projects/${id}/assets/[0-9a-f]{40}\\.png$`));

    // Disk product, not route self-report: the hash-named file must exist.
    const file = body.src.split("/").pop()!;
    const onDisk = await fs.readFile(join(baseDir, id, "assets", file));
    expect(onDisk.equals(PNG_1X1)).toBe(true);

    // U7 GET gate: ui projects read the asset back, byte-identical.
    const fetched = await app.request(body.src);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await fetched.arrayBuffer()).equals(PNG_1X1)).toBe(true);
  });

  it("生产真实接线：不传 seam 时走 settings→真 HTTP（fetch stub），含 Authorization 头", async () => {
    const settings: StudioSettings = {
      ...defaultSettings(),
      provider: "openai-compat",
      openai: { baseUrl: "https://img.example.com/v1", apiKey: "sk-image-9001", model: "gpt-4o-mini" },
      imageGen: { model: "dall-e-xyz" },
    };
    await writeSettings(dataDir, settings);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://img.example.com/v1/images/generations");
      const sent = JSON.parse(init!.body as string) as Record<string, unknown>;
      expect(sent).toMatchObject({ model: "dall-e-xyz", prompt: "封面图", n: 1, response_format: "b64_json" });
      expect(init!.headers).toMatchObject({ Authorization: "Bearer sk-image-9001" });
      return new Response(
        JSON.stringify({ data: [{ b64_json: PNG_1X1.toString("base64") }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = makeApp(); // no generator seam
    const id = await createProject(app);
    const res = await post(app, id, { prompt: "封面图" });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("C2 501 image_gen_unavailable", () => {
  it("默认 settings（imageGen.model 空）→ 501 + 设置指引", async () => {
    const app = makeApp();
    const id = await createProject(app);
    const res = await post(app, id, { prompt: "x" });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("image_gen_unavailable");
    expect(body.message).toContain("设置");
  });

  it("配了 model 但无 apiKey → 501", async () => {
    await writeSettings(dataDir, { ...defaultSettings(), imageGen: { model: "dall-e-xyz" } });
    const app = makeApp();
    const id = await createProject(app);
    const res = await post(app, id, { prompt: "x" });
    expect(res.status).toBe(501);
    expect((await res.json() as { error: string }).error).toBe("image_gen_unavailable");
  });

  it("settings 看似可用但注入 seam available=false 仍 501（永不静默降级）", async () => {
    const app = makeApp(fakeGenerator({ ok: false, error: { kind: "not_configured" } }, false));
    const id = await createProject(app);
    const res = await post(app, id, { prompt: "x" });
    expect(res.status).toBe(501);
  });
});

describe("C3 502 / 504 错误矩阵", () => {
  it("model_rejected → 502 image_gen_failed 且 message 透传", async () => {
    const error: ImageGenError = { kind: "model_rejected", message: "内容策略拒绝" };
    const app = makeApp(fakeGenerator({ ok: false, error }));
    const id = await createProject(app);
    const res = await post(app, id, { prompt: "x" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("image_gen_failed");
    expect(body.message).toBe("内容策略拒绝");
  });

  it("timeout → 504 image_gen_timeout", async () => {
    const app = makeApp(fakeGenerator({ ok: false, error: { kind: "timeout", message: "图像生成超时（60 秒）" } }));
    const id = await createProject(app);
    const res = await post(app, id, { prompt: "x" });
    expect(res.status).toBe(504);
    expect((await res.json() as { error: string }).error).toBe("image_gen_timeout");
  });

  it("no_key typed error（available=true 但竞态丢 key）→ 501", async () => {
    const app = makeApp(fakeGenerator({ ok: false, error: { kind: "no_key" } }));
    const id = await createProject(app);
    expect((await post(app, id, { prompt: "x" })).status).toBe(501);
  });
});

describe("C4 400 invalid_body", () => {
  it("prompt 空字符串 / 纯空白 → 400", async () => {
    const app = makeApp();
    const id = await createProject(app);
    for (const prompt of ["", "   "]) {
      const res = await post(app, id, { prompt });
      expect(res.status).toBe(400);
      expect((await res.json() as { error: string }).error).toBe("invalid_body");
    }
  });

  it("prompt 超 500 字 → 400", async () => {
    const app = makeApp();
    const id = await createProject(app);
    const res = await post(app, id, { prompt: "a".repeat(501) });
    expect(res.status).toBe(400);
  });

  it("非 JSON / 缺字段 → 400", async () => {
    const app = makeApp();
    const id = await createProject(app);
    const res = await post(app, id, '{ broken');
    expect(res.status).toBe(400);
  });
});

describe("项目与磁盘错误", () => {
  it("未知项目 id → 404（优先于模型调用）", async () => {
    const app = makeApp(fakeGenerator({ ok: true, dataUrl: PNG_DATA_URL }));
    const res = await post(app, "00000000-0000-4000-8000-000000000000", { prompt: "x" });
    expect(res.status).toBe(404);
  });

  it("非 UUID id → 400 invalid_id", async () => {
    const app = makeApp();
    const res = await post(app, "not-a-uuid", { prompt: "x" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe("invalid_id");
  });

  it("非 ui 项目（ppt）→ 400 project_type_mismatch", async () => {
    const app = makeApp(fakeGenerator({ ok: true, dataUrl: PNG_DATA_URL }));
    const id = await createProject(app, "ppt");
    const res = await post(app, id, { prompt: "x" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe("project_type_mismatch");
  });

  it("模型返回非图片字节（magic bytes 失败）→ 500 export_failed，不留半成品语义", async () => {
    const garbage = `data:image/png;base64,${Buffer.from("definitely-not-a-png").toString("base64")}`;
    const app = makeApp(fakeGenerator({ ok: true, dataUrl: garbage }));
    const id = await createProject(app);
    const res = await post(app, id, { prompt: "x" });
    expect(res.status).toBe(500);
    expect((await res.json() as { error: string }).error).toBe("export_failed");
  });
});

describe("C6 资产 GET 放行与路径安全", () => {
  it("路径穿越文件名 → 404", async () => {
    const app = makeApp();
    const id = await createProject(app);
    // Same precedent as ppt-import.test.ts: the hash-name regex + jailedPath
    // are the defense; any non-{sha1}.{ext} name is a flat 404.
    const res = await app.request(`/api/projects/${id}/assets/../secret`);
    expect(res.status).toBe(404);
  });

  it("合法哈希名但文件不存在 → 404；ppt 项目既有资产行为不受影响（存在性 404 同形）", async () => {
    const app = makeApp();
    const uiId = await createProject(app);
    const missing = `${"a".repeat(40)}.png`;
    expect((await app.request(`/api/projects/${uiId}/assets/${missing}`)).status).toBe(404);
    const pptId = await createProject(app, "ppt");
    expect((await app.request(`/api/projects/${pptId}/assets/${missing}`)).status).toBe(404);
  });
});

describe("createImageGenerator 单元", () => {
  it("available：model 空或 key 空均为 false；都配置才 true", () => {
    expect(createImageGenerator(defaultSettings()).available).toBe(false);
    expect(createImageGenerator({ ...defaultSettings(), imageGen: { model: "x" } }).available).toBe(false);
    const ready = createImageGenerator({
      ...defaultSettings(),
      openai: { baseUrl: "https://x/v1", apiKey: "k", model: "" },
      imageGen: { model: "img" },
    });
    expect(ready.available).toBe(true);
  });

  it("未配置时 generate 返回 typed error，不发网络请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const g = createImageGenerator(defaultSettings());
    const out = await g.generate("x");
    expect(out.ok).toBe(false);
    expect((out as { ok: false; error: ImageGenError }).error.kind).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HTTP 4xx → model_rejected；AbortError → timeout", async () => {
    const ready: StudioSettings = {
      ...defaultSettings(),
      openai: { baseUrl: "https://x/v1", apiKey: "k", model: "" },
      imageGen: { model: "img" },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));
    const rejected = await createImageGenerator(ready).generate("x");
    expect(rejected).toMatchObject({ ok: false, error: { kind: "model_rejected" } });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }),
    );
    const timedOut = await createImageGenerator(ready).generate("x");
    expect(timedOut).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });

  it("200 但缺 b64_json → model_rejected", async () => {
    const ready: StudioSettings = {
      ...defaultSettings(),
      openai: { baseUrl: "https://x/v1", apiKey: "k", model: "" },
      imageGen: { model: "img" },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));
    const out = await createImageGenerator(ready).generate("x");
    expect(out).toMatchObject({ ok: false, error: { kind: "model_rejected" } });
  });
});

describe("C5 生产源码零 mock 构造（grep 锁）", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const readSrc = (p: string) => fs.readFile(join(here, p), "utf8");

  it("imageGenRoutes.ts 不含任何 mock/fake/stub 构造（fakes 只属于本测试文件）", async () => {
    const src = await readSrc("../src/ai/imageGenRoutes.ts");
    expect(/\b(mock|fake|stub)\b/i.test(src)).toBe(false);
  });

  it("app.ts 不 import mock 模块；image-gen 挂载只透传 opts seam（生产永不构造假生成器）", async () => {
    const src = await readSrc("../src/app.ts");
    expect(/from "\.\/ai\/mock(\.js)?"/.test(src)).toBe(false);
    const mount = src.match(/registerImageGenRoutes\(app, \{[\s\S]*?\}\);/);
    expect(mount).not.toBeNull();
    expect(mount![0]).toContain("generator: opts?.imageGenerator");
  });
});
