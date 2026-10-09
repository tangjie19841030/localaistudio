import { describe, expect, it, vi } from "vitest";
import { defaultStudioDocument } from "@studio/schema-core";
import { runAgentLoop, type DriverCall, type ToolDriver } from "../src/ai/agentLoop.js";
import { buildSdkDriver } from "../src/ai/modelProvider.js";

/**
 * A1: the SDK driver must execute tools through DriverInput.executeTool
 * (real zod/scope/doc feedback), stash steps via takeInternal, and return []
 * so the outer loop does NOT double-execute.
 */
describe("buildSdkDriver — 真实工具执行（A1）", () => {
  function fakeGenerateText(script: { steps: DriverCall[]; finalText?: string }) {
    return vi.fn(async (opts: Record<string, unknown>) => {
      const tools = opts.tools as Record<string, {
        execute: (args: unknown) => Promise<string>;
      }>;
      for (const call of script.steps) {
        const t = tools[call.name];
        expect(t).toBeTruthy();
        await t!.execute(call.args);
      }
      return { text: script.finalText ?? "done", toolCalls: [] };
    });
  }

  it("execute 经 executeTool 演进文档；next 返回 []；takeInternal 带出 steps", async () => {
    const generateText = fakeGenerateText({
      steps: [
        { name: "insert_node", args: { type: "StatCard", parentId: "root", props: { label: "A" } } },
      ],
    });
    const tool = vi.fn((spec: unknown) => spec);
    const stepCountIs = vi.fn(() => "stop");
    vi.doMock("ai", () => ({ generateText, tool, stepCountIs }));

    const driver = buildSdkDriver("fake-model");
    const doc = defaultStudioDocument("sdk-doc");
    const events: string[] = [];
    const result = await runAgentLoop({
      messages: [{ role: "user", content: "加个卡" }],
      doc,
      driver,
      onEvent: (ev) => {
        if ("type" in ev && (ev.type === "tool-call" || ev.type === "tool-result")) {
          events.push(`${ev.type}:${ev.name}`);
        }
      },
    });

    // Outer loop adopted internal steps — no double insert.
    expect(result.finished).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ name: "insert_node", ok: true });
    expect(result.doc.pages[0]!.nodes.filter((n) => n.type === "StatCard")).toHaveLength(1);
    expect(events).toEqual(["tool-call:insert_node", "tool-result:insert_node"]);
    // takeInternal consumed — second call is empty until next next().
    expect(driver.takeInternal?.()).toBeUndefined();
    vi.doUnmock("ai");
  });

  it("工具失败消息喂回 execute，文档不前进", async () => {
    const generateText = fakeGenerateText({
      steps: [{ name: "update_props", args: { nodeId: "ghost", props: { label: "x" } } }],
    });
    const tool = vi.fn((spec: unknown) => spec);
    const stepCountIs = vi.fn(() => "stop");
    vi.doMock("ai", () => ({ generateText, tool, stepCountIs }));

    const driver = buildSdkDriver("fake-model");
    const doc = defaultStudioDocument("sdk-fail");
    const result = await runAgentLoop({
      messages: [],
      doc,
      driver,
      onEvent: () => {},
    });
    expect(result.steps[0]?.ok).toBe(false);
    expect(result.steps[0]?.message).toContain("ghost");
    expect(result.doc.pages[0]!.nodes).toEqual(doc.pages[0]!.nodes);
    vi.doUnmock("ai");
  });

  it("模型未发原生 tool_calls 但返回 legacy tokens.set JSON 时仍执行 set_token", async () => {
    const generateText = fakeGenerateText({
      steps: [],
      finalText: JSON.stringify({
        plan: "切换暖橙主题",
        ops: [
          { op: "tokens.set", path: ["color", "brand"], value: "#C2410C" },
          { op: "tokens.set", path: ["color", "accent"], value: "#D97706" },
        ],
      }),
    });
    const tool = vi.fn((spec: unknown) => spec);
    const stepCountIs = vi.fn(() => "stop");
    vi.doMock("ai", () => ({ generateText, tool, stepCountIs }));

    const driver = buildSdkDriver("fake-model");
    const result = await runAgentLoop({
      messages: [{ role: "user", content: "整体换成暖色品牌色" }],
      doc: defaultStudioDocument("sdk-token-fallback"),
      scope: { nodeIds: [], allowAllTokens: true },
      driver,
      onEvent: () => {},
    });

    expect(result.steps.map((step) => step.name)).toEqual(["set_token", "set_token"]);
    expect(result.steps.every((step) => step.ok)).toBe(true);
    expect(result.doc.tokens.color.brand).toBe("#C2410C");
    expect(result.doc.tokens.color.accent).toBe("#D97706");
    vi.doUnmock("ai");
  });
});

describe("buildSdkDriver — onTextDelta 透传（流式可见性）", () => {
  /** generateText fake that fires onStepEnd per LLM call, like real ai@7. */
  function fakeStepsGenerateText(calls: { toolSteps?: DriverCall[]; text?: string }[]) {
    return vi.fn(async (opts: Record<string, unknown>) => {
      const onStepEnd = opts.onStepEnd as ((ev: { text: string }) => void) | undefined;
      for (const call of calls) {
        const tools = opts.tools as Record<string, { execute: (args: unknown) => Promise<string> }>;
        for (const step of call.toolSteps ?? []) {
          await tools[step.name]!.execute(step.args);
        }
        onStepEnd?.({ text: call.text ?? "" });
      }
      return { text: calls.at(-1)?.text ?? "", toolCalls: [] };
    });
  }

  it("每个 LLM step 的非空 text 经 onTextDelta 透传；空 text step 不发", async () => {
    const generateText = fakeStepsGenerateText([
      { toolSteps: [{ name: "insert_node", args: { type: "StatCard", parentId: "root", props: { label: "A" } } }], text: "让我先看下文档结构。" },
      { text: "完成。" },
      { text: "" }, // empty step: skipped
    ]);
    const tool = vi.fn((spec: unknown) => spec);
    const stepCountIs = vi.fn(() => "stop");
    vi.doMock("ai", () => ({ generateText, tool, stepCountIs }));

    const deltas: string[] = [];
    const driver = buildSdkDriver("fake-model", { onTextDelta: (chunk) => deltas.push(chunk) });
    const doc = defaultStudioDocument("sdk-delta");
    const result = await runAgentLoop({
      messages: [{ role: "user", content: "加个卡" }],
      doc,
      driver,
      onEvent: () => {},
    });
    // All non-empty step texts pass through as chunks — including the model's
    // intermediate reasoning between tool calls (frontend folds it in the bubble).
    expect(deltas).toEqual(["让我先看下文档结构。", "完成。"]);
    expect(result.finished).toBe(true);
    expect(result.steps).toHaveLength(1); // tool execution still routed via executeTool
    vi.doUnmock("ai");
  });

  it("未传 onTextDelta 时仍挂 onStepEnd，仅不转发 delta", async () => {
    const generateText = vi.fn(async (opts: Record<string, unknown>) => {
      expect(typeof opts.onStepEnd).toBe("function");
      return { text: "done", toolCalls: [] };
    });
    const tool = vi.fn((spec: unknown) => spec);
    const stepCountIs = vi.fn(() => "stop");
    vi.doMock("ai", () => ({ generateText, tool, stepCountIs }));

    const driver = buildSdkDriver("fake-model");
    await driver.next({ messages: [], doc: defaultStudioDocument("sdk-no-delta"), tools: [] });
    expect(generateText).toHaveBeenCalledTimes(1);
    vi.doUnmock("ai");
  });

  it("零工具且零文本时返回 fatal，不生成空完成", async () => {
    const generateText = vi.fn(async () => ({ text: "", toolCalls: [] }));
    const tool = vi.fn((spec: unknown) => spec);
    const stepCountIs = vi.fn(() => "stop");
    vi.doMock("ai", () => ({ generateText, tool, stepCountIs }));
    try {
      const result = await runAgentLoop({
        messages: [{ role: "user", content: "改成小猫" }],
        doc: defaultStudioDocument("sdk-empty"),
        driver: buildSdkDriver("fake-model"),
        onEvent: () => {},
      });
      expect(result.finished).toBe(false);
      expect(result.error).toContain("未返回任何工具调用或说明文本");
    } finally {
      vi.doUnmock("ai");
    }
  });

  it("零工具但 onStepEnd 有解释时保留解释，不误报无需修改", async () => {
    const generateText = vi.fn(async (opts: Record<string, unknown>) => {
      const onStepEnd = opts.onStepEnd as ((event: { text: string }) => void) | undefined;
      onStepEnd?.({ text: "当前页面没有可替换的图片，请先上传小猫图片。" });
      return { text: "", toolCalls: [] };
    });
    const tool = vi.fn((spec: unknown) => spec);
    const stepCountIs = vi.fn(() => "stop");
    vi.doMock("ai", () => ({ generateText, tool, stepCountIs }));
    try {
      const result = await runAgentLoop({
        messages: [{ role: "user", content: "改成小猫" }],
        doc: defaultStudioDocument("sdk-explanation"),
        driver: buildSdkDriver("fake-model"),
        onEvent: () => {},
      });
      expect(result.finished).toBe(true);
      expect(result.explanation).toBe("当前页面没有可替换的图片，请先上传小猫图片。");
    } finally {
      vi.doUnmock("ai");
    }
  });
});
