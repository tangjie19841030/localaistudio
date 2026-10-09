import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createProjectsStore } from "../src/store/projects.js";
import type { ChatMessage, ChatProvider } from "../src/ai/provider.js";

/**
 * T48 contract tests for POST /api/ai/import-image. The provider is always a
 * scripted seam (no real browser / vision model is started); the fake returns a
 * v1-shaped single-page JSON, which the route funnels through validateDocument.
 */

let dataDir: string;

const PNG_1 = "data:image/png;base64,iVBORw0KAAA";
const PNG_2 = "data:image/png;base64,iVBORw0KBBB";

beforeEach(async () => {
  dataDir = await fs.mkdtemp(join(tmpdir(), "studio-import-image-"));
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

/** v1-shaped single page reply (no tokens -> withDefaultTokens fills them). */
function docReply(name: string): string {
  return JSON.stringify({
    documentVersion: 1,
    name,
    rootId: "root",
    nodes: [
      { id: "root", type: "Container", props: {}, children: ["h"] },
      { id: "h", type: "Heading", props: { text: name, level: 1 }, children: [] },
    ],
  });
}

interface FakeProvider {
  provider: ChatProvider;
  calls: ChatMessage[][];
}

/** Scripted provider: `reply(callIndex, messages)` supplies the raw text. */
function scripted(reply: (callIndex: number, messages: ChatMessage[]) => string): FakeProvider {
  const calls: ChatMessage[][] = [];
  const provider: ChatProvider = {
    supportsImages: true,
    detect: async () => ({ id: "fake-vision", available: true }),
    complete: async (req) => {
      calls.push(req.messages);
      return { text: reply(calls.length - 1, req.messages) };
    },
  };
  return { provider, calls };
}

function makeApp(provider?: ChatProvider) {
  return createApp(createProjectsStore(join(dataDir, "projects")), { dataDir, provider });
}

function post(app: ReturnType<typeof createApp>, body: unknown, headers?: Record<string, string>) {
  return app.request("/api/ai/import-image", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

interface ImportResponse {
  document: { documentVersion: number; name: string; pages: { id: string; name: string; rootId: string; nodes: { id: string }[] }[] };
  warnings: string[];
  pages: number;
}

describe("POST /api/ai/import-image 成功路径", () => {
  it("单图：一图一 Page 的 v2 文档，warnings 为空", async () => {
    const { provider, calls } = scripted(() => docReply("登录页"));
    const res = await post(makeApp(provider), { images: [PNG_1] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ImportResponse;
    expect(body.document.documentVersion).toBe(2);
    expect(body.document.pages).toHaveLength(1);
    expect(body.pages).toBe(1);
    expect(body.warnings).toEqual([]);
    expect(body.document.name).toBe("导入页面");
    // The image reached the provider on the user turn, one image per call.
    const user = calls[0]!.find((m) => m.role === "user");
    expect(user?.images).toEqual([PNG_1]);
  });

  it("4 图：按图序一图一 Page，跨页节点 id 唯一", async () => {
    const { provider, calls } = scripted((i) => docReply(`页面 ${i + 1}`));
    const res = await post(makeApp(provider), {
      images: [PNG_1, PNG_2, PNG_1, PNG_2],
      projectName: "批量导入",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ImportResponse;
    expect(body.document.name).toBe("批量导入");
    expect(body.pages).toBe(4);
    expect(body.document.pages.map((p) => p.name)).toEqual(["页面 1", "页面 2", "页面 3", "页面 4"]);
    expect(calls).toHaveLength(4);
    const nodeIds = body.document.pages.flatMap((p) => p.nodes.map((n) => n.id));
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    const pageIds = body.document.pages.map((p) => p.id);
    expect(new Set(pageIds).size).toBe(4);
  });

  it("mode/styleHint 透传进 user prompt；mode 默认 screenshot", async () => {
    const { provider, calls } = scripted(() => docReply("线框页"));
    const res = await post(makeApp(provider), {
      images: [PNG_1],
      mode: "wireframe",
      styleHint: "深色主题，紧凑间距",
    });
    expect(res.status).toBe(200);
    const user = calls[0]!.find((m) => m.role === "user");
    expect(user?.content).toContain("深色主题，紧凑间距");
    expect(calls[0]![0]?.content).toContain("手绘草图");
  });
});

describe("POST /api/ai/import-image 重试预算", () => {
  it("首次坏 JSON → 回喂错误后第 2 轮成功（共 2 次调用）", async () => {
    const { provider, calls } = scripted((i) => (i === 0 ? "not json at all" : docReply("重试成功页")));
    const res = await post(makeApp(provider), { images: [PNG_1] });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    const retryPrompt = calls[1]!.find((m) => m.role === "user")?.content ?? "";
    expect(retryPrompt).toContain("输出不是合法 JSON");
    const body = (await res.json()) as ImportResponse;
    expect(body.document.pages[0]?.name).toBe("重试成功页");
  });

  it("预算耗尽（每图 3 轮）：坏图跳过进 warnings，好图照常落页", async () => {
    // Call 1..3 (image 1) always bad JSON; call 4 (image 2) good.
    const { provider, calls } = scripted((i) => (i < 3 ? "{broken" : docReply("第二张")));
    const res = await post(makeApp(provider), { images: [PNG_1, PNG_2] });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(4); // 3 rounds for the bad image + 1 for the good one
    const body = (await res.json()) as ImportResponse;
    expect(body.pages).toBe(1);
    expect(body.document.pages[0]?.name).toBe("第二张");
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toContain("图 1");
    expect(body.warnings[0]).toContain("已跳过");
  });

  it("校验失败（未知组件类型）也走重试回喂，错误文本进入下一轮 prompt", async () => {
    // Empty node table: pageSchema requires nodes.min(1) -> validateDocument throws.
    const badDoc = JSON.stringify({
      documentVersion: 1,
      name: "坏",
      rootId: "root",
      nodes: [],
    });
    const { provider, calls } = scripted((i) => (i === 0 ? badDoc : docReply("修正后")));
    const res = await post(makeApp(provider), { images: [PNG_1] });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.find((m) => m.role === "user")?.content).toContain("上一次转换未通过校验");
  });
});

describe("POST /api/ai/import-image 失败契约", () => {
  it("全部图片失败 → 422 import_failed，message 带逐图错误", async () => {
    const { provider } = scripted(() => "never json");
    const res = await post(makeApp(provider), { images: [PNG_1, PNG_2] });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; message: string; issues: string[] };
    expect(body.error).toBe("import_failed");
    expect(body.message).toContain("全部图片转换失败");
    expect(body.issues).toHaveLength(2);
  });

  it("provider 抛异常：折进重试预算，最终 422 而不是 500", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      supportsImages: true,
      detect: async () => ({ id: "boom", available: true }),
      complete: async () => {
        calls += 1;
        throw new Error("connection refused");
      },
    };
    const res = await post(makeApp(provider), { images: [PNG_1] });
    expect(res.status).toBe(422);
    expect(calls).toBe(3);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("import_failed");
    expect(body.message).toContain("connection refused");
  });

  it("supportsImages=false → 422，不静默降级为文本", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      supportsImages: false,
      detect: async () => ({ id: "text-only", available: true }),
      complete: async () => {
        calls += 1;
        return { text: docReply("不该被调用") };
      },
    };
    const res = await post(makeApp(provider), { images: [PNG_1] });
    expect(res.status).toBe(422);
    expect(calls).toBe(0); // the model was never asked
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("import_failed");
    expect(body.message).toContain("不支持图片输入");
  });

  it("超大 body → 413 payload_too_large", async () => {
    const { provider } = scripted(() => docReply("x"));
    const res = await post(makeApp(provider), { images: [PNG_1] }, {
      "Content-Length": String(41_000_000),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("payload_too_large");
    expect(body.message).toContain("40MB");
  });

  it("坏 body → 400 invalid_body（空 body / 缺图 / 超 4 张 / 非 dataURL / styleHint 超长）", async () => {
    const app = makeApp();
    for (const bad of [
      "",
      "{}",
      JSON.stringify({ images: [] }),
      JSON.stringify({ images: [PNG_1, PNG_2, PNG_1, PNG_2, PNG_1] }),
      JSON.stringify({ images: ["https://example.com/a.png"] }),
      JSON.stringify({ images: [PNG_1], mode: "nope" }),
      JSON.stringify({ images: [PNG_1], styleHint: "x".repeat(501) }),
    ]) {
      const res = await post(app, bad);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; issues: string[] };
      expect(body.error).toBe("invalid_body");
      expect(Array.isArray(body.issues)).toBe(true);
    }
  });
});
