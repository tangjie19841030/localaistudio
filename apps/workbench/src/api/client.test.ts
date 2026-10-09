import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  api,
  cancelChat,
  codegenApi,
  exportProject,
  runChecks,
  startPreview,
  stopPreview,
  streamChat,
  type ChatEvent,
} from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown) {
  // 每次调用返回新的 Response 实例（真实 fetch 同样如此）：
  // Response body 只能被消费一次，同一实例被 request() 二次读取会抛 "Body is unusable"。
  return vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

describe("api client", () => {
  it("listProjects GET /api/projects", async () => {
    const fetchMock = stubFetch(200, { projects: [] });
    vi.stubGlobal("fetch", fetchMock);
    await api.listProjects();
    expect(fetchMock).toHaveBeenCalledWith("/api/projects", expect.anything());
    await expect(api.listProjects()).resolves.toEqual([]);
  });

  it("createProject POST JSON body", async () => {
    const fetchMock = stubFetch(201, { meta: {}, document: {} });
    vi.stubGlobal("fetch", fetchMock);
    await api.createProject({ name: "x", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "", projectType: "ui" });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/projects");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).name).toBe("x");
  });

  it("非 2xx 抛 ApiError", async () => {
    vi.stubGlobal("fetch", stubFetch(404, { error: "not_found" }));
    await expect(api.getProject("00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(ApiError);
  });

  it("listProjects 解包 {projects} 返回数组", async () => {
    vi.stubGlobal("fetch", stubFetch(200, { projects: [] }));
    await expect(api.listProjects()).resolves.toEqual([]);
  });

  it("saveProject PUT /api/projects/:id，body 为 {meta, document}", async () => {
    const fetchMock = stubFetch(200, { meta: {}, document: {} });
    vi.stubGlobal("fetch", fetchMock);
    const bundle = { meta: { id: "00000000-0000-4000-8000-000000000000" }, document: {} } as never;
    await api.saveProject("00000000-0000-4000-8000-000000000000", bundle);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/projects/00000000-0000-4000-8000-000000000000");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string) as { meta: unknown; document: unknown };
    expect(body.meta).toBeDefined();
    expect(body.document).toBeDefined();
  });

  it("importPptx：octet-stream 上传、mode query、错误体 message 被提取", async () => {
    const fetchMock = stubFetch(200, { document: { slides: [] }, warnings: ["w"], imported: { slides: 1, assets: 0 } });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["PK"], "模板.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    const result = await api.importPptx("00000000-0000-4000-8000-000000000000", file, "append");
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/projects/00000000-0000-4000-8000-000000000000/import/pptx?mode=append");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/octet-stream" });
    expect(init.body).toBe(file); // raw File, never JSON-wrapped
    expect(result.imported).toEqual({ slides: 1, assets: 0 });
  });

  it("importPptx：非 2xx 抛 ApiError 且 message 用服务端中文 detail", async () => {
    vi.stubGlobal("fetch", stubFetch(400, { error: "import_failed", message: "文件已加密或不是有效的 .pptx" }));
    const file = new File(["x"], "bad.pptx");
    const err = await api
      .importPptx("00000000-0000-4000-8000-000000000000", file, "replace")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).message).toContain("文件已加密");
  });

  it("uploadPptAsset：POST 原始图片到 /assets，返回资产 URL", async () => {
    const fetchMock = stubFetch(200, {
      src: "/api/projects/p/assets/deadbeef.png",
      sha1: "deadbeef",
      ext: "png",
      contentType: "image/png",
      bytes: 12,
    });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array(12)], "火把节.jpg", { type: "image/jpeg" });
    const result = await api.uploadPptAsset("p", file);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/projects/p/assets");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/octet-stream" });
    expect(init.body).toBe(file);
    expect(result.src).toBe("/api/projects/p/assets/deadbeef.png");
  });

  it("uploadPptAsset：413/400 时抛带服务端中文 message 的 ApiError", async () => {
    vi.stubGlobal("fetch", stubFetch(400, { error: "unsupported_image", message: "不支持的图片格式，仅支持 PNG / JPEG" }));
    const err = await api.uploadPptAsset("p", new File(["x"], "x.svg")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).message).toContain("不支持的图片格式");
  });

  it("服务不可达时抛带 0 状态的 ApiError（网络层归一化）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await api.listProjects().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).message).toContain("无法连接本地服务");
  });
});

describe("api client versions 端点（P1-10）", () => {
  const PID = "00000000-0000-4000-8000-000000000000";

  it("createVersion POST /api/projects/:id/versions，body {name, document}", async () => {
    const fetchMock = stubFetch(201, { versionId: "v", name: "n", createdAt: "t", projectId: PID });
    vi.stubGlobal("fetch", fetchMock);
    const doc = { documentVersion: 1, name: "x" } as never;
    const out = await api.createVersion(PID, { name: "n", document: doc });
    expect(out.versionId).toBe("v");
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/versions`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as { name: string; document: unknown };
    expect(body.name).toBe("n");
    expect(body.document).toBeDefined();
  });

  it("listVersions GET 并解包 {versions}", async () => {
    const fetchMock = stubFetch(200, { versions: [{ versionId: "v1" }] });
    vi.stubGlobal("fetch", fetchMock);
    const out = await api.listVersions(PID);
    expect(out).toEqual([{ versionId: "v1" }]);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/versions`);
    expect(init.method).toBeUndefined();
  });

  it("deleteVersion DELETE /api/projects/:id/versions/:versionId", async () => {
    const fetchMock = stubFetch(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await api.deleteVersion(PID, "v1");
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/versions/v1`);
    expect(init.method).toBe("DELETE");
  });
});

describe("streamChat SSE 解析（P2-4）", () => {
  const BODY = {
    projectId: "00000000-0000-4000-8000-000000000000",
    messages: [{ role: "user" as const, content: "生成运营工作台" }],
    mode: "generate" as const,
    requestId: "req-1",
  };

  /** Enqueue encoded SSE frames; splits stream into one read per frame (realistic chunking). */
  function sseResponse(frames: string[]): Response {
    const enc = new TextEncoder();
    const chunks = frames.map((f) => enc.encode(f));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  async function collect(body: typeof BODY, frames: string[]): Promise<{ deltas: string[]; events: ChatEvent[] }> {
    const deltas: string[] = [];
    const events: ChatEvent[] = [];
    await streamChat(body, {
      onDelta: (t) => deltas.push(t),
      onEvent: (ev) => events.push(ev),
    });
    return { deltas, events };
  }

  it("POST /api/chat/completions，逐帧解析 delta/done；delta 同时回调 onDelta", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        sseResponse([
          `data: ${JSON.stringify({ delta: '{"plan":' })}\n\n`,
          `data: ${JSON.stringify({ delta: '"规划文本"}' })}\n\n`,
          `data: ${JSON.stringify({ done: true, text: '{"plan":"规划文本"}' })}\n\n`,
        ]),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await collect(BODY, []);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/chat/completions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ mode: "generate", requestId: "req-1" });

    expect(out.deltas).toEqual(['{"plan":', '"规划文本"}']);
    // delta 帧只进 onDelta，不进 onEvent；事件流只有终态 done
    expect(out.events).toEqual([{ done: true, text: '{"plan":"规划文本"}' }]);
  });

  it("P6 tool-call/tool-result 帧：按 type 判别进 onEvent，不进 onDelta", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        sseResponse([
          `data: ${JSON.stringify({ type: "tool-call", name: "insert_node", args: {} })}\n\n`,
          `data: ${JSON.stringify({ type: "tool-result", name: "insert_node", ok: true, message: "已插入指标卡" })}\n\n`,
          `data: ${JSON.stringify({ done: true, text: "ok" })}\n\n`,
        ]),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await collect(BODY, []);
    expect(out.deltas).toEqual([]); // 工具帧不是 delta
    expect(out.events).toEqual([
      { type: "tool-call", name: "insert_node", args: {} },
      { type: "tool-result", name: "insert_node", ok: true, message: "已插入指标卡" },
      { done: true, text: "ok" },
    ]);
  });

  it("P7 可见性帧 stage/progress/heartbeat/verify-round：按 type 进 onEvent，不进 onDelta", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        sseResponse([
          `data: ${JSON.stringify({ type: "stage", id: "reading", label: "正在理解需求" })}\n\n`,
          `data: ${JSON.stringify({ type: "progress", step: 2, total: 5, label: "生成中" })}\n\n`,
          `data: ${JSON.stringify({ type: "heartbeat", at: 1690000000000 })}\n\n`,
          `data: ${JSON.stringify({ type: "verify-round", round: 1, issues: ["缺节点"] })}\n\n`,
          `data: ${JSON.stringify({ delta: "正文" })}\n\n`,
        ]),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await collect(BODY, []);
    expect(out.deltas).toEqual(["正文"]); // 仅 delta 帧进 onDelta
    expect(out.events).toEqual([
      { type: "stage", id: "reading", label: "正在理解需求" },
      { type: "progress", step: 2, total: 5, label: "生成中" },
      { type: "heartbeat", at: 1690000000000 },
      { type: "verify-round", round: 1, issues: ["缺节点"] },
    ]);
  });

  it("非 2xx 抛 ApiError（含网络层归一）", async () => {
    vi.stubGlobal("fetch", stubFetch(500, "boom"));
    await expect(streamChat(BODY, { onDelta: () => {}, onEvent: () => {} })).rejects.toBeInstanceOf(ApiError);
  });

  it("帧跨 chunk 拆开也能拼回同一事件（缓冲累积切帧）", async () => {
    const enc = new TextEncoder();
    const whole = `data: ${JSON.stringify({ delta: "ABC" })}\n\ndata: ${JSON.stringify({ delta: "DEF" })}\n\n`;
    const bytes = enc.encode(whole);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 5)); // 帧被腰斩
        controller.enqueue(bytes.slice(5, 30));
        controller.enqueue(bytes.slice(30));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })),
    );
    const out = await collect(BODY, []);
    expect(out.deltas).toEqual(["ABC", "DEF"]);
  });
});

describe("cancelChat（P2-4）", () => {
  it("POST /api/chat/cancel，body {requestId}", async () => {
    const fetchMock = stubFetch(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await cancelChat("req-9");
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/chat/cancel");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ requestId: "req-9" });
  });
});

describe("codegen 端点（P3-4）", () => {
  const PID = "00000000-0000-4000-8000-000000000000";

  it("generateProject POST /generate 并解包 {files}", async () => {
    const fetchMock = stubFetch(200, { files: ["src/main.tsx"] });
    vi.stubGlobal("fetch", fetchMock);
    const out = await codegenApi.generateProject(PID);
    expect(out).toEqual({ files: ["src/main.tsx"] });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/generate`);
    expect(init.method).toBe("POST");
  });

  it("listProjectFiles 无 path：GET /files 返回 {files}", async () => {
    const fetchMock = stubFetch(200, { files: ["src/a.ts", "index.html"] });
    vi.stubGlobal("fetch", fetchMock);
    const out = await codegenApi.listProjectFiles(PID);
    expect(out).toEqual({ files: ["src/a.ts", "index.html"] });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/files`);
    expect(init.method).toBeUndefined();
  });

  it("getProjectFile 带 path：GET /files?path=<rel> 返回 {path, content}", async () => {
    const fetchMock = stubFetch(200, { path: "src/main.tsx", content: "x" });
    vi.stubGlobal("fetch", fetchMock);
    const out = await codegenApi.getProjectFile(PID, "src/main.tsx");
    expect(out).toEqual({ path: "src/main.tsx", content: "x" });
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/files?path=${encodeURIComponent("src/main.tsx")}`);
  });

  it("startPreview / stopPreview POST 返回 {port} / {ok}", async () => {
    const fetchMock = stubFetch(200, { port: 5180 });
    vi.stubGlobal("fetch", fetchMock);
    const out = await startPreview(PID);
    expect(out).toEqual({ port: 5180 });
    let [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/preview/start`);
    expect(init.method).toBe("POST");

    const stopMock = stubFetch(200, { ok: true });
    vi.stubGlobal("fetch", stopMock);
    expect(await stopPreview(PID)).toEqual({ ok: true });
    [url, init] = stopMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/preview/stop`);
    expect(init.method).toBe("POST");
  });

  it("runChecks POST /checks 返回 {checks:{ok,errors}}", async () => {
    const fetchMock = stubFetch(200, { checks: { ok: false, errors: ["e1"] } });
    vi.stubGlobal("fetch", fetchMock);
    const out = await runChecks(PID);
    expect(out.checks).toEqual({ ok: false, errors: ["e1"] });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/checks`);
    expect(init.method).toBe("POST");
  });

  it("exportProject POST → res.blob()；带 zip Content-Type", async () => {
    const blob = new Blob(["PK"], { type: "application/zip" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(blob, { status: 200, headers: { "Content-Type": "application/zip" } })),
    );
    const out = await exportProject(PID);
    // jsdom 的 Blob 与 undici Response.blob() 返回的 Blob 分属不同 realm，
    // toBeInstanceOf 会误报；改用 duck-typing 断言（tag + type）。
    expect(Object.prototype.toString.call(out)).toBe("[object Blob]");
    expect(out.type).toBe("application/zip");
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/export`);
    expect(init.method).toBe("POST");
  });

  it("exportProject 非 2xx 抛 ApiError", async () => {
    vi.stubGlobal("fetch", stubFetch(500, "boom"));
    await expect(exportProject(PID)).rejects.toBeInstanceOf(ApiError);
  });

  it("exportProject 网络失败归一为 status 0 ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(exportProject(PID)).rejects.toMatchObject({ status: 0 });
  });
});
