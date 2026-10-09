import { describe, expect, it } from "vitest";
import { defaultStudioDocument, type StudioDocument } from "@studio/schema-core";
import {
  runAgentLoop,
  type AgentEvent,
  type DriverCall,
  type ToolDriver,
} from "../src/ai/agentLoop.js";

/** Fresh container-root doc, the store's default shape. */
function startDoc(): StudioDocument {
  return defaultStudioDocument("测试文档");
}

/** Scripted fake driver: pops one batch per next() call; [] after the script. */
function scriptedDriver(batches: DriverCall[][]): ToolDriver & { inputs: unknown[][] } {
  const inputs: unknown[][] = [];
  let i = 0;
  return {
    inputs,
    async next(input) {
      inputs.push(input.messages.map((m) => m.content));
      const batch = batches[i];
      i += 1;
      return batch ?? [];
    },
  };
}

const INSERT_STAT = {
  name: "insert_node",
  args: { type: "StatCard", parentId: "root", props: { label: "活跃" } },
};
const INSERT_BUTTON = {
  name: "insert_node",
  args: { type: "Button", parentId: "root", props: { label: "导出" } },
};

describe("runAgentLoop — 顺序与文档演进", () => {
  it("3 步序列（insert → update → set_frame）：doc 逐步演进、事件有序、finished:true", async () => {
    // The registry generates the insert id, so a real driver reads it from the
    // tool-result message. This scripted driver does the same: capture the id
    // from the successful insert step's result doc mid-sequence.
    let statId = "";
    const inputs: unknown[][] = [];
    let round = 0;
    const driver: ToolDriver = {
      async next(input) {
        inputs.push(input.messages.map((m) => m.content));
        round += 1;
        if (round === 1) return [INSERT_STAT];
        if (round === 2) {
          return [{ name: "update_props", args: { nodeId: statId, props: { label: "今日活跃", tone: "success" } } }];
        }
        if (round === 3) {
          return [{ name: "set_frame", args: { nodeId: statId, frame: { x: 320, y: 80, w: 240, h: 120, rotation: 0 } } }];
        }
        return [];
      },
    };
    const events: string[] = [];
    const onEvent = (ev: Parameters<Parameters<typeof runAgentLoop>[0]["onEvent"]>[0]): void => {
      if ("type" in ev && (ev.type === "tool-call" || ev.type === "tool-result")) {
        // tool-call has no ok flag; render undefined exactly like a model trace.
        const ok = ev.type === "tool-result" ? String(ev.ok) : "undefined";
        events.push(`${ev.type}:${ev.name}:${ok}`);
        if (ev.type === "tool-result" && ev.ok && ev.name === "insert_node") {
          // Capture the inserted id ("已插入 指标卡（id: n_xxx）") — same as a
          // real model reading the tool-result message. nanoid alphabet is
          // A-Za-z0-9_- so the class must include _ and - (was flaky without).
          statId = /（id: (n_[A-Za-z0-9_-]+)）/.exec(ev.message)?.[1] ?? "";
        }
      }
    };
    const doc = startDoc();
    const result = await runAgentLoop({
      messages: [{ role: "user", content: "加个指标卡并摆好" }],
      doc,
      driver,
      onEvent,
    });
    expect(result.finished).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((s) => s.ok)).toBe(true);
    // Doc evolved: StatCard inserted, updated props, frame set.
    const stat = result.doc.pages[0]!.nodes.find((n) => n.id === statId);
    expect(stat?.props.label).toBe("今日活跃");
    expect(stat?.frame).toMatchObject({ x: 320, y: 80, w: 240, h: 120, rotation: 0 });
    // Events in strict order: call/result per step, interleaved.
    expect(events).toEqual([
      "tool-call:insert_node:undefined",
      "tool-result:insert_node:true",
      "tool-call:update_props:undefined",
      "tool-result:update_props:true",
      "tool-call:set_frame:undefined",
      "tool-result:set_frame:true",
    ]);
    // Every success message reached the transcript the driver reads next round.
    const round3Input = (inputs[2]?.at(-1) ?? "") as string;
    expect(round3Input).toContain("[成功] update_props");
  });

  it("第 1 步 zod 失败（ok:false）→ 第 2 步模型修正成功，成功消息进 transcript", async () => {
    const doc = startDoc();
    const badThenGood: DriverCall[][] = [
      [{ name: "insert_node", args: { type: "NoSuchComponent" } }],
      [INSERT_BUTTON],
    ];
    const driver = scriptedDriver(badThenGood);
    const result = await runAgentLoop({
      messages: [],
      doc,
      driver,
      onEvent: () => {},
    });
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.ok).toBe(false);
    expect(result.steps[0]?.message).toContain("未知组件类型");
    expect(result.steps[1]?.ok).toBe(true);
    // The failure text was fed back, then the correction succeeded.
    const secondRoundInput = driver.inputs[1] as string[];
    expect(secondRoundInput.at(-1)).toContain("[失败] insert_node");
    expect(result.doc.pages[0]!.nodes.some((n) => n.type === "Button")).toBe(true);
  });

  it("连续 3 批全失败 → error 预算中止，含最后失败消息", async () => {
    const doc = startDoc();
    const driver = scriptedDriver([
      [{ name: "update_props", args: { nodeId: "ghost", props: { label: "x" } } }],
      [{ name: "update_props", args: { nodeId: "ghost", props: { label: "x" } } }],
      [{ name: "update_props", args: { nodeId: "ghost", props: { label: "x" } } }],
    ]);
    const result = await runAgentLoop({
      messages: [],
      doc,
      driver,
      onEvent: () => {},
    });
    expect(result.error).toContain("连续 3 步工具调用失败，已中止");
    expect(result.error).toContain("ghost");
    expect(result.finished).toBe(false);
    expect(result.doc).toBe(doc); // failures never advanced the doc
  });

  it("maxSteps 耗尽：finished:false、无 error、保留已累积 doc", async () => {
    const doc = startDoc();
    const insert = (): DriverCall[] => [INSERT_STAT];
    // A driver that always proposes one more call — runs until the budget ends.
    const always: ToolDriver = { async next() { return insert(); } };
    const result = await runAgentLoop({
      messages: [],
      doc,
      driver: always,
      maxSteps: 4,
      onEvent: () => {},
    });
    expect(result.finished).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.steps.length).toBe(4);
    expect(result.doc.pages[0]!.nodes.filter((n) => n.type === "StatCard")).toHaveLength(4);
  });

  it("abort 中途触发：立即停止，后续工具不再执行", async () => {
    const doc = startDoc();
    const controller = new AbortController();
    let calls = 0;
    const driver: ToolDriver = {
      async next() {
        calls += 1;
        return calls === 1 ? [INSERT_STAT] : [INSERT_BUTTON];
      },
    };
    // Abort mid-loop: after the first batch's tool-result fires.
    const result = await runAgentLoop({
      messages: [],
      doc,
      driver,
      signal: controller.signal,
      onEvent: (ev) => {
        if ("type" in ev && ev.type === "tool-result" && ev.name === "insert_node") {
          controller.abort();
        }
      },
    });
    // The second batch was proposed but never executed after the abort.
    expect(result.steps.map((s) => s.name)).toEqual(["insert_node"]);
    expect(result.finished).toBe(false);
    expect(result.doc.pages[0]!.nodes.some((n) => n.type === "Button")).toBe(false);
  });

  it("未知工具名 → ok:false 消息为「未知工具」", async () => {
    const doc = startDoc();
    const driver = scriptedDriver([[{ name: "no_such_tool", args: {} }]]);
    const result = await runAgentLoop({
      messages: [],
      doc,
      driver,
      onEvent: () => {},
    });
    expect(result.steps[0]).toMatchObject({ name: "no_such_tool", ok: false, message: "未知工具" });
    // Unknown tool still ends finished when the driver stops proposing.
    expect(result.finished).toBe(true);
  });

  it("scope 违规工具 → 回传「节点 <id> 超出修改范围」，模型自我纠正", async () => {
    const doc = startDoc();
    const driver = scriptedDriver([
      [{ name: "update_props", args: { nodeId: "n_outside", props: { label: "x" } } }],
    ]);
    const result = await runAgentLoop({
      messages: [],
      doc,
      scope: { nodeIds: ["root"], allowAllTokens: false },
      driver,
      onEvent: () => {},
    });
    expect(result.steps[0]?.ok).toBe(false);
    expect(result.steps[0]?.message).toBe("节点 n_outside 超出修改范围");
  });

  // -----------------------------------------------------------------
  // T21 §3.6 F5/F6: target-page semantics with a multi-page document.
  // -----------------------------------------------------------------

  /** Two-page doc whose second page root differs, so edits are attributable. */
  function twoPageDoc(): StudioDocument {
    return {
      documentVersion: 2,
      name: "多页",
      tokens: {
        color: {
          brand: "#0F766E", surface: "#FFFFFF", text: "#172033", muted: "#64748B",
          border: "#E2E8F0", accent: "#0EA5E9", success: "#16A34A", warning: "#D97706", danger: "#DC2626",
        },
        radius: { card: 6, control: 4 },
        spacing: { unit: 4 },
        font: { sans: "Inter" },
      },
      pages: [
        {
          id: "page-1",
          name: "首页",
          rootId: "p1_root",
          nodes: [
            { id: "p1_root", type: "Container", props: {}, children: ["p1_stat"] },
            { id: "p1_stat", type: "StatCard", props: { label: "首页", value: "1", delta: "", tone: "brand" }, children: [] },
          ],
        },
        {
          id: "page-2",
          name: "第二页",
          rootId: "p2_root",
          nodes: [
            { id: "p2_root", type: "Container", props: {}, children: ["p2_stat"] },
            { id: "p2_stat", type: "StatCard", props: { label: "第二页", value: "2", delta: "", tone: "brand" }, children: [] },
          ],
        },
      ],
    };
  }

  it("F6：pageId=page-2 → update_props 命中第二页节点（不再硬编码首页）", async () => {
    const doc = twoPageDoc();
    const driver = scriptedDriver([
      [{ name: "update_props", args: { nodeId: "p2_stat", props: { label: "第二页已改" } } }],
    ]);
    const result = await runAgentLoop({
      messages: [],
      doc,
      pageId: "page-2",
      driver,
      onEvent: () => {},
    });
    expect(result.steps[0]?.ok).toBe(true);
    const page2 = result.doc.pages.find((p) => p.id === "page-2")!;
    const page1 = result.doc.pages.find((p) => p.id === "page-1")!;
    expect(page2.nodes.find((n) => n.id === "p2_stat")?.props.label).toBe("第二页已改");
    expect(page1.nodes.find((n) => n.id === "p1_stat")?.props.label).toBe("首页");
  });

  it("F5：done 文档为整文档（两页俱在）且仅活动页被替换", async () => {
    const doc = twoPageDoc();
    const driver = scriptedDriver([
      [{ name: "insert_node", args: { type: "Button", parentId: "p2_root", props: { label: "新按钮" } } }],
    ]);
    const result = await runAgentLoop({
      messages: [],
      doc,
      pageId: "page-2",
      driver,
      onEvent: () => {},
    });
    expect(result.steps[0]?.ok).toBe(true);
    // Whole document: BOTH pages survive the loop.
    expect(result.doc.pages.map((p) => p.id)).toEqual(["page-1", "page-2"]);
    expect(result.doc.tokens).toEqual(doc.tokens);
    // Only the active page changed: page-1 deep-equal, page-2 has the insert.
    expect(result.doc.pages[0]).toEqual(doc.pages[0]);
    const page2 = result.doc.pages[1]!;
    expect(page2.nodes.some((n) => n.type === "Button")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P6-3 回归：真实 provider 必须走 agent loop（此前只有 mock 走，真实模型
// 落到旧单发管线 —— 用户实测发现"确认卡没有工具轨迹摘要"的根因）
// ---------------------------------------------------------------------------

describe("parseToolCalls 兼容模型两种输出形状", () => {
  it("原生 tool-calling 形状", async () => {
    const { parseToolCalls } = await import("../src/ai/modelProvider.js");
    expect(
      parseToolCalls('{"tool_calls":[{"name":"insert_node","args":{"type":"Card"}}]}'),
    ).toEqual([{ name: "insert_node", args: { type: "Card" } }]);
  });

  it("存量 {plan, document} 形状 → propose_document", async () => {
    const { parseToolCalls } = await import("../src/ai/modelProvider.js");
    const doc = { documentVersion: 1, name: "x", rootId: "r", tokens: {}, nodes: [] };
    expect(parseToolCalls(JSON.stringify({ plan: "生成", document: doc }))).toEqual([
      { name: "propose_document", args: { document: doc } },
    ]);
  });

  it("存量 {plan, ops} 形状 → 粒度工具（update/setFrame/remove/move/add/token）", async () => {
    const { parseToolCalls } = await import("../src/ai/modelProvider.js");
    const calls = parseToolCalls(
      JSON.stringify({
        plan: "改",
        ops: [
          { op: "node.update", id: "n1", props: { label: "新" } },
          { op: "setFrame", nodeId: "n1", frame: { x: 1, y: 2, w: 3, h: 4 } },
          { op: "node.remove", id: "n2" },
          { op: "node.move", id: "n3", parentId: "root", index: 0 },
          { op: "node.add", parentId: "root", node: { type: "Card", props: {} } },
          { op: "tokens.set", path: ["color", "brand"], value: "#000000" },
        ],
      }),
    );
    expect(calls.map((c) => c.name)).toEqual([
      "update_props",
      "set_frame",
      "remove_node",
      "move_node",
      "insert_node",
      "set_token",
    ]);
  });

  it("空 ops → 空批次（模型认为无需改动，不是坏 JSON）", async () => {
    const { parseToolCalls } = await import("../src/ai/modelProvider.js");
    expect(parseToolCalls('{"plan":"无需改动","ops":[]}')).toEqual([]);
  });

  it("非 JSON / 无工具字段 → 空批次，不抛异常", async () => {
    const { parseToolCalls } = await import("../src/ai/modelProvider.js");
    expect(parseToolCalls("这不是 JSON")).toEqual([]);
    expect(parseToolCalls('{"plan":"只有计划"}')).toEqual([]);
    expect(parseToolCalls("null")).toEqual([]);
  });
});
