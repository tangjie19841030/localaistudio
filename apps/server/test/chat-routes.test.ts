import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createProjectsStore, type ProjectsStore, type ProjectBundle } from "../src/store/projects.js";
import { checkScope, type StudioDocument } from "@studio/schema-core";
import type { ChatMessage } from "../src/ai/provider.js";
import type { DriverCall, ToolDriver } from "../src/ai/agentLoop.js";

let dataDir: string;
let app: ReturnType<typeof createApp>;
let scopeCalls: number;
let scopeViolations: string[][];

/** Local stub standing in for schema-core checkScope (P2-1 lands in parallel; mainline wires the real one). */
function scopeStub(ops: unknown[], scope: { nodeIds?: string[] }): string[] {
  scopeCalls += 1;
  if (scope.nodeIds === undefined) return [];
  const allowed = new Set(scope.nodeIds);
  const violated: string[] = [];
  for (const op of ops as { op?: string; id?: string; nodeId?: string; node?: { id?: string } }[]) {
    const id = op.id ?? op.nodeId ?? op.node?.id;
    if (id && !allowed.has(id)) violated.push(`越界: ${op.op} -> ${id}`);
  }
  return scopeViolations[scopeCalls - 1] ?? violated;
}

const newProjectInput = {
  name: "运营工作台",
  productType: "后台",
  targetUsers: "运营",
  goal: "看数据",
  referenceLinks: [],
  brandRules: "不要渐变",
};

beforeEach(async () => {
  dataDir = await fs.mkdtemp(join(tmpdir(), "studio-chat-"));
  scopeCalls = 0;
  scopeViolations = [];
  app = createApp(createProjectsStore(join(dataDir, "projects")), {
    dataDir,
    scopeChecker: scopeStub,
  });
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

/** Shared SSE client: mirrors the frontend parser — decode, split on "\n\n", parse data: lines. */
async function collectSse(res: Response): Promise<Record<string, unknown>[]> {
  expect(res.headers.get("content-type")).toContain("text/event-stream");
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
      if (line.startsWith("data:")) {
        events.push(JSON.parse(line.slice(5).trim()));
      }
    }
  }
  return events;
}

function chatCall(
  projectId: string,
  messages: ChatMessage[],
  extra: Record<string, unknown> = {},
): Parameters<typeof app.request> {
  return [
    "/api/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        messages,
        mode: "generate",
        requestId: crypto.randomUUID(),
        ...extra,
      }),
    },
  ];
}

const byKey = (events: Record<string, unknown>[], key: string) =>
  events.filter((e) => key in e);

const toolEvents = (events: Record<string, unknown>[], type: "tool-call" | "tool-result") =>
  events.filter((e) => e.type === type);

describe("POST /api/chat/completions — agent loop tool 帧（P6-2）", () => {
  it("generate marker：tool-call/tool-result（propose_document）帧按序出现，done 文档同旧契约", async () => {
    const bundle = await createProject();
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "生成一个运营工作台" },
    ]));
    expect(res.status).toBe(200);
    const events = await collectSse(res);

    const calls = toolEvents(events, "tool-call");
    const results = toolEvents(events, "tool-result");
    expect(calls.map((c) => c.name)).toEqual(["propose_document"]);
    expect(results.map((r) => r.ok)).toEqual([true]);
    expect(String(results[0]?.message)).toContain("页面提案有效");
    // Frame order: tool-call → tool-result → deltas → done.
    const typeIndex = events.findIndex((e) => e.type === "tool-call");
    const resultIndex = events.findIndex((e) => e.type === "tool-result");
    const doneIndex = events.findIndex((e) => "done" in e);
    expect(typeIndex).toBeLessThan(resultIndex);
    expect(resultIndex).toBeLessThan(doneIndex);

    const done = byKey(events, "done")[0];
    expect(done).toMatchObject({ done: true, validated: "document" });
    const document = done?.document as ProjectBundle["document"];
    const page = document.pages[0]!;
    expect(page.nodes.find((n) => n.id === page.rootId)?.type).toBe("AppShell");
    expect(page.nodes.some((n) => n.type === "StatCard")).toBe(true);
  });

  it("move: marker：set_frame 工具帧按序（含 ensure insert），done 文档 frame 生效", async () => {
    const bundle = await createProject();
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "修改 move:sec-1:320,80" },
    ], { mode: "patch", scope: { nodeIds: ["sec-1"] } }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);

    const calls = toolEvents(events, "tool-call").map((c) => c.name);
    const results = toolEvents(events, "tool-result").map((r) => r.ok);
    // ensure-insert under root, then the marker's own set_frame.
    expect(calls).toEqual(["insert_node", "set_frame"]);
    expect(results).toEqual([true, true]);
    // tool-call/tool-result interleave strictly.
    const seq = events
      .filter((e) => e.type === "tool-call" || e.type === "tool-result")
      .map((e) => `${e.type}:${e.name}`);
    expect(seq).toEqual([
      "tool-call:insert_node",
      "tool-result:insert_node",
      "tool-call:set_frame",
      "tool-result:set_frame",
    ]);

    const done = byKey(events, "done")[0];
    expect(done).toBeTruthy();
    const parsed = JSON.parse(done?.text as string) as { ops: { op: string; nodeId: string }[] };
    expect(parsed.ops[0]).toMatchObject({ op: "setFrame", nodeId: "sec-1" });
  });

  it("target: marker：update_props 工具帧出现，done ops 命中目标 id（P2 兼容）", async () => {
    const bundle = await createProject();
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "修改 target:n_abc12345 的样式" },
    ], { mode: "patch", scope: { nodeIds: ["n_abc12345"] } }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);
    const results = toolEvents(events, "tool-result");
    expect(results.map((r) => r.name)).toContain("update_props");
    const done = byKey(events, "done")[0];
    const parsed = JSON.parse(done?.text as string) as { ops: { op: string; id: string; props: { label: string } }[] };
    expect(parsed.ops[0]).toMatchObject({ op: "node.update", id: "n_abc12345" });
    expect(parsed.ops[0]?.props.label).toBe("更新后的指标");
  });

  it("多选：多个 target: 标记 → 每个选中节点各一个 update_props（scope 并集）", async () => {
    const bundle = await createProject();
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "统一强调 target:n_abc12345 target:n_def67890" },
    ], { mode: "patch", scope: { nodeIds: ["n_abc12345", "n_def67890"] } }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);
    const updates = toolEvents(events, "tool-result").filter((r) => r.name === "update_props");
    expect(updates).toHaveLength(2);
    const done = byKey(events, "done")[0];
    const parsed = JSON.parse(done?.text as string) as { ops: { op: string; id: string }[] };
    expect(parsed.ops.map((o) => o.id).sort()).toEqual(["n_abc12345", "n_def67890"]);
  });

  it("violation marker：工具帧记录越权失败，SSE 序列保持 violation + scope_violation", async () => {
    const bundle = await createProject();
    scopeViolations = [["越界 A"], ["越界 A", "越界 B"]];
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "修改 违规 target:n_x" },
    ], { mode: "patch", scope: { nodeIds: ["n_allowed"] } }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);

    // The loop attempted the out-of-scope write; the tool frame records the failure.
    const failedResults = toolEvents(events, "tool-result").filter((r) => !r.ok);
    expect(failedResults.length).toBeGreaterThan(0);
    expect(String(failedResults[0]?.message)).toContain("超出修改范围");

    // Legacy SSE sequence preserved exactly.
    const violations = byKey(events, "violation");
    expect(violations.length).toBe(1);
    expect(violations[0]).toMatchObject({ retry: true });
    const errors = byKey(events, "error");
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatchObject({ error: "scope_violation" });
    expect(errors[0]?.violations).toEqual(["越界 A", "越界 B"]);
    expect(scopeCalls).toBe(2);
  });

  it("badjson marker：未知工具失败 → invalid_json 错误帧，raw 为原坏文本", async () => {
    const bundle = await createProject();
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "修改 badjson" },
    ], { mode: "patch", scope: { nodeIds: ["n_abc12345"] } }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);

    const calls = toolEvents(events, "tool-call").map((c) => c.name);
    expect(calls).toContain("badjson"); // unroutable "tool" proposed by the marker
    const errors = byKey(events, "error");
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatchObject({ error: "invalid_json" });
    expect((errors[0]?.raw as string)).toContain("badjson 演示文本");
  });

  it("deps.driver 注入：脚本化驱动走同一执行管道（ChatDeps 测试缝）", async () => {
    const { runChatStream } = await import("../src/ai/routes.js");
    const { createProjectsStore } = await import("../src/store/projects.js");
    const store = createProjectsStore(join(dataDir, "projects"));
    const created = await store.create({
      name: "驱动注入",
      productType: "后台",
      targetUsers: "运营",
      goal: "看数据",
      referenceLinks: [],
      brandRules: "",
    });
    const driver = {
      round: 0,
      async next() {
        (this as { round: number }).round += 1;
        const round = (this as { round: number }).round;
        if (round === 1) {
          return [{ name: "insert_node", args: { type: "Button", parentId: "root", props: { label: "注入按钮" } } }];
        }
        return [];
      },
    };
    const events: Record<string, unknown>[] = [];
    await runChatStream(
      { store, dataDir, driver },
      {
        projectId: created.meta.id,
        messages: [{ role: "user", content: "加个按钮" }],
        mode: "patch",
        scope: { nodeIds: ["root"] },
        requestId: "req-driver-seam",
      },
      new AbortController(),
      async (ev) => void events.push(ev),
    );
    // Injected driver's insert executed through the SAME tool pipeline.
    const results = events.filter((e) => e.type === "tool-result");
    expect(results.map((r) => r.ok)).toEqual([true]);
    expect(String(results[0]?.message)).toContain("已插入");
    const done = events.find((e) => "done" in e);
    expect(done).toBeTruthy();
  });

  it("选中容器内插入新节点：只审计父容器，动态子节点不触发越界", async () => {
    const { runChatStream } = await import("../src/ai/routes.js");
    const store = createProjectsStore(join(dataDir, "projects-container-insert"));
    const created = await store.create({
      name: "容器插入范围回归",
      productType: "后台",
      targetUsers: "运营",
      goal: "验证容器内新增",
      referenceLinks: [],
      brandRules: "",
    });
    let round = 0;
    const driver: ToolDriver = {
      async next() {
        round += 1;
        return round === 1
          ? [{ name: "insert_node", args: { type: "Text", parentId: "root", props: { content: "仅限授权员工使用" } } }]
          : [];
      },
    };
    const events: Record<string, unknown>[] = [];
    await runChatStream(
      {
        store,
        dataDir,
        driver,
        scopeChecker: (ops, scope) => checkScope(ops as Parameters<typeof checkScope>[0], scope),
      },
      {
        projectId: created.meta.id,
        messages: [{ role: "user", content: "在选中的容器末尾新增正文" }],
        mode: "patch",
        scope: { nodeIds: ["root"] },
        requestId: "container-insert-scope",
      },
      new AbortController(),
      async (ev) => void events.push(ev),
    );
    const done = events.find((event) => "done" in event) as { text?: string } | undefined;
    expect(done).toBeTruthy();
    expect(events.some((event) => "error" in event)).toBe(false);
    const parsed = JSON.parse(done!.text!) as { ops: { op: string; parentId: string; node: { id: string } }[] };
    expect(parsed.ops).toHaveLength(1);
    expect(parsed.ops[0]).toMatchObject({ op: "node.add", parentId: "root" });
    expect(parsed.ops[0]!.node.id).toMatch(/^n_/);
  });

  it("同一容器连续插入同类型节点：每个 node.add 都引用对应的新节点", async () => {
    const { runChatStream } = await import("../src/ai/routes.js");
    const store = createProjectsStore(join(dataDir, "projects-container-insert-many"));
    const created = await store.create({
      name: "容器连续插入回归",
      productType: "后台",
      targetUsers: "运营",
      goal: "验证连续新增",
      referenceLinks: [],
      brandRules: "",
    });
    let round = 0;
    const driver: ToolDriver = {
      async next() {
        round += 1;
        return round === 1
          ? [
              { name: "insert_node", args: { type: "Text", parentId: "root", props: { content: "第一段" } } },
              { name: "insert_node", args: { type: "Text", parentId: "root", props: { content: "第二段" } } },
            ]
          : [];
      },
    };
    const events: Record<string, unknown>[] = [];
    await runChatStream(
      {
        store,
        dataDir,
        driver,
        scopeChecker: (ops, scope) => checkScope(ops as Parameters<typeof checkScope>[0], scope),
      },
      {
        projectId: created.meta.id,
        messages: [{ role: "user", content: "连续新增两段正文" }],
        mode: "patch",
        scope: { nodeIds: ["root"] },
        requestId: "container-insert-many",
      },
      new AbortController(),
      async (ev) => void events.push(ev),
    );
    const done = events.find((event) => "done" in event) as { text?: string } | undefined;
    expect(done).toBeTruthy();
    const parsed = JSON.parse(done!.text!) as { ops: { op: string; node: { id: string; props: { content: string } } }[] };
    expect(parsed.ops).toHaveLength(2);
    expect(new Set(parsed.ops.map((op) => op.node.id)).size).toBe(2);
    expect(parsed.ops.map((op) => op.node.props.content)).toEqual(["第一段", "第二段"]);
  });

  it("细粒度工具结果转换为完整 patch ops：set_token、move_node、remove_node 不丢失", async () => {
    const { runChatStream } = await import("../src/ai/routes.js");
    const store = createProjectsStore(join(dataDir, "projects-tool-op-conversion"));
    const created = await store.create({
      name: "细粒度操作转换回归",
      productType: "后台",
      targetUsers: "运营",
      goal: "验证工具结果完整回传",
      referenceLinks: [],
      brandRules: "",
    });
    const initial = {
      documentVersion: 1 as const,
      name: "细粒度操作转换回归",
      tokens: {
        color: {
          brand: "#0F766E", surface: "#FFFFFF", text: "#172033", muted: "#64748B",
          border: "#E2E8F0", accent: "#0EA5E9", success: "#16A34A", warning: "#D97706", danger: "#DC2626",
        },
        radius: { card: 6, control: 4 },
        spacing: { unit: 4 },
        font: { sans: "Inter" },
      },
      rootId: "root",
      nodes: [
        { id: "root", type: "Container", props: {}, children: ["stack", "text-a", "text-b"] },
        { id: "stack", type: "Stack", props: {}, children: [] },
        { id: "text-a", type: "Text", props: {}, children: [] },
        { id: "text-b", type: "Text", props: {}, children: [] },
      ],
    };
    await store.save(created.meta.id, { meta: created.meta, document: initial });
    let round = 0;
    const driver: ToolDriver = {
      async next(input) {
        round += 1;
        if (round !== 1) return [];
        return [
          { name: "set_token", args: { path: ["color", "brand"], value: "#C2410C" } },
          { name: "move_node", args: { nodeId: "text-a", newParentId: "stack", index: 0 } },
          { name: "remove_node", args: { nodeId: "text-b" } },
        ];
      },
    };
    const events: Record<string, unknown>[] = [];
    await runChatStream(
      { store, dataDir, driver },
      {
        projectId: created.meta.id,
        messages: [{ role: "user", content: "调整页面结构和品牌色" }],
        mode: "patch",
        requestId: "tool-op-conversion",
      },
      new AbortController(),
      async (ev) => void events.push(ev),
    );

    const done = events.find((event) => "done" in event) as { text?: string } | undefined;
    expect(done).toBeTruthy();
    const parsed = JSON.parse(done!.text!) as { ops: { op: string }[] };
    expect(parsed.ops.map((op) => op.op)).toEqual(["tokens.set", "node.move", "node.remove"]);
  });
});

describe("生成模式完成判定（细粒度工具语义）", () => {
  function oneShotDriver(calls: DriverCall[]): ToolDriver {
    let used = false;
    return {
      async next() {
        if (used) return [];
        used = true;
        return calls;
      },
    };
  }

  async function runGenerate(driver: ToolDriver): Promise<Record<string, unknown>[]> {
    const { runChatStream } = await import("../src/ai/routes.js");
    const store = createProjectsStore(join(dataDir, "projects-completion-gate"));
    const created = await store.create({
      name: "完成判定回归",
      productType: "后台",
      targetUsers: "运营",
      goal: "验证生成完成判定",
      referenceLinks: [],
      brandRules: "",
    });
    const events: Record<string, unknown>[] = [];
    await runChatStream(
      { store, dataDir, driver },
      {
        projectId: created.meta.id,
        messages: [{ role: "user", content: "生成页面" }],
        mode: "generate",
        requestId: crypto.randomUUID(),
      },
      new AbortController(),
      async (ev) => void events.push(ev),
    );
    return events;
  }

  it.each(["read_document", "list_components"])(
    "%s 成功但没有写入 → 不能误报生成成功",
    async (name) => {
      const events = await runGenerate(oneShotDriver([{ name, args: {} }]));
      expect(byKey(events, "done")).toHaveLength(0);
      expect(byKey(events, "error")).toEqual([
        expect.objectContaining({ error: "invalid_json" }),
      ]);
    },
  );

  it("细粒度写工具成功且最终文档有效 → 进入待应用结果", async () => {
    const events = await runGenerate(oneShotDriver([
      { name: "insert_node", args: { type: "Text", parentId: "root", props: { content: "生成结果" } } },
      { name: "set_token", args: { path: ["color", "brand"], value: "#123456" } },
    ]));
    expect(byKey(events, "error")).toHaveLength(0);
    expect(byKey(events, "done")).toEqual([
      expect.objectContaining({ done: true, validated: "document" }),
    ]);
  });

  it("多步细粒度生成：insert_node → update_props 后 done 文档包含最终节点属性", async () => {
    let round = 0;
    const driver: ToolDriver = {
      async next(input) {
        round += 1;
        if (round === 1) {
          return [{ name: "insert_node", args: { type: "Button", parentId: "root", props: { label: "初始按钮" } } }];
        }
        if (round === 2) {
          const inserted = input.doc.pages[0]!.nodes.find((node) => node.type === "Button");
          expect(inserted).toBeDefined();
          return [{
            name: "update_props",
            args: { nodeId: inserted!.id, props: { label: "最终按钮", variant: "primary", size: "md" } },
          }];
        }
        return [];
      },
    };
    const events = await runGenerate(driver);
    const done = byKey(events, "done")[0] as { validated: string; document: StudioDocument } | undefined;
    expect(done).toMatchObject({ validated: "document" });
    const button = done?.document.pages[0]!.nodes.find((node) => node.type === "Button");
    expect(button?.props).toMatchObject({ label: "最终按钮", variant: "primary", size: "md" });
  });

  it("全部工具失败 → 不能误报生成成功", async () => {
    const events = await runGenerate(oneShotDriver([
      { name: "update_props", args: { nodeId: "ghost", props: { label: "x" } } },
    ]));
    expect(byKey(events, "done")).toHaveLength(0);
    expect(byKey(events, "error")).toEqual([
      expect.objectContaining({ error: "invalid_json" }),
    ]);
  });

  it("读工具成功 + 非法文档提案失败 → 不能把原文档误报为生成结果", async () => {
    const events = await runGenerate(oneShotDriver([
      { name: "read_document", args: {} },
      { name: "propose_document", args: { document: { name: "非法文档" } } },
    ]));
    expect(byKey(events, "done")).toHaveLength(0);
    expect(byKey(events, "error")).toEqual([
      expect.objectContaining({ error: "invalid_json" }),
    ]);
  });
});

describe("POST /api/chat/completions — generate mode (mock provider)", () => {
  it("流式 delta 透传，最终 done 带 validated document（AppShell 根）", async () => {
    const bundle = await createProject();
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "生成一个运营工作台" },
    ]));
    expect(res.status).toBe(200);
    const events = await collectSse(res);

    const deltas = byKey(events, "delta");
    expect(deltas.length).toBe(5); // mock 分 5 段
    const streamed = (deltas.map((d) => d.delta) as string[]).join("");
    // Human plan only — never the full {plan, document} JSON dump (UX: left rail).
    expect(streamed).toContain("规划");
    expect(streamed).not.toContain("documentVersion");

    const dones = byKey(events, "done");
    expect(dones.length).toBe(1);
    expect(dones[0]).toMatchObject({ done: true, validated: "document" });
    const document = dones[0]?.document as ProjectBundle["document"];
    const page = document.pages[0]!;
    expect(page.rootId).toBeTruthy();
    expect(page.nodes.find((n) => n.id === page.rootId)?.type).toBe("AppShell");
    expect(page.nodes.some((n) => n.type === "StatCard")).toBe(true);
  });

  it("plan mode：done 不带 validated（文本规划不校验文档）", async () => {
    const bundle = await createProject();
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "生成一个运营工作台" },
    ], { mode: "plan" }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);
    const dones = byKey(events, "done");
    expect(dones.length).toBe(1);
    expect(dones[0]).not.toHaveProperty("validated");
    expect((dones[0]?.text as string).length).toBeGreaterThan(0);
  });

  it("未知 projectId 返回 404（先于流开始）", async () => {
    const res = await app.request(...chatCall("00000000-0000-4000-8000-000000000000", [
      { role: "user", content: "生成" },
    ]));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("非法 body（mode 缺失/projectId 非 uuid）返回 400", async () => {
    const bundle = await createProject();
    const badMode = await app.request("/api/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: bundle.meta.id,
        messages: [{ role: "user", content: "hi" }],
        mode: "unknown",
        requestId: crypto.randomUUID(),
      }),
    });
    expect(badMode.status).toBe(400);
    const body = (await badMode.json()) as { error: string };
    expect(body.error).toBe("invalid_body");

    const badId = await app.request("/api/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "not-a-uuid",
        messages: [{ role: "user", content: "hi" }],
        mode: "generate",
        requestId: crypto.randomUUID(),
      }),
    });
    expect(badId.status).toBe(400);
  });
});

describe("POST /api/chat/completions — patch mode", () => {
  it("delta 透传，done 带完整文本（含 ops）", async () => {
    const bundle = await createProject();
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "修改 target:n_abc12345 的样式" },
    ], { mode: "patch", scope: { nodeIds: ["n_abc12345"] } }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);
    expect(byKey(events, "delta").length).toBe(5);
    const done = byKey(events, "done")[0];
    const parsed = JSON.parse(done?.text as string) as {
      ops: { op: string; id: string }[];
    };
    expect(parsed.ops[0]).toMatchObject({ op: "node.update", id: "n_abc12345" });
  });

  it("badjson marker → error invalid_json 且保留 raw", async () => {
    const bundle = await createProject();
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "修改 badjson" },
    ], { mode: "patch", scope: { nodeIds: ["n_abc12345"] } }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);
    const errors = byKey(events, "error");
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatchObject({ error: "invalid_json" });
    expect((errors[0]?.raw as string).length).toBeGreaterThan(0);
  });

  it("违规 marker + scopeChecker 返回违规 → violation+retry=true；重试仍违规 → error scope_violation", async () => {
    const bundle = await createProject();
    scopeViolations = [["越界 A"], ["越界 A", "越界 B"]];
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "修改 违规 target:n_x" },
    ], { mode: "patch", scope: { nodeIds: ["n_allowed"] } }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);

    const violations = byKey(events, "violation");
    expect(violations.length).toBe(1); // 违规事件只发一次（首次）
    expect(violations[0]).toMatchObject({ retry: true });

    const errors = byKey(events, "error");
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatchObject({ error: "scope_violation" });
    expect(errors[0]?.violations).toEqual(["越界 A", "越界 B"]);
    expect(scopeCalls).toBe(2); // 自动重试恰好一次
  });

  it("重试后合规 → 正常 done", async () => {
    const bundle = await createProject();
    scopeViolations = [["越界 A"], []]; // 第一次违规，第二次（重试）放行
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "修改 违规 target:n_x" },
    ], { mode: "patch", scope: { nodeIds: ["n_allowed"] } }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);
    expect(byKey(events, "violation").length).toBe(1);
    expect(byKey(events, "done").length).toBe(1);
    expect(byKey(events, "error").length).toBe(0);
    expect(scopeCalls).toBe(2);
  });
});

describe("POST /api/chat/completions — 空间指令 marker（P5-4）", () => {
  /** Read the last done frame's ops (mock provider; single done per request). */
  async function doneOps(res: Response): Promise<Record<string, unknown>[]> {
    const events = await collectSse(res);
    const dones = byKey(events, "done");
    expect(dones.length).toBe(1);
    const parsed = JSON.parse(dones[0]?.text as string) as { ops: Record<string, unknown>[] };
    return parsed.ops;
  }

  it("move:sec-1:320,80 → done 带 setFrame op（x/y 指定，默认 w/h/rotation）", async () => {
    const bundle = await createProject();
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "修改 move:sec-1:320,80" },
    ], { mode: "patch", scope: { nodeIds: ["sec-1"] } }));
    expect(res.status).toBe(200);
    const ops = await doneOps(res);
    expect(ops[0]).toMatchObject({
      op: "setFrame",
      nodeId: "sec-1",
      frame: { x: 320, y: 80, w: 240, h: 120, rotation: 0 },
    });
  });

  it("resize:sec-1:480,240 → frame w/h 指定，x/y 默认 0", async () => {
    const bundle = await createProject();
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "修改 resize:sec-1:480,240" },
    ], { mode: "patch", scope: { nodeIds: ["sec-1"] } }));
    expect(res.status).toBe(200);
    const ops = await doneOps(res);
    expect(ops[0]).toMatchObject({
      op: "setFrame",
      nodeId: "sec-1",
      frame: { x: 0, y: 0, w: 480, h: 240, rotation: 0 },
    });
  });

  it("现有 frame 的节点 move 时保留原 w/h/rotation（mock 从系统提示词读当前文档）", async () => {
    const bundle = await createProject();
    // 落盘一份含 sec-1 且带 frame 的文档：PUT 全量 bundle（meta + document）
    const basePage = (bundle.document as StudioDocument).pages[0]!;
    const withFrame = {
      ...(bundle.document as StudioDocument),
      pages: [
        {
          ...basePage,
          nodes: [
            ...basePage.nodes.map((n) => (n.id === "root" ? { ...n, children: ["sec-1"] } : n)),
            {
              id: "sec-1",
              type: "Section",
              props: { title: "关键指标" },
              children: [],
              frame: { x: 120, y: 40, w: 200, h: 100, rotation: 45 },
            },
          ],
        },
      ],
    };
    const put = await app.request(`/api/projects/${bundle.meta.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: bundle.meta, document: withFrame }),
    });
    expect(put.status).toBe(200);

    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "修改 move:sec-1:320,80" },
    ], { mode: "patch", scope: { nodeIds: ["sec-1"] } }));
    const ops = await doneOps(res);
    expect(ops[0]).toMatchObject({
      op: "setFrame",
      nodeId: "sec-1",
      frame: { x: 320, y: 80, w: 200, h: 100, rotation: 45 },
    });
  });

  it("ops 载荷省略 rotation → strip 校验后 done 文本含 rotation 0（真实 provider 路径）", async () => {
    // 走 runChatStream + ChatDeps.provider 注入一个返回省略 rotation 的 setFrame 的 provider，
    // 断言 parsePatch 的 guardOps 放行（server 侧只做结构校验，zod strip 在前端）
    const { runChatStream } = await import("../src/ai/routes.js");
    const { createProjectsStore } = await import("../src/store/projects.js");
    const store = createProjectsStore(join(dataDir, "projects"));
    const created = await store.create({
      name: "空间文档",
      productType: "后台",
      targetUsers: "运营",
      goal: "看数据",
      referenceLinks: [],
      brandRules: "",
    });
    // Agent loop 真正执行工具，作用域内的节点必须存在（旧管线只做文本解析）。
    // store 泛化后 document 为 unknown（P7.3）；此处是 UI 项目，按 UI 文档收紧。
    const uiDoc = created.document as StudioDocument;
    const uiPage = uiDoc.pages[0]!;
    const withSec = {
      ...uiDoc,
      pages: [
        {
          ...uiPage,
          nodes: [
            ...uiPage.nodes.map((n) =>
              n.id === uiPage.rootId ? { ...n, children: ["sec-1"] } : n,
            ),
            { id: "sec-1", type: "Section", props: { title: "关键指标" }, children: [] },
          ],
        },
      ],
    };
    await store.save(created.meta.id, { meta: created.meta, document: withSec });
    const provider = {
      supportsImages: true,
      async detect() {
        return { id: "spatial-stub", available: true };
      },
      async complete() {
        return {
          text: JSON.stringify({
            plan: "规划：移动节点。",
            ops: [{ op: "setFrame", nodeId: "sec-1", frame: { x: 10, y: 20, w: 100, h: 50 } }],
          }),
        };
      },
    };
    const events: Record<string, unknown>[] = [];
    await runChatStream(
      { store, dataDir, provider },
      {
        projectId: created.meta.id,
        messages: [{ role: "user", content: "移动它" }],
        mode: "patch",
        scope: { nodeIds: ["sec-1"] },
        requestId: "req-spatial-strip",
      },
      new AbortController(),
      async (ev) => void events.push(ev),
    );
    expect(events.filter((e) => "error" in e)).toHaveLength(0);
    const done = events.find((e) => "done" in e);
    const ops = (JSON.parse(String(done?.text)) as { ops: { frame: Record<string, number> }[] }).ops;
    expect(ops[0]?.frame).toMatchObject({ x: 10, y: 20, w: 100, h: 50 });
    // rotation 省略是合法输入（frameSchema 默认补 0）；server 原样透传，前端 zod 注入 0
  });

  it("move 越权节点 → violation+retry 路径对 setFrame op 生效（镜像既有 scope 测试）", async () => {
    const bundle = await createProject();
    scopeViolations = [["节点 sec-out 超出修改范围"], ["节点 sec-out 超出修改范围"]];
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "修改 move:sec-out:10,10" },
    ], { mode: "patch", scope: { nodeIds: ["n_allowed"] } }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);
    const violations = byKey(events, "violation");
    expect(violations.length).toBe(1);
    expect(violations[0]).toMatchObject({ retry: true });
    const errors = byKey(events, "error");
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatchObject({ error: "scope_violation" });
    expect(scopeCalls).toBe(2); // 自动重试恰好一次
  });
});

describe("buildSystemPrompt 画布契约（P5-4）", () => {
  it("patch/generate 模式含 setFrame 契约；plan 模式不含", async () => {
    const bundle = await createProject();
    const { buildSystemPrompt } = await import("../src/ai/systemPrompt.js");
    const patch = buildSystemPrompt(bundle, "patch", { nodeIds: ["sec-1"] });
    expect(patch).toContain("setFrame");
    expect(patch).toContain('"frame":{"x":320,"y":80,"w":240,"h":120,"rotation":0}');
    expect(patch).toContain("1440×900");
    const generate = buildSystemPrompt(bundle, "generate", undefined);
    expect(generate).toContain("setFrame");
    const plan = buildSystemPrompt(bundle, "plan", undefined);
    expect(plan).not.toContain("画布空间契约");
    expect(plan).not.toContain("setFrame");
  });

  it("patch 允许在选中容器内新增子节点，且明确新节点 id 自动生成", async () => {
    const bundle = await createProject();
    const { buildSystemPrompt } = await import("../src/ai/systemPrompt.js");
    const prompt = buildSystemPrompt(bundle, "patch", { nodeIds: ["loginStack"] });
    expect(prompt).toContain("选中容器内新增子节点");
    expect(prompt).toContain("新节点 id");
  });
});

describe("POST /api/chat/cancel", () => {
  it("发起后立即 cancel → 收到 canceled 事件、流关闭", async () => {
    const bundle = await createProject();
    const requestId = crypto.randomUUID();
    const res = await app.request("/api/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: bundle.meta.id,
        messages: [{ role: "user", content: "生成一个运营工作台" }],
        mode: "generate",
        requestId,
      }),
    });
    expect(res.status).toBe(200);

    const cancelRes = await app.request("/api/chat/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
    expect(cancelRes.status).toBe(200);

    const events = await collectSse(res);
    expect(events).toContainEqual({ canceled: true });
  });

  it("未注册 requestId cancel → ok:false", async () => {
    const res = await app.request("/api/chat/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: crypto.randomUUID() }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("重复注册同 requestId = 覆盖旧 controller（旧流被 abort）", async () => {
    const bundle = await createProject();
    const requestId = crypto.randomUUID();
    const first = await app.request("/api/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: bundle.meta.id,
        messages: [{ role: "user", content: "生成一个运营工作台" }],
        mode: "generate",
        requestId,
      }),
    });
    expect(first.status).toBe(200);
    // 消费完第一条流（mock 立即完成），再发同 requestId 的第二条
    await collectSse(first);

    const second = await app.request("/api/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: bundle.meta.id,
        messages: [{ role: "user", content: "生成一个运营工作台" }],
        mode: "generate",
        requestId,
      }),
    });
    expect(second.status).toBe(200);
    const events = await collectSse(second);
    expect(byKey(events, "done").length).toBe(1); // 第二条正常完成
  });
});

describe("流式可见性帧（stage/progress/heartbeat）", () => {
  /** Mock-driver 驱动的 generate 流：读取 → 模型（每轮）→ 工具帧 → done 的阶段序。 */
  it("generate marker：stage/reading 先于 stage/model 与全部工具帧", async () => {
    const bundle = await createProject();
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "生成一个运营工作台" },
    ]));
    expect(res.status).toBe(200);
    const events = await collectSse(res);

    // 两个 model 阶段帧：轮 1 propose_document + 轮 2 模型确认结束（真实模型
    // 在轮 2 正是长静默窗口——该帧就是为它存在的）。
    const stages = events.filter((e) => e.type === "stage") as { id: string }[];
    expect(stages.map((s) => s.id)).toEqual(["reading", "model", "model"]);
    const readingIdx = events.findIndex((e) => e.type === "stage" && (e as { id: string }).id === "reading");
    const modelIdx = events.findIndex((e) => e.type === "stage" && (e as { id: string }).id === "model");
    const firstTool = events.findIndex((e) => e.type === "tool-call");
    expect(readingIdx).toBe(0); // reading 是首个 SSE 帧（进入即发）
    expect(readingIdx).toBeLessThan(modelIdx);
    expect(modelIdx).toBeLessThan(firstTool);
  });

  it("plan 模式直连 complete：stage/reading → stage/model → done（无工具帧）", async () => {
    const bundle = await createProject();
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "生成一个运营工作台" },
    ], { mode: "plan" }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);
    const stages = events.filter((e) => e.type === "stage") as { id: string }[];
    expect(stages.map((s) => s.id)).toEqual(["reading", "model"]);
    expect(events.filter((e) => e.type === "tool-call")).toHaveLength(0);
    expect(byKey(events, "done").length).toBe(1);
  });

  it("每轮 driver.next 一条 stage/model；progress 步数累计到 total=24", async () => {
    const bundle = await createProject();
    // move marker：轮 1 propose（ensure-insert + set_frame 两调用），轮 2 空批结束
    const res = await app.request(...chatCall(bundle.meta.id, [
      { role: "user", content: "修改 move:sec-1:320,80" },
    ], { mode: "patch", scope: { nodeIds: ["sec-1"] } }));
    expect(res.status).toBe(200);
    const events = await collectSse(res);
    const modelStages = events.filter((e) => e.type === "stage" && (e as { id: string }).id === "model");
    expect(modelStages).toHaveLength(2); // 一次/轮：轮1 提案 + 轮2 结束确认
    const progress = events.filter((e) => e.type === "progress") as { step: number; total: number; label: string }[];
    expect(progress.map((p) => p.step)).toEqual([1, 2]);
    expect(progress.every((p) => p.total === 24)).toBe(true);
    expect(progress[0]?.label).toContain("1 步");
  });

  it("假时钟下静默 provider 流出现 ≥1 个心跳帧；流结束即停", async () => {
    vi.useFakeTimers();
    try {
      const store = createProjectsStore(join(dataDir, "projects-slow"));
      const created = await store.create({
        name: "假时钟慢速流",
        productType: "后台",
        targetUsers: "运营",
        goal: "看数据",
        referenceLinks: [],
        brandRules: "",
      });
      // provider 静默 11s（mock 的 3 个 provider 调用各自延迟）→ 2 个心跳周期
      const slowProvider = {
        supportsImages: true,
        async detect() {
          return { id: "slow-stub", available: true };
        },
        async complete() {
          await new Promise((r) => setTimeout(r, 11000));
          return { text: JSON.stringify({ plan: "规划：慢速完成。", ops: [] }) };
        },
      };
      const slowApp = createApp(store, { dataDir, scopeChecker: scopeStub, provider: slowProvider });
      const res = await slowApp.request("/api/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: created.meta.id,
          messages: [{ role: "user", content: "修改 target:n_abc12345 的样式" }],
          mode: "patch",
          scope: { nodeIds: ["n_abc12345"] },
          requestId: "req-fake-timer",
        }),
      });
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      const pump = (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          raw += decoder.decode(value, { stream: true });
        }
      })();
      // 推进假时钟直到流结束（provider 11s + 余量）
      for (let t = 0; t < 14 && !(await Promise.race([pump.then(() => true), Promise.resolve(false)])); t += 1) {
        await vi.advanceTimersByTimeAsync(1000);
      }
      await pump;
      const frames: Record<string, unknown>[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("data:")) frames.push(JSON.parse(line.slice(5).trim()));
      }
      const heartbeats = frames.filter((e) => e.type === "heartbeat") as { at: number }[];
      expect(heartbeats.length).toBeGreaterThanOrEqual(2);
      heartbeats.forEach((h) => expect(h.at).toBeGreaterThan(0));
      // 心跳都出现在终帧（done）之前；终帧之后流关闭，无残留
      const lastHeartbeatIdx = frames.map((e) => e.type === "heartbeat").lastIndexOf(true);
      const doneIdx = frames.findIndex((e) => "done" in e || "error" in e || "canceled" in e);
      expect(doneIdx).toBeGreaterThan(lastHeartbeatIdx);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("P7 修复回归：空产出重试", () => {
  it("agent loop 空产出（驱动无任何工具调用）→ error 帧明确报「未产生有效变更」，不静默 done", async () => {
    const { runChatStream } = await import("../src/ai/routes.js");
    const { createProjectsStore } = await import("../src/store/projects.js");
    const store = createProjectsStore(join(dataDir, "projects"));
    const created = await store.create({
      name: "空产出文档",
      productType: "后台",
      targetUsers: "运营",
      goal: "看数据",
      referenceLinks: [],
      brandRules: "",
    });
    // 模型「规划」了但一个工具都没调用（真实模型失败形态之一）
    const driver = { next: async () => [] };
    const events: Record<string, unknown>[] = [];
    await runChatStream(
      { store, dataDir, driver },
      {
        projectId: created.meta.id,
        messages: [{ role: "user", content: "整体换成暖色品牌色" }],
        mode: "patch",
        scope: { nodeIds: ["sec-1"], allowAllTokens: false },
        requestId: "empty-ops-1",
      },
      new AbortController(),
      async (ev) => void events.push(ev),
    );
    // 契约：空产出 = done（模型认为无需修改），不报错不发确认卡；
    // workbench 侧把它转成「AI 认为无需修改」的明确提示。
    expect(events.some((e) => "done" in e)).toBe(true);
    expect(events.some((e) => "error" in e)).toBe(false);
    const doneText = (events.find((e) => "done" in e) as { text: string }).text;
    expect(JSON.parse(doneText).ops).toEqual([]);
  });

  it("SDK 零工具但有说明时，done 帧保留说明，不出现无需修改文案", async () => {
    const { runChatStream } = await import("../src/ai/routes.js");
    const { createProjectsStore } = await import("../src/store/projects.js");
    const store = createProjectsStore(join(dataDir, "projects"));
    const created = await store.create({
      name: "空命令解释",
      productType: "",
      targetUsers: "",
      goal: "",
      referenceLinks: [],
      brandRules: "",
    });
    const explanation = "当前页面没有可替换图片，请先上传小猫图片。";
    const driver = {
      next: async () => [],
      takeInternal: () => ({ steps: [], doc: created.document as StudioDocument, explanation }),
    };
    const events: Record<string, unknown>[] = [];
    await runChatStream(
      { store, dataDir, driver },
      {
        projectId: created.meta.id,
        messages: [{ role: "user", content: "改成小猫" }],
        mode: "patch",
        requestId: "empty-ops-explanation",
      },
      new AbortController(),
      async (ev) => void events.push(ev),
    );
    const done = events.find((e) => "done" in e) as { text: string } | undefined;
    expect(done).toBeTruthy();
    const payload = JSON.parse(done!.text) as { plan: string; ops: unknown[] };
    expect(payload.ops).toEqual([]);
    expect(payload.plan).toBe(explanation);
  });
});

// ---------------------------------------------------------------------------
// T21 §3.6 目标页语义（F3/F4）：loop 只改请求页；done/写入不碰其余页
// ---------------------------------------------------------------------------

/** Two-page fixture: page-2 named distinctly so byte-equality is meaningful. */
function twoPageDoc(): StudioDocument {
  return {
    documentVersion: 2,
    name: "多页文档",
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
          { id: "p1_stat", type: "StatCard", props: { label: "首页指标", value: "1", delta: "", tone: "brand" }, children: [] },
        ],
      },
      {
        id: "page-2",
        name: "第二页",
        rootId: "p2_root",
        nodes: [
          { id: "p2_root", type: "Container", props: {}, children: ["p2_stat"] },
          { id: "p2_stat", type: "StatCard", props: { label: "第二页指标", value: "2", delta: "", tone: "brand" }, children: [] },
        ],
      },
    ],
  };
}

describe("chat 目标页语义（T21 F3/F4）", () => {
  async function seedTwoPage(): Promise<{ store: ProjectsStore; projectId: string }> {
    const { createProjectsStore } = await import("../src/store/projects.js");
    const store = createProjectsStore(join(dataDir, "projects-page-semantics"));
    const created = await store.create({
      name: "多页文档",
      productType: "后台",
      targetUsers: "运营",
      goal: "验证目标页语义",
      referenceLinks: [],
      brandRules: "",
    });
    await store.save(created.meta.id, { meta: created.meta, document: twoPageDoc() });
    return { store, projectId: created.meta.id };
  }

  function updateDriver(nodeId: string): ToolDriver {
    let used = false;
    return {
      async next(input) {
        void input;
        if (used) return [];
        used = true;
        return [{ name: "update_props", args: { nodeId, props: { label: "被改过" } } }];
      },
    };
  }

  it("F3：patch + pageId=page-2 → 只改第二页，其余页不进 loop 文档", async () => {
    const { runChatStream } = await import("../src/ai/routes.js");
    const { store, projectId } = await seedTwoPage();
    const before = ((await store.read(projectId)).document as StudioDocument).pages[0]!;
    const seenDocs: StudioDocument[] = [];
    let used = false;
    const driver: ToolDriver = {
      async next(input) {
        seenDocs.push(input.doc);
        if (used) return [];
        used = true;
        return [{ name: "update_props", args: { nodeId: "p2_stat", props: { label: "被改过" } } }];
      },
    };
    const events: Record<string, unknown>[] = [];
    await runChatStream(
      { store, dataDir, driver },
      {
        projectId,
        messages: [{ role: "user", content: "修改第二页的指标卡" }],
        mode: "patch",
        scope: { nodeIds: ["p2_stat"] },
        pageId: "page-2",
        requestId: "page-semantics-f3",
      },
      new AbortController(),
      async (ev) => void events.push(ev),
    );
    expect(events.some((e) => "error" in e)).toBe(false);
    // The loop's working doc carries ONLY the target page.
    expect(seenDocs.length).toBeGreaterThan(0);
    for (const doc of seenDocs) {
      expect(doc.pages).toHaveLength(1);
      expect(doc.pages[0]!.id).toBe("page-2");
    }
    // First page byte-identical (loop never saw or mutated it).
    expect(((await store.read(projectId)).document as StudioDocument).pages[0]).toEqual(before);
    const done = events.find((e) => "done" in e) as { text?: string };
    expect(done).toBeTruthy();
    const parsed = JSON.parse(done!.text!) as { ops: { op: string; id: string; props: { label: string } }[] };
    expect(parsed.ops[0]).toMatchObject({ op: "node.update", id: "p2_stat", props: { label: "被改过" } });
  });

  it("F4：无 pageId（旧调用方）→ 默认首页", async () => {
    const { runChatStream } = await import("../src/ai/routes.js");
    const { store, projectId } = await seedTwoPage();
    const events: Record<string, unknown>[] = [];
    await runChatStream(
      { store, dataDir, driver: updateDriver("p1_stat") },
      {
        projectId,
        messages: [{ role: "user", content: "修改首页的指标卡" }],
        mode: "patch",
        scope: { nodeIds: ["p1_stat"] },
        requestId: "page-semantics-f4",
      },
      new AbortController(),
      async (ev) => void events.push(ev),
    );
    expect(events.some((e) => "error" in e)).toBe(false);
    expect(events.some((e) => "done" in e)).toBe(true);
  });
});
