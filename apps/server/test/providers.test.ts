import { tmpdir } from "node:os";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateDocument } from "@studio/schema-core";
import { createApp } from "../src/app.js";
import { createProjectsStore } from "../src/store/projects.js";
import { defaultSettings, type StudioSettings } from "../src/store/settings.js";
import { getProvider } from "../src/ai/provider.js";

let dataDir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(join(tmpdir(), "studio-providers-"));
  app = createApp(createProjectsStore(join(dataDir, "projects")), { dataDir });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(dataDir, { recursive: true, force: true });
});

const openaiSettings = (apiKey = "sk-test-1234"): StudioSettings => ({
  ...defaultSettings(),
  provider: "openai-compat",
  openai: { baseUrl: "https://api.example.com/v1", apiKey, model: "gpt-4o-mini" },
  temperature: 0.3,
});

const ollamaSettings = (): StudioSettings => ({
  ...defaultSettings(),
  provider: "ollama",
  ollama: { baseUrl: "http://127.0.0.1:11434", model: "qwen2.5" },
});

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function ndjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  return sseStream(lines.map((l) => `${l}\n`));
}

describe("mockProvider", () => {
  it("生成 marker：返回完整 StudioDocument JSON，分 5 段流式回调", async () => {
    const provider = getProvider(defaultSettings());
    const deltas: string[] = [];
    const result = await provider.complete({
      messages: [{ role: "user", content: "帮我生成一个运营工作台" }],
      onDelta: (chunk) => deltas.push(chunk),
    });
    const parsed = JSON.parse(result.text) as { plan: string; document: unknown };
    expect(typeof parsed.plan).toBe("string");
    const doc = validateDocument(parsed.document);
    expect(doc.pages[0]!.nodes.find((n) => n.id === doc.pages[0]!.rootId)?.type).toBe("AppShell");
    expect(deltas.length).toBe(5);
    expect(deltas.join("")).toBe(result.text);
  });

  it("patch marker：返回 ops 且 target:<id> 被提取", async () => {
    const provider = getProvider(defaultSettings());
    const result = await provider.complete({
      messages: [{ role: "user", content: "修改这个组件 target:n_abc12345 颜色改深" }],
    });
    const parsed = JSON.parse(result.text) as {
      plan: string;
      ops: { op: string; id: string; props: Record<string, unknown> }[];
    };
    expect(typeof parsed.plan).toBe("string");
    expect(parsed.ops[0]?.op).toBe("node.update");
    expect(parsed.ops[0]?.id).toBe("n_abc12345");
    expect(parsed.ops[0]?.props).toBeTruthy();
  });

  it("badjson marker：返回非 JSON 文本", async () => {
    const provider = getProvider(defaultSettings());
    const result = await provider.complete({
      messages: [{ role: "user", content: "修改 badjson" }],
    });
    expect(() => JSON.parse(result.text)).toThrow();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("detect 恒可用", async () => {
    const provider = getProvider(defaultSettings());
    const detected = await provider.detect();
    expect(detected).toMatchObject({ id: "mock", available: true });
  });
});

describe("openaiProvider", () => {
  it("请求形状：stream=true、多模态 content、Authorization 头", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        sseStream([
          'data: {"choices":[{"delta":{"content":"he"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = getProvider(openaiSettings());
    const deltas: string[] = [];
    const result = await provider.complete({
      messages: [
        { role: "user", content: "生成", images: ["data:image/png;base64,AAA"] },
      ],
      onDelta: (c) => deltas.push(c),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as {
      model: string;
      stream: boolean;
      temperature: number;
      messages: { role: string; content: { type: string; text?: string; image_url?: { url: string } }[] }[];
    };
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.stream).toBe(true);
    expect(body.temperature).toBe(0.3);
    expect(body.messages[0]?.content[0]).toMatchObject({ type: "text", text: "生成" });
    expect(body.messages[0]?.content[1]).toMatchObject({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAA" },
    });
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-test-1234");
    expect(result.text).toBe("hello");
    expect(deltas).toEqual(["he", "llo"]);
  });

  it("detect 不发网络，按配置齐备返回", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ready = getProvider(openaiSettings());
    expect(await ready.detect()).toMatchObject({ id: "openai-compat", available: true });

    const missing = getProvider({
      ...defaultSettings(),
      provider: "openai-compat",
      openai: { baseUrl: "https://api.example.com/v1", apiKey: "", model: "" },
    });
    const detected = await missing.detect();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(detected.available).toBe(false);
    expect(detected.detail).toBeTruthy();
  });
});

describe("ollamaProvider", () => {
  it("detect 成功：GET /api/tags", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "qwen2.5" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const detected = await getProvider(ollamaSettings()).detect();
    expect(detected.available).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:11434/api/tags");
  });

  it("detect 失败：网络错误回 available=false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const detected = await getProvider(ollamaSettings()).detect();
    expect(detected.available).toBe(false);
  });

  it("complete：NDJSON 逐行累积 message.content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        ndjsonStream([
          JSON.stringify({ message: { content: "早" }, done: false }),
          JSON.stringify({ message: { content: "安" }, done: false }),
          JSON.stringify({ message: { content: "" }, done: true }),
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = getProvider(ollamaSettings());
    const deltas: string[] = [];
    const result = await provider.complete({
      messages: [{ role: "user", content: "早" }],
      onDelta: (c) => deltas.push(c),
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(String(init.body)) as { model: string; stream: boolean };
    expect(body.model).toBe("qwen2.5");
    expect(body.stream).toBe(true);
    expect(result.text).toBe("早安");
    expect(deltas).toEqual(["早", "安"]);
  });
});

describe("GET /api/model/providers", () => {
  it("聚合三 provider 检测结果", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no network")));
    const res = await app.request("/api/model/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: { id: string; available: boolean }[] };
    const byId = Object.fromEntries(body.providers.map((p) => [p.id, p.available]));
    expect(byId.mock).toBe(true);
    expect(byId.ollama).toBe(false); // fetch 被 stub 为拒绝
    expect(body.providers.length).toBe(3);
  });
});

describe("POST /api/model/test", () => {
  it("mock provider 恒 ok 且带 sample", async () => {
    const res = await app.request("/api/model/test", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sample: string; detail?: string };
    expect(body.ok).toBe(true);
    expect(typeof body.sample).toBe("string");
    expect(body.sample.length).toBeGreaterThan(0);
  });
});
