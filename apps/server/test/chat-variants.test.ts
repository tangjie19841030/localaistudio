import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page, StudioDocument } from "@studio/schema-core";
import { createProjectsStore, type ProjectsStore } from "../src/store/projects.js";
import type { ChatMessage } from "../src/ai/provider.js";
import type { DriverCall, DriverInput, ToolDriver } from "../src/ai/agentLoop.js";

/**
 * T60 (W3-B) server-side variants: generate requests may ask for
 * `variants: 2|3` total rounds. The first round stays the primary `document`;
 * later differentiated rounds ride the done frame as additive `alternatives`.
 * Scripted drivers exercise: (a) happy 2-variant path, (b) mid-round failure
 * skip, (c) fake-timer timeout truncation, (d) the no-variants SSE regression,
 * (e) OP-6 plan/patch silent ignore.
 */

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(join(tmpdir(), "studio-chat-variants-"));
});

afterEach(async () => {
  vi.useRealTimers();
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function createProject(suffix: string): Promise<{ store: ProjectsStore; projectId: string }> {
  const store = createProjectsStore(join(dataDir, `projects-${suffix}`));
  const created = await store.create({
    name: "运营工作台",
    productType: "后台",
    targetUsers: "运营",
    goal: "看数据",
    referenceLinks: [],
    brandRules: "",
  });
  return { store, projectId: created.meta.id };
}

/** Deterministic dashboard page (mock-shape) whose name/label identify the round. */
function variantPage(name: string, label: string): Page {
  return {
    id: "page-1",
    name,
    rootId: "m_root",
    nodes: [
      { id: "m_root", type: "AppShell", props: { title: name, sidebar: true }, children: ["m_header", "m_section"] },
      { id: "m_header", type: "Header", props: { title: name, subtitle: "核心指标一览" }, children: [] },
      { id: "m_section", type: "Section", props: { title: "关键指标", description: "今日实时数据" }, children: ["m_stat_1", "m_stat_2", "m_button"] },
      { id: "m_stat_1", type: "StatCard", props: { label, value: "12,804", delta: "+8%", tone: "brand" }, children: [] },
      { id: "m_stat_2", type: "StatCard", props: { label: "转化率", value: "3.2%", delta: "+0.4%", tone: "success" }, children: [] },
      { id: "m_button", type: "Button", props: { label: "导出报表", variant: "primary", size: "md" }, children: [] },
    ],
  };
}

type NextBehavior = DriverCall[] | "throw" | "hang";

/** Resolve [] once the pipeline aborts (or a huge fake-time backstop elapses). */
function hangUntilAborted(signal: AbortSignal | undefined): Promise<DriverCall[]> {
  return new Promise((resolve) => {
    const settle = (): void => {
      clearTimeout(backstop);
      resolve([]);
    };
    const backstop = setTimeout(settle, 10_000_000);
    if (signal?.aborted) settle();
    else signal?.addEventListener("abort", settle, { once: true });
  });
}

function scriptedDriver(behaviors: NextBehavior[]): { driver: ToolDriver; transcripts: ChatMessage[][] } {
  const transcripts: ChatMessage[][] = [];
  let call = 0;
  return {
    transcripts,
    driver: {
      async next(input: DriverInput) {
        const behavior = behaviors[call];
        transcripts.push(input.messages);
        call += 1;
        if (behavior === "throw") throw new Error("模拟供应商离线");
        if (behavior === "hang") {
          // Fake-clock test: fire the pipeline timeout (240s × 3 variants)
          // from inside the hung round, then resolve on the resulting abort.
          vi.advanceTimersByTime(720_001);
          return hangUntilAborted(input.signal);
        }
        return behavior ?? [];
      },
    },
  };
}

async function runVariantsChat(
  suffix: string,
  driver: ToolDriver,
  variants?: 2 | 3,
): Promise<Record<string, unknown>[]> {
  const { runChatStream } = await import("../src/ai/routes.js");
  const { store, projectId } = await createProject(suffix);
  const events: Record<string, unknown>[] = [];
  await runChatStream(
    { store, dataDir, driver },
    {
      projectId,
      messages: [{ role: "user", content: "生成一个运营工作台" }],
      mode: "generate",
      requestId: `variants-${suffix}`,
      ...(variants === undefined ? {} : { variants }),
    },
    new AbortController(),
    async (ev) => void events.push(ev),
  );
  return events;
}

const firstRoundPropose: DriverCall[] = [
  { name: "propose_document", args: { document: variantPage("运营工作台", "今日活跃") } },
];

interface DoneFrame {
  done: boolean;
  validated?: string;
  document: StudioDocument;
  alternatives?: StudioDocument[];
}

function singleDone(events: Record<string, unknown>[]): DoneFrame {
  const dones = events.filter((e) => "done" in e);
  expect(dones).toHaveLength(1);
  return dones[0] as unknown as DoneFrame;
}

describe("generate variants（T60 W3-B）", () => {
  it("(a) variants=2 → done 带 1 项 alternatives，document 恒为首轮", async () => {
    const script = scriptedDriver([
      firstRoundPropose,
      [],
      [{ name: "propose_document", args: { document: variantPage("变体二", "今日活跃B") } }],
      [],
    ]);
    const events = await runVariantsChat("v2", script.driver, 2);
    const done = singleDone(events);
    expect(done.done).toBe(true);
    expect(done.validated).toBe("document");
    expect(done.document.pages[0]!.name).toBe("运营工作台");
    expect(done.alternatives).toHaveLength(1);
    expect(done.alternatives![0]!.pages[0]!.name).toBe("变体二");
    expect(events.some((e) => "error" in e)).toBe(false);
    // Round-2 transcript carried the base differentiation note (§2.4 wording),
    // without the round-3 nudge.
    const round2 = script.transcripts[2]!;
    expect(round2[round2.length - 1]!.content).toContain("明显不同");
    expect(round2[round2.length - 1]!.content).not.toContain("再换一个方向");
  });

  it("(b) variants=3 第二轮抛错 → 跳过该轮继续，done 含 document+1，无 error 帧", async () => {
    const script = scriptedDriver([
      firstRoundPropose,
      [],
      "throw",
      [{ name: "propose_document", args: { document: variantPage("变体三", "今日活跃C") } }],
      [],
    ]);
    const events = await runVariantsChat("v3-fail", script.driver, 3);
    const done = singleDone(events);
    expect(done.validated).toBe("document");
    expect(done.document.pages[0]!.name).toBe("运营工作台");
    expect(done.alternatives).toHaveLength(1);
    expect(done.alternatives![0]!.pages[0]!.name).toBe("变体三");
    expect(events.some((e) => "error" in e)).toBe(false);
    // Round-3 note carries the extra direction nudge.
    const round3 = script.transcripts[3]!;
    expect(round3[round3.length - 1]!.content).toContain("再换一个方向");
  });

  it("(c) 超时截断第 3 轮 → 早返回已完成候选（无 canceled/error）", async () => {
    vi.useFakeTimers();
    const script = scriptedDriver([
      firstRoundPropose,
      [],
      [{ name: "propose_document", args: { document: variantPage("变体二", "今日活跃B") } }],
      [],
      "hang",
    ]);
    const events = await runVariantsChat("v3-timeout", script.driver, 3);
    const done = singleDone(events);
    expect(done.validated).toBe("document");
    expect(done.document.pages[0]!.name).toBe("运营工作台");
    expect(done.alternatives).toHaveLength(1); // round 3 discarded, round 2 kept
    expect(done.alternatives![0]!.pages[0]!.name).toBe("变体二");
    expect(events.some((e) => "error" in e)).toBe(false);
    expect(events.some((e) => "canceled" in e)).toBe(false);
  });

  it("(d) 无 variants → done 无 alternatives 字段（SSE 帧序回归）", async () => {
    const script = scriptedDriver([firstRoundPropose, []]);
    const events = await runVariantsChat("no-variants", script.driver);
    const done = singleDone(events);
    expect(done.done).toBe(true);
    expect(done.validated).toBe("document");
    expect("alternatives" in done).toBe(false);
    expect(events.some((e) => "error" in e)).toBe(false);
  });

  it("(e) patch 携带 variants → 静默忽略，done 无 alternatives（OP-6）", async () => {
    const { runChatStream } = await import("../src/ai/routes.js");
    const { store, projectId } = await createProject("patch-variants");
    let used = false;
    const driver: ToolDriver = {
      async next() {
        if (used) return [];
        used = true;
        return [{ name: "insert_node", args: { type: "Button", parentId: "root", props: { label: "补个按钮" } } }];
      },
    };
    const events: Record<string, unknown>[] = [];
    await runChatStream(
      { store, dataDir, driver },
      {
        projectId,
        messages: [{ role: "user", content: "加个按钮" }],
        mode: "patch",
        scope: { nodeIds: ["root"] },
        requestId: "variants-patch-ignore",
        variants: 2,
      },
      new AbortController(),
      async (ev) => void events.push(ev),
    );
    const done = events.find((e) => "done" in e) as Record<string, unknown> | undefined;
    expect(done).toBeTruthy();
    expect("alternatives" in done!).toBe(false);
    expect(events.some((e) => "error" in e)).toBe(false);
  });
});
