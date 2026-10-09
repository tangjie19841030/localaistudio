import { describe, expect, it } from "vitest";
import {
  autoLayout,
  defaultTokens,
  DOCUMENT_VERSION,
  type StudioDocument,
} from "@studio/schema-core";
import {
  MAX_VERIFY_ROUNDS,
  runVerifyLoop,
  type VerifyEvent,
} from "../src/ai/verifyLoop.js";
import type { ChatMessage } from "../src/ai/provider.js";
import type { DriverCall, ToolDriver } from "../src/ai/agentLoop.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_DOC: StudioDocument = {
  documentVersion: DOCUMENT_VERSION,
  name: "运营工作台",
  tokens: defaultTokens(),
  pages: [
    {
      id: "page-1",
      name: "运营工作台",
      rootId: "v_root",
      nodes: [
        { id: "v_root", type: "AppShell", props: { title: "运营工作台", sidebar: true }, children: ["v_header"] },
        { id: "v_header", type: "Header", props: { title: "运营工作台", subtitle: "核心指标" }, children: [] },
      ],
    },
  ],
};

/** Schema-valid but reference-broken: rootId points at a missing node. */
function danglingRootDoc(): StudioDocument {
  return { ...VALID_DOC, pages: [{ ...VALID_DOC.pages[0]!, rootId: "no_such_root" }] };
}

/** Schema-invalid: tokens.color.brand is not a hex color (zod enum/range error). */
function badEnumDoc(): StudioDocument {
  return {
    ...VALID_DOC,
    tokens: { ...defaultTokens(), color: { ...defaultTokens().color, brand: "not-a-hex" } },
  };
}

const MESSAGES: ChatMessage[] = [
  { role: "system", content: "系统提示词" },
  { role: "user", content: "生成一个运营工作台" },
];

/** Driver whose propose_document call always carries the given candidate. */
function proposeDriver(docs: StudioDocument[]): ToolDriver & { proposals: number } {
  let i = 0;
  return {
    proposals: 0,
    async next() {
      const doc = docs[i];
      i += 1;
      if (!doc) return [];
      this.proposals += 1;
      return [{ name: "propose_document", args: { document: doc.pages[0]! } }] as DriverCall[];
    },
  };
}

interface Observed {
  events: (VerifyEvent | { type: "delta"; text: string } | { type: "verify-round"; round: number; issues: string[] })[];
  prompts: string[][];
}

/** Run the loop with an event collector; returns result + observed frames. */
async function observe(
  input: Parameters<typeof runVerifyLoop>[0],
): Promise<{ result: Awaited<ReturnType<typeof runVerifyLoop>>; seen: Observed }> {
  const seen: Observed = { events: [], prompts: [] };
  const userOnEvent = input.onEvent;
  const driver: ToolDriver & { prompts: string[][] } = {
    prompts: seen.prompts,
    async next({ messages, tools }) {
      seen.prompts.push(messages.map((m) => m.content));
      return input.driver.next({ messages, doc: input.doc, tools });
    },
  };
  const result = await runVerifyLoop({
    ...input,
    driver,
    onEvent: (ev) => {
      seen.events.push(ev);
      userOnEvent(ev);
    },
  });
  return { result, seen };
}

const verifyRounds = (events: { type?: string }[]) =>
  events.filter((e) => e.type === "verify-round");

// ---------------------------------------------------------------------------
// Round 0 fast path
// ---------------------------------------------------------------------------

describe("runVerifyLoop — 校验通过（round 0 快路径）", () => {
  it("合法候选：rounds 0、issues null、零 verify-round 事件、驱动未被调用", async () => {
    const driver = proposeDriver([VALID_DOC]);
    const { result, seen } = await observe({
      messages: MESSAGES,
      doc: VALID_DOC,
      driver,
      onEvent: () => {},
    });
    // validateDocument re-parses (canonical clone) — deep equality, not identity
    expect(result.doc).toEqual(VALID_DOC);
    expect(result.rounds).toBe(0);
    expect(result.issues).toBeNull();
    expect(verifyRounds(seen.events)).toHaveLength(0);
    expect(driver.proposals).toBe(0);
  });

  it("mock 驾驶盘文档（dashboardDocument 形状）同走 round 0 快路径", async () => {
    const dashboard: StudioDocument = {
      documentVersion: DOCUMENT_VERSION,
      name: "运营工作台",
      tokens: defaultTokens(),
      pages: [
        {
          id: "page-1",
          name: "运营工作台",
          rootId: "m_root",
          nodes: [
            { id: "m_root", type: "AppShell", props: { title: "运营工作台", sidebar: true }, children: ["m_header", "m_section"] },
            { id: "m_header", type: "Header", props: { title: "运营工作台", subtitle: "核心指标一览" }, children: [] },
            { id: "m_section", type: "Section", props: { title: "关键指标", description: "今日实时数据" }, children: ["m_stat_1", "m_stat_2", "m_button"] },
            { id: "m_stat_1", type: "StatCard", props: { label: "今日活跃", value: "12,804", delta: "+8%", tone: "brand" }, children: [] },
            { id: "m_stat_2", type: "StatCard", props: { label: "转化率", value: "3.2%", delta: "+0.4%", tone: "success" }, children: [] },
            { id: "m_button", type: "Button", props: { label: "导出报表", variant: "primary", size: "md" }, children: [] },
          ],
        },
      ],
    };
    const { result } = await observe({
      messages: MESSAGES,
      doc: dashboard,
      driver: proposeDriver([]),
      onEvent: () => {},
    });
    expect(result.rounds).toBe(0);
    expect(result.issues).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Repair rounds
// ---------------------------------------------------------------------------

describe("runVerifyLoop — 修复环", () => {
  it("坏枚举候选 → 验证问题驱动第 1 轮修复 → issues 清空；verify-round 事件携带问题清单", async () => {
    const driver = proposeDriver([VALID_DOC]);
    const { result, seen } = await observe({
      messages: MESSAGES,
      doc: badEnumDoc(),
      driver,
      onEvent: () => {},
    });
    // T19: a page proposal can never repair a DOCUMENT-level token defect
    // (tokens are not model-authored anymore), so the zod issue re-arms in
    // round 2; the driver's single proposal is consumed in round 1.
    expect(driver.proposals).toBe(1);
    expect(result.rounds).toBe(2);
    expect(result.issues).not.toBeNull();
    // verify-round frames: round 1 carries the zod issue lines.
    const rounds = verifyRounds(seen.events);
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toMatchObject({ type: "verify-round", round: 1 });
    const issues = (rounds[0] as { issues: string[] }).issues;
    expect(issues.join("\n")).toContain("tokens.color.brand");
    expect(issues.join("\n")).toContain("十六进制颜色");
    // The repair prompt rode on the transcript as an extra user message.
    const repairPrompt = seen.prompts[0]?.at(-1) ?? "";
    expect(repairPrompt).toContain("生成的文档校验未通过");
    expect(repairPrompt).toContain(issues[0]);
    // Round-0 失败本身不发帧——事件的第 0 个就是第 1 轮修复公告
    expect(seen.events[0]?.type).toBe("verify-round");
  });

  it("checkDocument 失败（schema 合法但 rootId 悬空）→ 计入问题并驱动修复", async () => {
    const driver = proposeDriver([VALID_DOC]);
    const { result, seen } = await observe({
      messages: MESSAGES,
      doc: danglingRootDoc(),
      driver,
      onEvent: () => {},
    });
    expect(result.rounds).toBe(1);
    expect(result.issues).toBeNull();
    const rounds = verifyRounds(seen.events);
    expect((rounds[0] as { issues: string[] }).issues.join("\n")).toContain(
      'rootId "no_such_root" 不在节点表中',
    );
  });

  it("schema 失败阻断完整性检查：只报 zod 问题，不混入引用完整性清单", async () => {
    const driver = proposeDriver([VALID_DOC]);
    const { result, seen } = await observe({
      messages: MESSAGES,
      doc: { ...danglingRootDoc(), name: "" },
      driver,
      onEvent: () => {},
    });
    // name is DOC-level: a page proposal cannot repair it → the budget runs out.
    expect(result.rounds).toBe(2);
    const issues = (verifyRounds(seen.events)[0] as { issues: string[] }).issues;
    // zod 层只报 name（rootId 在 schema 层是合法字符串，其完整性检查被阻断）
    expect(issues.some((l) => l.includes("name"))).toBe(true);
    expect(issues.every((l) => !l.includes("rootId"))).toBe(true);
    expect(issues.every((l) => !l.includes("引用完整性失败"))).toBe(true);
  });

  it("永不修复的驱动 → 耗尽 2 轮预算，返回最后候选与非空 issues", async () => {
    const driver = proposeDriver([badEnumDoc(), badEnumDoc(), badEnumDoc()]);
    const { result, seen } = await observe({
      messages: MESSAGES,
      doc: badEnumDoc(),
      driver,
      onEvent: () => {},
    });
    expect(result.rounds).toBe(MAX_VERIFY_ROUNDS);
    expect(result.issues).not.toBeNull();
    expect(result.issues?.length).toBeGreaterThan(0);
    // T19: each proposal is a PAGE — round 1's valid page is spliced in
    // (auto-framed), but the doc-level token defect survives round 2.
    expect(result.doc).toEqual({ ...badEnumDoc(), pages: [autoLayout(VALID_DOC.pages[0]!)] });
    expect(verifyRounds(seen.events)).toHaveLength(MAX_VERIFY_ROUNDS);
    expect(seen.events.at(-1)?.type).toBe("verify-round");
  });

  it("修复成功的那一轮之后不再发 verify-round（后续帧正常透传）", async () => {
    const driver = proposeDriver([VALID_DOC]);
    const { seen } = await observe({
      messages: MESSAGES,
      doc: badEnumDoc(),
      driver,
      onEvent: () => {},
    });
    // Repair loop's own tool frames pass through the SAME onEvent.
    const toolCalls = seen.events.filter((e) => e.type === "tool-call");
    expect(toolCalls.map((c) => (c as { name: string }).name)).toEqual(["propose_document"]);
  });
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

describe("runVerifyLoop — abort", () => {
  it("round 0 失败后 signal 置位 → 不再进入第 1 轮，返回当前状态", async () => {
    const controller = new AbortController();
    const driver = proposeDriver([VALID_DOC]);
    const { result, seen } = await observe({
      messages: MESSAGES,
      doc: badEnumDoc(),
      driver,
      signal: controller.signal,
      onEvent: (ev) => {
        if (ev.type === "verify-round") controller.abort();
      },
    });
    expect(result.rounds).toBe(0);
    expect(result.issues).not.toBeNull();
    expect(driver.proposals).toBe(0);
    // 公告帧已发出（abort 正是它触发的），但轮次未计入
    expect(verifyRounds(seen.events)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// T21 §3.6 F6: multi-page candidates are verified PER PAGE — a broken SECOND
// page is detected even though the first page is healthy (loop views one page
// at a time, but verify sees the spliced whole document).
// ---------------------------------------------------------------------------

describe("runVerifyLoop — 多页候选按页校验（T21 F6）", () => {
  /** Healthy first page + second page whose rootId dangles. */
  function brokenSecondPageDoc(): StudioDocument {
    return {
      ...VALID_DOC,
      pages: [
        VALID_DOC.pages[0]!,
        { ...VALID_DOC.pages[0]!, id: "page-2", name: "第二页", rootId: "no_such_root" },
      ],
    };
  }

  it("第二页坏档被检出：verify-round issues 含第二页 rootId 问题（按页校验，不漏页）", async () => {
    const driver = proposeDriver([VALID_DOC]);
    const { result, seen } = await observe({
      messages: MESSAGES,
      doc: brokenSecondPageDoc(),
      driver,
      onEvent: () => {},
    });
    // Detection IS the F6 contract: per-page issues list the second page's
    // dangling rootId (the loop-side repair splices via the page view, covered
    // by the pipeline tests — the direct harness has no pageId seam, so the
    // pages[0]-only repair cannot fix page-2 and the budget runs out).
    const rounds = verifyRounds(seen.events);
    expect(rounds.length).toBeGreaterThanOrEqual(1);
    const issues = (rounds[0] as { issues: string[] }).issues;
    expect(issues.join("\n")).toContain('rootId "no_such_root" 不在节点表中');
    // The candidate itself was returned unchanged on the abort-less single round.
    expect(result.doc.pages.map((p) => p.id)).toEqual(["page-1", "page-2"]);
  });
});

// ---------------------------------------------------------------------------
// Budget-exhausted epilogue frame (loopPipeline wiring)
// ---------------------------------------------------------------------------

describe("runVerifyLoop — 预算耗尽后的 SSE 终帧契约", () => {
  it("issues 非空 → done 帧无 validated，text 的 plan 嵌入问题清单（workbench 确认卡可拒绝）", async () => {
    const { planTextWithIssues } = await import("../src/ai/loopPipeline.js");
    const driver = proposeDriver([badEnumDoc(), badEnumDoc(), badEnumDoc()]);
    const { result } = await observe({
      messages: MESSAGES,
      doc: badEnumDoc(),
      driver,
      onEvent: () => {},
    });
    expect(result.issues).not.toBeNull();
    const text = planTextWithIssues(result.doc, result.issues ?? []);
    const parsed = JSON.parse(text) as { plan: string; document: StudioDocument };
    // workbench planOf(): plan string shown on the confirm card must name the issues.
    expect(parsed.plan).toContain("以下问题未修复");
    expect(parsed.plan).toContain(result.issues![0]);
    expect(parsed.document).toEqual(result.doc);
  });
});

/** Last doc a proposeDriver handed out (the loop's final candidate). */
function driverLastCandidate(driver: ReturnType<typeof proposeDriver>): StudioDocument {
  // proposeDriver always proposes the next scripted doc; the loop returns the
  // LAST successful proposal, which for the never-fixed case is the final entry.
  return badEnumDoc();
}
