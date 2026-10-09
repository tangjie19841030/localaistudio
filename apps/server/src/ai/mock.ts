import { activePageOf, defaultTokens, type Page, type StudioDocument } from "@studio/schema-core";
import type {
  ChatMessage,
  ChatProvider,
  CompleteRequest,
  CompleteResult,
  DetectResult,
} from "./provider.js";
import type { DriverCall, ToolDriver } from "./agentLoop.js";

/** Extract "target:<id>" from the last user message; undefined when absent. */
function extractTargetId(text: string): string | undefined {
  return extractTargetIds(text)[0];
}

/** All "target:<id>" markers — canvas multi-select appends one per selected node. */
function extractTargetIds(text: string): string[] {
  return [...text.matchAll(/target:([A-Za-z0-9_-]+)/g)].map((m) => m[1]!);
}

/**
 * Spatial marker (P5-4 E2E seam): "move:<id>:<x>,<y>" or "resize:<id>:<w>,<h>".
 * Numbers accept decimals; ids follow the same charset as target:<id>.
 */
const SPATIAL_RE = /(move|resize):([A-Za-z0-9_-]+):(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;

function extractSpatial(text: string): { kind: "move" | "resize"; id: string; a: number; b: number } | undefined {
  const match = text.match(SPATIAL_RE);
  if (!match) return undefined;
  return { kind: match[1] === "move" ? "move" : "resize", id: match[2]!, a: Number(match[3]), b: Number(match[4]) };
}

function lastUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "user") return message.content;
  }
  return "";
}

/** Total image attachments in the conversation — echoed back so E2E can assert delivery. */
function imageCount(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + (m.images?.length ?? 0), 0);
}

/**
 * Multimodal echo suffix. Empty when no images arrived, so every existing
 * text-only response stays byte-identical.
 */
function imageNote(count: number): string {
  return count > 0 ? `（收到 ${count} 张截图）` : "";
}

/** Deterministic dashboard document: AppShell root + Header + Section(StatCard×2 + Button). */
function dashboardPage(): Page {
  return {
    id: "page-1",
    name: "运营工作台",
    rootId: "m_root",
    nodes: [
      {
        id: "m_root",
        type: "AppShell",
        props: { title: "运营工作台", sidebar: true },
        children: ["m_header", "m_section"],
      },
      {
        id: "m_header",
        type: "Header",
        props: { title: "运营工作台", subtitle: "核心指标一览" },
        children: [],
      },
      {
        id: "m_section",
        type: "Section",
        props: { title: "关键指标", description: "今日实时数据" },
        children: ["m_stat_1", "m_stat_2", "m_button"],
      },
      {
        id: "m_stat_1",
        type: "StatCard",
        props: { label: "今日活跃", value: "12,804", delta: "+8%", tone: "brand" },
        children: [],
      },
      {
        id: "m_stat_2",
        type: "StatCard",
        props: { label: "转化率", value: "3.2%", delta: "+0.4%", tone: "success" },
        children: [],
      },
      {
        id: "m_button",
        type: "Button",
        props: { label: "导出报表", variant: "primary", size: "md" },
        children: [],
      },
    ],
  };
}

/** Wrap the deterministic page into a single-page v2 document. */
function dashboardDocument(): StudioDocument {
  return {
    documentVersion: 2,
    name: "运营工作台",
    tokens: defaultTokens(),
    pages: [dashboardPage()],
  };
}

/** Full-generation response: { plan, document } (spec §5.2 first-stage output). */
function generationResponse(note: string): string {
  return JSON.stringify({
    plan: `规划：以 AppShell 为根，Header 承载标题，Section 组织两块 StatCard 指标卡与一个主操作按钮。${note}`,
    document: dashboardDocument(),
  });
}

/** Patch response; target id comes from the "target:<id>" marker in the user message. */
function patchResponse(text: string, note: string): string {
  const id = extractTargetId(text) ?? "m_stat_1";
  return JSON.stringify({
    plan: `规划：仅更新所选节点的展示样式，不改动其他节点。${note}`,
    ops: [{ op: "node.update", id, props: { label: "更新后的指标", tone: "warning" } }],
  });
}

/** Patch response that targets a node outside the allowed scope (scope-guard test path). */
function outOfScopeResponse(note: string): string {
  return JSON.stringify({
    plan: `规划：越界演示——试图更新未被授权的节点。${note}`,
    ops: [
      { op: "node.update", id: "m_outside_node", props: { label: "越界节点" } },
      { op: "node.remove", id: "another_outside_node" },
    ],
  });
}

/** Marker for the badjson path: non-JSON text (E2E p2 asserts the invalid_json error frame). */
function badjsonResponse(note: string): string {
  return `抱歉，模型这次没有返回有效的 JSON，请重试。（badjson 演示文本）${note}`;
}

/**
 * Locate the last StudioDocument embedded in a JSON text frame inside a system
 * message (buildSystemPrompt puts the current doc there). Returns undefined
 * when the model context carries no parseable document — the spatial markers
 * then fall back to default geometry (w/h 240x120, x/y 0,0).
 */
function docFromContext(messages: ChatMessage[]): StudioDocument | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "system") continue;
    // Prompt line shape: 当前文档（…）：{json} — fullwidth colon, plain-text prefix.
    const match = message.content.match(/当前文档[^{]*：(\{.*\})/);
    if (!match?.[1]) continue;
    try {
      return JSON.parse(match[1]) as StudioDocument;
    } catch {
      continue; // corrupted doc JSON: keep scanning, then fall back to defaults
    }
  }
  return undefined;
}

/** Spatial frame args preserving the untouched axis (P5-4 geometry-preservation contract). */
function spatialFrame(
  spatial: { kind: "move" | "resize"; id: string; a: number; b: number },
  messages: ChatMessage[],
  pageId: string | null,
): { x: number; y: number; w: number; h: number; rotation: number } {
  const existing = activePageOf(docFromContext(messages) ?? dashboardDocument(), pageId).nodes.find((n) => n.id === spatial.id)?.frame;
  return spatial.kind === "move"
    ? { x: spatial.a, y: spatial.b, w: existing?.w ?? 240, h: existing?.h ?? 120, rotation: existing?.rotation ?? 0 }
    : { x: existing?.x ?? 0, y: existing?.y ?? 0, w: spatial.a, h: spatial.b, rotation: existing?.rotation ?? 0 };
}

/** Scripted selection over the last user message's markers (deterministic, no network). */
function scriptedReply(messages: ChatMessage[]): string {
  const text = lastUserMessage(messages);
  const note = imageNote(imageCount(messages));
  const spatial = extractSpatial(text);
  if (spatial) return JSON.stringify({
    plan: `规划：仅调整所选节点的画布位置与尺寸，不改动其他节点。${note}`,
    ops: [{ op: "setFrame", nodeId: spatial.id, frame: spatialFrame(spatial, messages, null) }],
  });
  const targetId = extractTargetId(text);
  // Same rule as markerScript: a target: marker means scoped patch, wording aside.
  const wantsPatch = targetId !== undefined || /修改|patch/i.test(text);
  if (!wantsPatch) return generationResponse(note);
  if (/badjson/i.test(text)) return badjsonResponse(note);
  if (/违规|violation/i.test(text)) return outOfScopeResponse(note);
  return patchResponse(text, note);
}

/**
 * Marker→tool-call mapping (P6-2). One marker class = one deterministic batch;
 * the batch executes through the SAME StudioTool pipeline as real models, so
 * mock and live traffic share scope gates, zod errors, and doc accumulation.
 *
 * `doc` is the loop's current document. Target nodes that do not exist in it
 * are ensured as minimal StatCard/Section children of the root FIRST (marker
 * seam: the legacy text path never executed ops, so its mock ids need not
 * exist; the tool pipeline requires real nodes). Ensuring preserves the
 * legacy observable contract: the resulting op still names the marker's id.
 */
/** spatialScript: move:/resize: → one set_frame call on the marker's node. */
function spatialScript(
  doc: StudioDocument,
  spatial: { kind: "move" | "resize"; id: string; a: number; b: number },
  messages: ChatMessage[],
  pageId: string | null,
): DriverCall[] {
  return ensureMarkerNodes(doc, pageId, [spatial.id], [
    { name: "set_frame", args: { nodeId: spatial.id, frame: spatialFrame(spatial, messages, pageId) } },
  ]);
}

/** patchScript: target:/violation/badjson branches → update_props / badjson calls. */
function patchScript(doc: StudioDocument, pageId: string | null, text: string, note: string): DriverCall[] {
  if (/badjson/i.test(text)) {
    // badjson keeps its non-JSON semantics: an unroutable "tool" the loop
    // reports as 未知工具 — the loop's failure path carries the raw text.
    return [{ name: "badjson", args: { raw: badjsonResponse(note) } }];
  }
  if (/违规|violation/i.test(text)) {
    // Violation demo: update a node OUTSIDE the allowed scope; the tool's scope
    // gate answers with 节点 <id> 超出修改范围 (loop-visible failure).
    return ensureMarkerNodes(doc, pageId, ["m_outside_node"], [
      { name: "update_props", args: { nodeId: "m_outside_node", props: { label: "越界节点" } } },
    ]);
  }
  // Multi-select appends one target: marker per node — update EACH of them so
  // the scripted result reflects the full selection scope.
  const targets = extractTargetIds(text);
  if (targets.length === 0) targets.push("m_stat_1");
  return ensureMarkerNodes(
    doc,
    pageId,
    targets,
    targets.map((id) => ({ name: "update_props", args: { nodeId: id, props: { label: "更新后的指标", tone: "warning" } } })),
  );
}

function markerScript(doc: StudioDocument, pageId: string | null, messages: ChatMessage[]): { calls: DriverCall[] } {
  const text = lastUserMessage(messages);
  const note = imageNote(imageCount(messages));
  const spatial = extractSpatial(text);
  if (spatial) return { calls: spatialScript(doc, spatial, messages, pageId) };
  // A target: marker IS the selection-scoped patch signal — the workbench appends
  // it whenever a node is selected, regardless of wording. Keyword matching alone
  // misrouted natural phrasings like「只改这个区块的间距」into whole-doc generation,
  // which the loop's patch-scope guard then rejects.
  const targetId = extractTargetId(text);
  const wantsPatch = targetId !== undefined || /修改|patch/i.test(text);
  if (!wantsPatch) {
    // Generate mode: whole-doc proposal via the propose_document tool. The tool
    // validates + returns the SAME dashboard doc the legacy JSON carried.
    return { calls: [{ name: "propose_document", args: { document: dashboardPage() } }] };
  }
  return { calls: patchScript(doc, pageId, text, note) };
}

/**
 * Prepend insert_node calls for marker targets missing from the loop doc.
 * `__markerId` pins the node id (the loop resolves it before execution) so
 * later set_frame/update_props steps in the SAME batch find the node.
 * StatCard default for unknown ids (the legacy mock's StatCard context);
 * "sec-*" ids get a Section (P5-4 tests move Section nodes).
 */
function ensureMarkerNodes(
  doc: StudioDocument,
  pageId: string | null,
  ids: string[],
  script: DriverCall[],
): DriverCall[] {
  const active = activePageOf(doc, pageId);
  const existing = new Set(active.nodes.map((n) => n.id));
  const calls: DriverCall[] = [];
  for (const id of ids) {
    if (existing.has(id)) continue;
    const isSection = /^sec-/.test(id);
    calls.push({
      name: "insert_node",
      args: {
        __markerId: id,
        type: isSection ? "Section" : "StatCard",
        parentId: active.rootId,
        props: isSection ? { title: id } : { label: id },
      },
    });
    existing.add(id);
  }
  return [...calls, ...script];
}

/**
 * Deterministic mock driver (P6-2): the marker protocol expressed as tool calls.
 * The first next() returns the marker's batch; every later call returns [] so
 * the loop ends finished:true after one scripted step.
 */
export function createMockDriver(): ToolDriver {
  let round = 0;
  return {
    async next(input) {
      round += 1;
      return round === 1 ? markerScript(input.doc, input.pageId ?? null, input.messages).calls : [];
    },
  };
}

/** Split into 5 segments to emulate a token stream for the frontend renderer. */
function segment(text: string): string[] {
  const size = Math.ceil(text.length / 5);
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    parts.push(text.slice(i, i + size));
  }
  return parts;
}

export function createMockProvider(): ChatProvider {
  return {
    supportsImages: true,
    async detect(): Promise<DetectResult> {
      return { id: "mock", available: true, detail: "内置脚本化响应" };
    },
    async complete(req: CompleteRequest): Promise<CompleteResult> {
      const text = scriptedReply(req.messages);
      if (req.onDelta) {
        for (const part of segment(text)) req.onDelta(part);
      }
      return { text };
    },
  };
}
