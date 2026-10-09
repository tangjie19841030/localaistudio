import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createProjectsStore } from "../src/store/projects.js";
import { imageGuideLines, runToolkitChatStream } from "../src/ai/toolkit-pipeline.js";
import type { DocumentEnvelope } from "@studio/studio-core";
import type { ToolkitDriver } from "../src/ai/mock-toolkit.js";

/**
 * Toolkit AI pipeline (P7.3) contract tests: ppt/word projects ride the
 * command-based loop with the mock toolkit driver. Key invariants:
 *  - done frame carries the executed command plan (invocationId/commandId/args)
 *  - the scratch pre-execution NEVER mutates the stored project
 *  - the capability gate drops commands outside the scope's aiTools
 */

let dataDir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(join(tmpdir(), "studio-toolkit-ai-"));
  app = createApp(createProjectsStore(join(dataDir, "projects")), { dataDir });
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function createTypedProject(projectType: "ppt" | "word", name: string): Promise<{ id: string }> {
  const res = await app.request("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, projectType }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { meta: { id: string } };
  return { id: body.meta.id };
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

function chatCall(projectId: string, text: string, scope: Record<string, unknown>): Parameters<typeof app.request> {
  return [
    "/api/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        messages: [{ role: "user", content: text }],
        mode: "patch",
        scope,
        requestId: crypto.randomUUID(),
      }),
    },
  ];
}

async function storedDoc(id: string): Promise<Record<string, unknown>> {
  const res = await app.request(`/api/projects/${id}`);
  return (await res.json()) as Record<string, unknown>;
}

async function runDirectToolkit(
  projectType: "ppt" | "word",
  text: string,
  scope: { kind: "file" | "container" | "selection"; targetIds: string[] },
  toolkitDriver?: ToolkitDriver,
): Promise<Record<string, unknown>[]> {
  const store = createProjectsStore(join(dataDir, "projects"));
  const project = await store.create({ name: `${projectType}-pipeline-test`, projectType });
  const events: Record<string, unknown>[] = [];
  await runToolkitChatStream(
    { store, dataDir, ...(toolkitDriver ? { toolkitDriver } : {}) },
    {
      projectId: project.meta.id,
      messages: [{ role: "user", content: text }],
      scope,
    },
    new AbortController(),
    async (event) => void events.push(event),
  );
  return events;
}

describe("toolkit AI pipeline", () => {
  it("ppt + container scope：mock 驱动逐 slide 重命名+备注，done.commands 可重放，存储不被污染", async () => {
    const { id } = await createTypedProject("ppt", "季度汇报");
    const before = await storedDoc(id);
    const slideId = (before.document as { slides: { id: string }[] }).slides[0]!.id;

    const res = await app.request(...chatCall(id, "优化这一页", { kind: "container", targetIds: [slideId] }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);

    const done = events.find((e) => e.done === true) as
      | { text: string; commands: { invocationId: string; commandId: string; title: string; args: unknown; summary: string }[] }
      | undefined;
    expect(done).toBeTruthy();
    const ids = done!.commands.map((c) => c.commandId);
    expect(ids).toContain("slide.rename");
    expect(ids).toContain("slide.setNotes");
    for (const c of done!.commands) {
      expect(c.invocationId).toBeTruthy();
      expect(c.title).toBeTruthy();
    }

    // Scratch pre-execution: the STORED document must be untouched.
    const after = await storedDoc(id);
    expect(JSON.stringify(after.document)).toBe(JSON.stringify(before.document));

    // Tool frames recorded the successful pre-execution.
    const results = events.filter((e) => (e as { type?: string }).type === "tool-result");
    expect(results.length).toBe(done!.commands.length);
    expect(results.every((r) => r.ok === true)).toBe(true);
  });

  it("word + selection scope：逐 block 润色命令", async () => {
    const { id } = await createTypedProject("word", "季度报告");
    const before = await storedDoc(id);
    const blockId = (before.document as { blocks: { id: string }[] }).blocks[0]!.id;

    const res = await app.request(...chatCall(id, "润色这段", { kind: "selection", targetIds: [blockId] }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);
    const done = events.find((e) => e.done === true) as { commands: { commandId: string }[] } | undefined;
    expect(done?.commands.map((c) => c.commandId)).toContain("word.block.update-text");
  });

  it("word + file scope：mock 起草命令通过能力门禁并进入 done.commands", async () => {
    const { id } = await createTypedProject("word", "季度复盘");
    const res = await app.request(...chatCall(id, "生成一份季度复盘文档", { kind: "file", targetIds: [] }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);
    const result = events.find((e) => e.type === "tool-result" && e.name === "word.section.insert");
    expect(result).toMatchObject({ ok: true });
    const done = events.find((e) => e.done === true) as { commands: { commandId: string }[] } | undefined;
    expect(done?.commands.map((c) => c.commandId)).toContain("word.section.insert");
  });

  it("全失败后 driver 结束：返回错误而不是误报无需修改", async () => {
    const { id } = await createTypedProject("word", "失败回归");
    const before = await storedDoc(id);
    const blockId = "missing-block";
    const res = await app.request(...chatCall(id, "润色不存在的段落", { kind: "selection", targetIds: [blockId] }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);
    expect(events.some((e) => e.type === "tool-result" && e.ok === false)).toBe(true);
    expect(events.some((e) => e.done === true)).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ error: "invalid_json" }));
    expect(JSON.stringify((await storedDoc(id)).document)).toBe(JSON.stringify(before.document));
  });

  it("达到 24 步预算时发出唯一的最终 done，而不是永久 streaming", async () => {
    const driver: ToolkitDriver = {
      async next() {
        return [{ commandId: "word.section.insert", args: { heading: "预算测试" } }];
      },
    };
    const events = await runDirectToolkit("word", "持续生成", { kind: "file", targetIds: [] }, driver);
    const terminal = events.filter((event) => event.done === true && event.partial !== true);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({ done: true, partial: false });
    expect(terminal[0]!.commands as unknown[]).toHaveLength(24);
  });

  it("混合成功/失败批次以 error 终态结束，不再 error 后覆盖为 done", async () => {
    let round = 0;
    const driver: ToolkitDriver = {
      async next() {
        round += 1;
        if (round === 1) {
          return [
            { commandId: "word.section.insert", args: { heading: "成功命令" } },
            { commandId: "word.command.missing", args: {} },
          ];
        }
        return [{ commandId: "word.command.missing", args: {} }];
      },
    };
    const events = await runDirectToolkit("word", "混合结果", { kind: "file", targetIds: [] }, driver);
    expect(events.some((event) => event.done === true && event.partial === true)).toBe(true);
    expect(events.filter((event) => "error" in event)).toHaveLength(1);
    expect(events.filter((event) => event.done === true && event.partial !== true)).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ error: "invalid_json" });
  });

  it("SDK 路径：runBatch 已发出的成功 tool-result 不重复回放", async () => {
    await fs.writeFile(
      join(dataDir, "settings.json"),
      JSON.stringify({
        provider: "openai-compat",
        openai: { baseUrl: "http://127.0.0.1:1234/v1", apiKey: "test-key", model: "test-model" },
      }),
      "utf8",
    );
    const generateText = vi.fn(async (options: Record<string, unknown>) => {
      const tools = options.tools as Record<string, { execute: (args: unknown) => Promise<unknown> }>;
      await tools.word_ai_draft!.execute({
        commands: [{ commandId: "word.section.insert", args: { heading: "SDK 命令" } }],
      });
      return { text: "", toolCalls: [] };
    });
    const tool = vi.fn((spec: unknown) => spec);
    const stepCountIs = vi.fn(() => "stop");
    vi.doMock("ai", () => ({ generateText, tool, stepCountIs }));
    try {
      const events = await runDirectToolkit("word", "SDK 生成", { kind: "file", targetIds: [] });
      expect(events.filter((event) => event.type === "tool-result" && event.name === "word.section.insert")).toHaveLength(1);
    } finally {
      vi.doUnmock("ai");
    }
  });

  it("SDK 路径：字段别名（id→slideId）在执行前被修复，不烧轮次", async () => {
    await fs.writeFile(
      join(dataDir, "settings.json"),
      JSON.stringify({
        provider: "openai-compat",
        openai: { baseUrl: "http://127.0.0.1:1234/v1", apiKey: "test-key", model: "test-model" },
      }),
      "utf8",
    );
    const generateText = vi.fn(async (options: Record<string, unknown>) => {
      const tools = options.tools as Record<string, { execute: (args: unknown) => Promise<unknown> }>;
      // The recurring live failure: slide.add called with `id` instead of `slideId`.
      await tools.ppt_ai_storyline!.execute({
        commands: [{ commandId: "slide.add", args: { id: "slide-fixed", title: "别名修复" } }],
      });
      return { text: "", toolCalls: [] };
    });
    const tool = vi.fn((spec: unknown) => spec);
    const stepCountIs = vi.fn(() => "stop");
    vi.doMock("ai", () => ({ generateText, tool, stepCountIs }));
    try {
      const events = await runDirectToolkit("ppt", "别名修复", { kind: "file", targetIds: [] });
      const result = events.find((event) => event.type === "tool-result" && event.name === "slide.add") as
        | { ok?: boolean; message?: string }
        | undefined;
      expect(result).toMatchObject({ ok: true });
      expect(result!.message).toContain("slide-fixed");
    } finally {
      vi.doUnmock("ai");
    }
  });

  it("capability gate：file scope 整套生成可写正文（object.add 通过门禁）", async () => {
    let round = 0;
    const driver: ToolkitDriver = {
      async next() {
        round += 1;
        if (round > 1) return [];
        // The live repro: deck-level generation must be able to add the text
        // content, not only structure — otherwise every slide keeps its empty
        // "标题/副标题" placeholder boxes.
        return [
          {
            commandId: "object.add",
            args: {
              slideId: "slide-1",
              object: {
                kind: "text",
                rect: { x: 80, y: 80, w: 400, h: 80 },
                data: { paragraphs: [{ runs: [{ text: "封面正文" }] }] },
              },
            },
          },
        ];
      },
    };
    const events = await runDirectToolkit("ppt", "整套生成", { kind: "file", targetIds: [] }, driver);
    const result = events.find((e) => e.type === "tool-result" && e.name === "object.add");
    expect(result).toMatchObject({ ok: true });
  });

  it("capability gate：container scope 可在选中页写内容，建页命令仍被拒绝", async () => {
    let round = 0;
    const driver: ToolkitDriver = {
      async next() {
        round += 1;
        if (round > 1) return [];
        return [
          {
            commandId: "object.add",
            args: {
              slideId: "slide-1",
              object: {
                kind: "text",
                rect: { x: 80, y: 80, w: 400, h: 80 },
                data: { paragraphs: [{ runs: [{ text: "本页补充" }] }] },
              },
            },
          },
          // slide.add is file-only (allowedScopeKinds + storyline group): editing
          // one slide must not create siblings.
          { commandId: "slide.add", args: {} },
        ];
      },
    };
    const events = await runDirectToolkit("ppt", "编辑这一页", { kind: "container", targetIds: ["slide-1"] }, driver);
    const added = events.find((e) => e.type === "tool-result" && e.name === "object.add");
    expect(added).toMatchObject({ ok: true });
    const addedSlide = events.find((e) => e.type === "tool-result" && e.name === "slide.add");
    expect(addedSlide).toMatchObject({ ok: false });
  });

  it("capability gate：selection scope 不开放结构/页级命令，仅对象命令", async () => {
    let round = 0;
    const driver: ToolkitDriver = {
      async next() {
        round += 1;
        if (round > 1) return [];
        return [
          { commandId: "slide.rename", args: { slideId: "slide-1", title: "越权改名" } },
          { commandId: "object.remove", args: { objectId: "slide-1-title-1" } },
        ];
      },
    };
    const events = await runDirectToolkit(
      "ppt",
      "只改选中对象",
      { kind: "selection", targetIds: ["slide-1-title-1"] },
      driver,
    );
    const rename = events.find((e) => e.type === "tool-result" && e.name === "slide.rename");
    expect(rename).toMatchObject({ ok: false });
    const remove = events.find((e) => e.type === "tool-result" && e.name === "object.remove");
    expect(remove).toMatchObject({ ok: true });
  });

  it("scope 自愈：selection 目标被同一次运行删除后，后续命令在其所属页上仍可执行", async () => {
    // Live repro: user selected the subtitle placeholder; the model removes it
    // then adds replacement text on the same slide. Before the fix the frozen
    // scope kept naming the deleted object and EVERY later command died with
    // "PPT 选择目标不存在: slide-1-subtitle-1" — 12 identical failures.
    let round = 0;
    const driver: ToolkitDriver = {
      async next() {
        round += 1;
        if (round === 1) {
          return [{ commandId: "object.remove", args: { objectId: "slide-1-subtitle-1" } }];
        }
        if (round === 2) {
          return [
            {
              commandId: "object.add",
              args: {
                slideId: "slide-1",
                object: {
                  kind: "text",
                  rect: { x: 80, y: 80, w: 600, h: 120 },
                  data: { paragraphs: [{ runs: [{ text: "替换占位符的正文" }] }] },
                },
              },
            },
          ];
        }
        return [];
      },
    };
    const events = await runDirectToolkit(
      "ppt",
      "替换副标题占位符",
      { kind: "selection", targetIds: ["slide-1-subtitle-1"] },
      driver,
    );
    expect(events.find((e) => e.type === "tool-result" && e.name === "object.remove")).toMatchObject({ ok: true });
    expect(events.find((e) => e.type === "tool-result" && e.name === "object.add")).toMatchObject({ ok: true });
    expect(events.some((e) => "error" in e)).toBe(false);
    // The partial frame that adds the replacement carries the WIDENED scope —
    // local replay on the client must heal selection→container too, or it dies
    // on the deleted target ("分批应用失败：命令与当前文档冲突").
    const addBatch = events
      .filter((e) => e.done === true && e.partial === true)
      .find((e) => (e.commands as { commandId?: string }[] | undefined)?.some((c) => c.commandId === "object.add")) as
      | { scope?: { kind: string; targetIds: string[] } }
      | undefined;
    expect(addBatch?.scope).toEqual({ kind: "container", targetIds: ["slide-1"] });
  });

  it("scope 自愈：container 目标页在同一轮模型调用中消失且无处可退时，fatal 中止且错误可读", async () => {
    let latest: DocumentEnvelope | undefined;
    let nextCalls = 0;
    const driver: ToolkitDriver = {
      async next(input) {
        nextCalls += 1;
        latest = input.envelope;
        return []; // SDK shape: executed steps arrive through takeInternal
      },
      takeInternal() {
        if (!latest) return undefined;
        // runBatch healed scope to null mid-round (selected slide gone with no
        // fallback): it reports the fatal alongside the last failed step.
        const emptied: DocumentEnvelope = {
          ...latest,
          document: { ...(latest.document as Record<string, unknown>), slides: [] },
        };
        return {
          envelope: emptied,
          fatal: "本次修改的作用目标在生成过程中已被删除，无法继续该范围的操作。请重新选择幻灯片/对象（或不选目标、按整篇范围）后再发一次指令。",
          steps: [{ commandId: "slide.rename", ok: false, message: "PPT 选择目标不存在: slide-1" }],
        };
      },
    };
    const events = await runDirectToolkit("ppt", "页已删除", { kind: "container", targetIds: ["slide-1"] }, driver);
    expect(nextCalls).toBe(1); // one generateText turn; the run does not schedule another
    const errorEvent = events.find((e) => "error" in e) as { raw?: unknown } | undefined;
    expect(String(errorEvent?.raw)).toContain("作用目标在生成过程中已被删除");
    expect(events.some((e) => e.done === true)).toBe(false);
  });

  it("初始就无效的 scope 目标不被自愈吞掉：仍由 adapter 报错并以失败结束", async () => {
    let round = 0;
    const driver: ToolkitDriver = {
      async next() {
        round += 1;
        if (round > 3) return [];
        return [{ commandId: "object.remove", args: { objectId: "ghost-object" } }];
      },
    };
    const events = await runDirectToolkit(
      "ppt",
      "引用不存在的对象",
      { kind: "selection", targetIds: ["ghost-object"] },
      driver,
    );
    const result = events.find((e) => e.type === "tool-result" && e.name === "object.remove");
    expect(result).toMatchObject({ ok: false });
    expect(String((result as { message?: string }).message)).toContain("选择目标不存在");
  });

  it("图片纪律：项目资产注入系统提示词；无资产时禁止编造 image 对象", () => {
    const withAssets = imageGuideLines([
      { file: "aaa.png", src: "/api/projects/p1/assets/aaa.png", ext: "png", bytes: 1.5 * 1024 * 1024 },
    ]).join("\n");
    expect(withAssets).toContain("/api/projects/p1/assets/aaa.png");
    expect(withAssets).toContain("1.5MB");
    expect(withAssets).toMatch(/严禁编造/);
    expect(withAssets).toContain("object.editImage");

    const empty = imageGuideLines([]).join("\n");
    expect(empty).toMatch(/没有任何图片资产/);
    expect(empty).toMatch(/禁止创建 kind="image"/);
    expect(empty).toContain("插入图片");
  });

  it("流式契约：tool 帧 + done 帧顺序完整，流以事件流响应", async () => {
    const { id } = await createTypedProject("word", "契约检查");
    const res = await app.request(...chatCall(id, "补充内容", { kind: "file", targetIds: [] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await collectSse(res);
    const types = events.map((e) => ("type" in e ? e.type : e.done === true ? "done" : "other"));
    expect(types[types.length - 1]).toBe("done");
  });

  it("空命令终帧：模型 delta 非空时终帧 text 用模型解释替代固定「无需修改」（T30 断言 15）", async () => {
    await fs.writeFile(
      join(dataDir, "settings.json"),
      JSON.stringify({
        provider: "openai-compat",
        openai: { baseUrl: "http://127.0.0.1:1234/v1", apiKey: "test-key", model: "test-model" },
      }),
      "utf8",
    );
    // The T30 repro: the model explains itself ("upload a video first") without
    // issuing any command; the done frame must carry that explanation instead
    // of swallowing it with the fixed "无需修改" copy. Deltas are emitted by
    // the SDK driver's onStepEnd hook — the only delta source — so this locks
    // the full chain onStepEnd → teeSend accumulation → terminal text.
    const DELTA_TEXT = "当前项目没有任何视频资产：请先点击工具栏「插入视频」上传视频文件，再发一次指令。";
    const generateText = vi.fn(async (options: Record<string, unknown>) => {
      const onStepEnd = options.onStepEnd as ((event: { text?: string }) => void) | undefined;
      onStepEnd?.({ text: DELTA_TEXT });
      return { text: "", toolCalls: [] }; // zero tool calls → zero commands
    });
    const tool = vi.fn((spec: unknown) => spec);
    const stepCountIs = vi.fn(() => "stop");
    vi.doMock("ai", () => ({ generateText, tool, stepCountIs }));
    try {
      const events = await runDirectToolkit("ppt", "加个视频", { kind: "file", targetIds: [] });
      // The explanation still streams live to the bubble as a delta frame.
      expect(events).toContainEqual(expect.objectContaining({ delta: DELTA_TEXT }));
      const done = events.find((e) => e.done === true && e.partial !== true) as
        | { text: string; commands: unknown[] }
        | undefined;
      expect(done).toBeTruthy();
      expect(done!.commands).toHaveLength(0);
      expect(done!.text).toBe(DELTA_TEXT);
      expect(done!.text).not.toContain("无需修改");
    } finally {
      vi.doUnmock("ai");
    }
  });

  it("SDK 路径：模型本轮零文本+零工具调用时终帧为 error，不是「无需修改」（T19 空命令终态）", async () => {
    // T19 live repro: ark-code-latest on "背景改一下" / "白框改成粉色" finishes
    // a generateText round with zero tool calls AND zero streamed text — the
    // old code surfaced the fixed "AI 认为无需修改" notice, indistinguishable
    // from a deliberate empty change set. The fix: runSdkRound now flags the
    // round as fatal so the client sees an explicit error frame instead.
    await fs.writeFile(
      join(dataDir, "settings.json"),
      JSON.stringify({
        provider: "openai-compat",
        openai: { baseUrl: "http://127.0.0.1:1234/v1", apiKey: "test-key", model: "test-model" },
      }),
      "utf8",
    );
    const generateText = vi.fn(async () => ({ text: "", toolCalls: [] }));
    const tool = vi.fn((spec: unknown) => spec);
    const stepCountIs = vi.fn(() => "stop");
    vi.doMock("ai", () => ({ generateText, tool, stepCountIs }));
    try {
      const events = await runDirectToolkit("ppt", "背景改一下", { kind: "container", targetIds: ["slide-1"] });
      // Old behavior: a done frame with commands=[] + the workbench's fixed
      // "无需修改" notice. New behavior: an error frame so the user sees the
      // real reason (model returned nothing) and can retry or re-describe.
      const doneWithCommands = events.find((e) => e.done === true && e.partial !== true);
      expect(doneWithCommands).toBeUndefined();
      const errorFrame = events.find((e) => "error" in e) as
        | { error: string; raw?: string }
        | undefined;
      expect(errorFrame).toBeTruthy();
      expect(errorFrame!.error).toBe("invalid_json");
      expect(errorFrame!.raw ?? "").toMatch(/模型本轮未返回任何工具调用或说明文本/);
      expect(events).not.toContainEqual(expect.objectContaining({ delta: expect.stringMatching(/^.{1,}$/) }));
    } finally {
      vi.doUnmock("ai");
    }
  });
});
