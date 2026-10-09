import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createProjectsStore, type ProjectBundle } from "../src/store/projects.js";
import { runChatStream } from "../src/ai/routes.js";
import { buildSystemPrompt } from "../src/ai/systemPrompt.js";
import { defaultSettings, writeSettings, type StudioSettings } from "../src/store/settings.js";
import { getProvider, type ChatMessage, type ChatProvider } from "../src/ai/provider.js";

let dataDir: string;
let app: ReturnType<typeof createApp>;

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KAAA";
const PNG_DATA_URL_2 = "data:image/png;base64,iVBORw0KBBB";

const newProjectInput = {
  name: "运营工作台",
  productType: "后台",
  targetUsers: "运营",
  goal: "看数据",
  referenceLinks: [],
  brandRules: "不要渐变",
};

beforeEach(async () => {
  dataDir = await fs.mkdtemp(join(tmpdir(), "studio-multimodal-"));
  app = createApp(createProjectsStore(join(dataDir, "projects")), { dataDir });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function createProject(): Promise<ProjectBundle> {
  const res = await app.request("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newProjectInput),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as ProjectBundle;
}

async function collectSse(res: Response): Promise<Record<string, unknown>[]> {
  const decoder = new TextDecoder();
  let raw = "";
  const reader = res.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  const events: Record<string, unknown>[] = [];
  for (const frame of raw.split("\n\n")) {
    for (const line of frame.split("\n")) {
      if (line.startsWith("data:")) events.push(JSON.parse(line.slice(5).trim()));
    }
  }
  return events;
}

const openaiSettings = (): StudioSettings => ({
  ...defaultSettings(),
  provider: "openai-compat",
  openai: { baseUrl: "https://api.example.com/v1", apiKey: "sk-test-1234", model: "gpt-4o-mini" },
  temperature: 0.3,
});

const ollamaSettings = (): StudioSettings => ({
  ...defaultSettings(),
  provider: "ollama",
  ollama: { baseUrl: "http://127.0.0.1:11434", model: "qwen2.5-vl" },
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

function stubOpenAiOk(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(sseStream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', "data: [DONE]\n\n"]), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubOllamaOk(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(ndjsonStream([JSON.stringify({ message: { content: "ok" }, done: true })]), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): {
  messages: { role: string; content: unknown; images?: string[] }[];
} {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body)) as {
    messages: { role: string; content: unknown; images?: string[] }[];
  };
}

describe("openai-compat 多模态请求体", () => {
  it("带 images：content 变成 text + image_url 内容分片", async () => {
    const fetchMock = stubOpenAiOk();
    await getProvider(openaiSettings()).complete({
      messages: [{ role: "user", content: "修复这些问题", images: [PNG_DATA_URL, PNG_DATA_URL_2] }],
    });
    const parts = bodyOf(fetchMock).messages[0]?.content as {
      type: string;
      text?: string;
      image_url?: { url: string };
    }[];
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ type: "text", text: "修复这些问题" });
    expect(parts[1]).toEqual({ type: "image_url", image_url: { url: PNG_DATA_URL } });
    expect(parts[2]).toEqual({ type: "image_url", image_url: { url: PNG_DATA_URL_2 } });
  });

  it("无 images：content 保持纯字符串（与改动前逐字节一致）", async () => {
    const fetchMock = stubOpenAiOk();
    await getProvider(openaiSettings()).complete({
      messages: [
        { role: "system", content: "系统提示" },
        { role: "user", content: "生成" },
      ],
    });
    expect(bodyOf(fetchMock).messages).toEqual([
      { role: "system", content: "系统提示" },
      { role: "user", content: "生成" },
    ]);
  });

  it("images 为空数组：仍走纯字符串 content", async () => {
    const fetchMock = stubOpenAiOk();
    await getProvider(openaiSettings()).complete({
      messages: [{ role: "user", content: "生成", images: [] }],
    });
    expect(bodyOf(fetchMock).messages[0]?.content).toBe("生成");
  });
});

describe("ollama 多模态请求体", () => {
  it("带 images：message.images 为去掉 data url 前缀的裸 base64", async () => {
    const fetchMock = stubOllamaOk();
    await getProvider(ollamaSettings()).complete({
      messages: [{ role: "user", content: "修复这些问题", images: [PNG_DATA_URL, "AAAplain"] }],
    });
    const message = bodyOf(fetchMock).messages[0];
    expect(message?.content).toBe("修复这些问题");
    // 前缀被剥离；本身就是裸 base64 的原样保留
    expect(message?.images).toEqual(["iVBORw0KAAA", "AAAplain"]);
    expect(message?.images?.[0]?.startsWith("data:")).toBe(false);
  });

  it("无 images：message 不带 images 键（与改动前逐字节一致）", async () => {
    const fetchMock = stubOllamaOk();
    await getProvider(ollamaSettings()).complete({
      messages: [
        { role: "system", content: "系统提示" },
        { role: "user", content: "早" },
      ],
    });
    expect(bodyOf(fetchMock).messages).toEqual([
      { role: "system", content: "系统提示" },
      { role: "user", content: "早" },
    ]);
    expect("images" in (bodyOf(fetchMock).messages[0] as object)).toBe(false);
  });
});

describe("mock provider 回显截图数量", () => {
  it("带 2 张图：plan 文本含「收到 2 张截图」", async () => {
    const result = await getProvider(defaultSettings()).complete({
      messages: [{ role: "user", content: "修改 target:m_stat_1", images: [PNG_DATA_URL, PNG_DATA_URL_2] }],
    });
    const parsed = JSON.parse(result.text) as { plan: string; ops: { id: string }[] };
    expect(parsed.plan).toContain("收到 2 张截图");
    expect(parsed.ops[0]?.id).toBe("m_stat_1"); // target marker 行为不变
  });

  it("无图：文本不含回显后缀（既有断言不受影响）", async () => {
    const result = await getProvider(defaultSettings()).complete({
      messages: [{ role: "user", content: "生成一个运营工作台" }],
    });
    expect(result.text).not.toContain("收到");
  });
});

describe("provider 不支持多模态时降级", () => {
  it("images 被丢弃，请求正常完成且无 error 帧", async () => {
    const bundle = await createProject();
    const seen: ChatMessage[][] = [];
    const textOnly: ChatProvider = {
      supportsImages: false,
      async detect() {
        return { id: "text-only", available: true };
      },
      async complete(req) {
        seen.push(req.messages);
        return { text: JSON.stringify({ plan: "纯文本降级", ops: [] }) };
      },
    };
    const events: Record<string, unknown>[] = [];
    await runChatStream(
      { store: createProjectsStore(join(dataDir, "projects")), dataDir, provider: textOnly },
      {
        projectId: bundle.meta.id,
        messages: [{ role: "user", content: "修复溢出问题", images: [PNG_DATA_URL] }],
        mode: "patch",
        scope: { nodeIds: ["m_stat_1"] },
        requestId: "req-degrade",
      },
      new AbortController(),
      async (ev) => void events.push(ev),
    );
    expect(events.filter((e) => "error" in e)).toHaveLength(0);
    expect(events.filter((e) => "done" in e)).toHaveLength(1);
    const userMsg = seen[0]?.find((m) => m.role === "user");
    expect(userMsg?.content).toBe("修复溢出问题"); // 文本原样保留
    expect(userMsg?.images).toBeUndefined(); // 图片被剥离
    // 问题清单在文本里，纯文本模型信息不缺失
    expect(seen[0]?.[0]?.content).toContain("允许修改的节点 id");
  });

  it("支持多模态的 provider 收到原始 images", async () => {
    const bundle = await createProject();
    const seen: ChatMessage[][] = [];
    const visionProvider: ChatProvider = {
      supportsImages: true,
      async detect() {
        return { id: "vision", available: true };
      },
      async complete(req) {
        seen.push(req.messages);
        return { text: JSON.stringify({ plan: "已看图", ops: [] }) };
      },
    };
    await runChatStream(
      { store: createProjectsStore(join(dataDir, "projects")), dataDir, provider: visionProvider },
      {
        projectId: bundle.meta.id,
        messages: [{ role: "user", content: "修复溢出问题", images: [PNG_DATA_URL] }],
        mode: "patch",
        scope: { nodeIds: ["m_stat_1"] },
        requestId: "req-vision",
      },
      new AbortController(),
      async () => {},
    );
    expect(seen[0]?.find((m) => m.role === "user")?.images).toEqual([PNG_DATA_URL]);
  });

  it("SSE 端到端：mock provider 收到 images 并回显，无 error 帧", async () => {
    const bundle = await createProject();
    await writeSettings(dataDir, defaultSettings()); // provider=mock
    const res = await app.request("/api/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: bundle.meta.id,
        messages: [
          { role: "user", content: "修改 target:m_stat_1 修复溢出", images: [PNG_DATA_URL] },
        ],
        mode: "patch",
        requestId: crypto.randomUUID(),
      }),
    });
    expect(res.status).toBe(200);
    const events = await collectSse(res);
    expect(events.filter((e) => "error" in e)).toHaveLength(0);
    const done = events.find((e) => "done" in e);
    expect(String(done?.text)).toContain("收到 1 张截图");
  });
});

describe("buildSystemPrompt 修复约束", () => {
  it("patch + scope.nodeIds：列出允许节点并声明不可修改项", async () => {
    const bundle = await createProject();
    const prompt = buildSystemPrompt(bundle, "patch", { nodeIds: ["n_a", "n_b"] });
    expect(prompt).toContain("允许修改的节点 id");
    expect(prompt).toContain("n_a、n_b");
    expect(prompt).toContain("共 2 个");
    expect(prompt).toContain("不可修改");
    expect(prompt).toContain("rootId");
  });

  it("generate 模式不注入范围约束", async () => {
    const bundle = await createProject();
    const prompt = buildSystemPrompt(bundle, "generate", undefined);
    expect(prompt).not.toContain("允许修改的节点 id");
  });

  it("组件目录暴露精确 props 字段，避免模型把 Text.content 写成 text", async () => {
    const bundle = await createProject();
    const prompt = buildSystemPrompt(bundle, "generate", undefined);
    expect(prompt).toContain("Text（正文，叶子；属性：content、muted）");
    expect(prompt).toContain("Button（按钮，叶子；属性：label、variant、size）");
    expect(prompt).toContain("props 只能使用目录列出的属性字段");
  });

  it("allowAllTokens 且无节点范围时，把自然语言暖色主题明确约束为 set_token", async () => {
    const bundle = await createProject();
    const prompt = buildSystemPrompt(bundle, "patch", { nodeIds: [], allowAllTokens: true });
    expect(prompt).toContain("用户提出主题、配色、换色、暖色或品牌色等请求时");
    expect(prompt).toContain('["color","brand"]');
    expect(prompt).toContain("#C2410C");
    expect(prompt).toContain("#D97706");
    expect(prompt).toContain("不要调用 update_props、insert_node、remove_node 或 move_node");
  });

  it("设计指南使用 Grid/Stack 的属性单位，并给出对应像素值", async () => {
    const bundle = await createProject();
    const prompt = buildSystemPrompt(bundle, "generate", undefined);

    expect(prompt).toContain("Grid 的 columns 按内容取 2-4、gap 属性取 2-4（对应 8-16px；默认 gap=4 对应 16px）");
    expect(prompt).toContain("Stack gap 属性取 4-6（对应 16-24px）");
    expect(prompt).not.toContain("Grid 的 columns 按内容取 2-4、gap 取 8-16");
    expect(prompt).not.toContain("默认 4 过挤");
    expect(prompt).not.toContain("区块间 Stack gap 16-24");
  });

  it("色彩规范要求 brand 有辨识度，禁止黑白灰但仍允许中性色与浅背景", async () => {
    const bundle = await createProject();
    const prompt = buildSystemPrompt(bundle, "generate", undefined);

    expect(prompt).toContain("brand 必须是有辨识度的品牌色");
    expect(prompt).toContain("禁止黑、白、灰或与 text 几乎相同的颜色作为 brand");
    expect(prompt).toContain("text/muted/border/surface 等中性角色允许使用黑白灰与浅色");
  });
});
