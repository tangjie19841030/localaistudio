import {
  checkStudioDocument,
  defaultTokens,
  listComponentDefs,
  newNodeId,
  validateDocument,
} from "@studio/schema-core";
import type { Page, StudioDocument, Tokens } from "@studio/schema-core";
import { randomUUID } from "node:crypto";
import type { ChatProvider } from "./provider.js";

/**
 * W2-A image -> Schema converter (T48). One screenshot / hand-drawn wireframe is
 * sent to the CURRENT provider (vision dual-track: local Qwen-VL through ollama,
 * or an openai-compat vision model) together with the component catalog and the
 * hard output contract; the reply goes through the single acceptance funnel
 * (validateDocument). One image = one Page; pages are then assembled into a v2
 * document whose ids are fresh, so they stay unique across pages.
 *
 * flattenNestedChildren / withDefaultTokens below are deliberate EQUIVALENT
 * COPIES of templates/converter.ts (which does not export them). Source of truth
 * stays apps/server/src/templates/converter.ts — that file belongs to the
 * template pipeline and is not touched here (design OP-2).
 */

/** How many model rounds one image gets: the first call plus 2 retries. */
export const MAX_ATTEMPTS = 3;

export type ImportMode = "screenshot" | "wireframe";

/** One successfully converted image: its page plus the tokens it proposed. */
export interface ConvertedPage {
  page: Page;
  tokens: Tokens;
}

export type ImageConvertOutcome =
  | { ok: true; converted: ConvertedPage }
  | { ok: false; errors: string };

/** Catalog with per-component prop intent, so the model maps semantics not names. */
function catalogPrompt(): string {
  const lines = listComponentDefs().map((d) => {
    const container = d.container ? "（容器，可含子节点）" : "";
    return `- ${d.type}（${d.title}）${container}`;
  });
  return lines.join("\n");
}

const SYSTEM_PROMPT = `你是本地 UI 工作台的截图导入转换器。你的任务：把一张界面截图（或手绘线框图）翻译成一个符合我们 Schema 的 JSON 文档——不是逐像素临摹，而是用我们注册表里的组件重建它的信息结构、层级与视觉意图。

可用组件目录：
__CATALOG__

约束（必须全部满足）：
1. 输出必须是单个 JSON 对象（不要 markdown 围栏，不要注释），结构：
   {"name":"页面名","tokens":{...},"rootId":"root","nodes":[...]}
   - tokens 的精确形状（缺一项都会被拒）：{"color":{"brand":"#RRGGBB","surface":"#RRGGBB","text":"#RRGGBB","muted":"#RRGGBB","border":"#RRGGBB","accent":"#RRGGBB","success":"#RRGGBB","warning":"#RRGGBB","danger":"#RRGGBB"},"radius":{"card":12,"control":8},"spacing":{"unit":4},"font":{"sans":"Inter, 'Segoe UI', system-ui, sans-serif"}}
   - 第一个节点是根容器（AppShell 或 Container），id 必须是 "root"；所有节点 id 唯一、与父链一致。
   - 每个节点的 children 数组只能包含其他节点的 id 字符串（如 "children":["header","table"]），绝不允许嵌套节点对象或 null。
2. 只能使用目录中的组件类型；每个节点的 props 只含该组件真实支持的有效字段。
3. 忠实还原截图里看得见的文案、数字、字段名与层级；看不清的文字不要编造长段落。
4. 布局只用 Section/Grid/Stack/Container/Card 等结构组件；不要输出 frame，不做绝对定位。
5. 界面文案保持中文；品牌名、数字与代码标识原样保留。
6. 只转换这一张图，输出单页结构（rootId + nodes），不要输出 pages 数组。`;

/** Mode-specific paragraph appended to the base contract. */
const MODE_HINTS: Record<ImportMode, string> = {
  screenshot:
    "输入是真实界面截图：优先还原可见的信息层级、分区、表格/表单字段与按钮文案，配色取截图里的主色作为 brand。",
  wireframe:
    "输入是手绘草图或线框图：线条与方框只表达结构，请按方框内的标注文字与相对位置推断组件语义（列表=Table、输入框=Input、按钮=Button）。",
};

function systemPromptFor(mode: ImportMode): string {
  return `${SYSTEM_PROMPT.replace("__CATALOG__", catalogPrompt())}\n\n${MODE_HINTS[mode]}`;
}

/** Per-image user prompt: index/total + mode hint + optional style hint + retry feedback. */
function buildUserPrompt(input: {
  index: number;
  total: number;
  mode: ImportMode;
  styleHint?: string;
  retryHint?: string;
}): string {
  const lines = [`这是第 ${input.index + 1} 张图片（共 ${input.total} 张），只转换这一张。`];
  if (input.styleHint) lines.push(`补充要求：${input.styleHint}`);
  if (input.retryHint) {
    lines.push(`上一次转换未通过校验，错误如下，请修正后重试：\n${input.retryHint}`);
  }
  return lines.join("\n\n");
}

/**
 * Deterministic flattening of a common model deviation: node objects (or null)
 * inside a children array. The schema requires child id strings; when the model
 * embeds `{id:"x",...}` we keep the embedded object in `nodes` (if not already
 * present) and replace the entry with its id. Nulls are dropped. Everything
 * else passes through untouched.
 */
function flattenNestedChildren(parsed: unknown): unknown {
  if (typeof parsed !== "object" || parsed === null) return parsed;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.nodes)) return parsed;
  const nodes = (obj.nodes as Record<string, unknown>[]).filter(
    (n) => typeof n === "object" && n !== null,
  );
  const knownIds = new Set(nodes.map((n) => n.id).filter((v) => typeof v === "string"));
  const addEmbedded = (embedded: Record<string, unknown>): void => {
    if (typeof embedded.id !== "string") return;
    if (knownIds.has(embedded.id)) return;
    nodes.push(embedded);
    knownIds.add(embedded.id);
    // The embedded subtree may itself carry nested children — walk it too.
    if (Array.isArray(embedded.children)) walkChildren(embedded);
  };
  const walkChildren = (parent: Record<string, unknown>): void => {
    if (!Array.isArray(parent.children)) return;
    const fixed: unknown[] = [];
    for (const child of parent.children) {
      if (typeof child === "object" && child !== null) {
        addEmbedded(child as Record<string, unknown>);
        if (typeof (child as Record<string, unknown>).id === "string") {
          fixed.push((child as Record<string, unknown>).id);
        }
      } else if (typeof child === "string") {
        fixed.push(child);
      }
      // null / primitives other than strings are dropped
    }
    parent.children = fixed;
  };
  for (const n of nodes) walkChildren(n);
  return { ...obj, nodes };
}

/**
 * Merge model output tokens with schema defaults (shallow per token group) so a
 * missing `font`/`radius`/`spacing` group or single color no longer discards an
 * otherwise-valid conversion. Model-provided values always win.
 */
function withDefaultTokens(parsed: unknown): unknown {
  if (typeof parsed !== "object" || parsed === null) return parsed;
  const obj = parsed as Record<string, unknown>;
  // The model may emit the LEGACY v1 shape (documentVersion 1 + flat node
  // table); validateDocument's migrate funnel upcasts v1 -> v2, so drop the
  // version literal ONLY on v1-shaped input (no pages) and let the acceptance
  // funnel own the version axis. Already-v2 output passes through untouched.
  if (!("pages" in obj)) delete obj.documentVersion;
  if (obj.tokens === undefined) return { ...obj, tokens: defaultTokens() };
  if (typeof obj.tokens !== "object" || obj.tokens === null) return parsed;
  const defaults = defaultTokens() as unknown as Record<string, unknown>;
  const given = obj.tokens as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...defaults };
  for (const group of ["color", "radius", "spacing", "font"] as const) {
    if (typeof given[group] === "object" && given[group] !== null) {
      merged[group] = { ...(defaults[group] as object), ...(given[group] as object) };
    }
  }
  return { ...obj, tokens: merged };
}

/** Fresh page id, mirroring schema-core pageOps' "p_<8 chars>" shape. */
function freshPageId(): string {
  return `p_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/**
 * Give one converted page brand-new ids (page id + every node id). Node ids are
 * globally unique across pages in v2 (checkStudioDocument), but every image is
 * converted in isolation and therefore starts from "root"/"h"/... — without
 * this remap a 4-image import would produce duplicate ids.
 */
function remapIds(page: Page): Page {
  const remap = new Map<string, string>();
  for (const node of page.nodes) remap.set(node.id, newNodeId());
  const nodes = page.nodes.map((node) => ({
    ...node,
    id: remap.get(node.id) ?? node.id,
    children: node.children.map((child) => remap.get(child) ?? child),
  }));
  return {
    id: freshPageId(),
    name: page.name,
    rootId: remap.get(page.rootId) ?? page.rootId,
    nodes,
  };
}

/** Strip code fences, then JSON.parse; both failures carry a retry-feedable text. */
function parseJsonReply(text: string): { ok: true; value: unknown } | { ok: false; errors: string } {
  const jsonText = text.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "").trim();
  if (jsonText === "") return { ok: false, errors: "模型返回了空内容" };
  try {
    return { ok: true, value: JSON.parse(jsonText) };
  } catch (err) {
    return { ok: false, errors: `输出不是合法 JSON：${(err as Error).message}` };
  }
}

/**
 * One model round for one image. Provider exceptions are folded into the retry
 * budget instead of escaping (the route must never answer a bare 500).
 */
async function attemptText(
  provider: ChatProvider,
  image: string,
  opts: { index: number; total: number; mode: ImportMode; styleHint?: string },
  retryHint: string | undefined,
): Promise<{ ok: true; text: string } | { ok: false; errors: string }> {
  try {
    const result = await provider.complete({
      messages: [
        { role: "system", content: systemPromptFor(opts.mode) },
        {
          role: "user",
          content: buildUserPrompt({ ...opts, retryHint }),
          images: [image],
        },
      ],
    });
    return { ok: true, text: (result.text ?? "").trim() };
  } catch (err) {
    return { ok: false, errors: `模型调用失败：${(err as Error).message}` };
  }
}

/**
 * Convert ONE image to a validated, freshly-id'd page. Up to MAX_ATTEMPTS
 * rounds; the zod/JSON error text is fed back into the next round.
 */
export async function convertImagePage(
  provider: ChatProvider,
  image: string,
  opts: { index: number; total: number; mode: ImportMode; styleHint?: string },
): Promise<ImageConvertOutcome> {
  let hint: string | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const reply = await attemptText(provider, image, opts, hint);
    if (!reply.ok) {
      hint = reply.errors;
      continue;
    }
    const parsed = parseJsonReply(reply.text);
    if (!parsed.ok) {
      hint = parsed.errors;
      continue;
    }
    try {
      const doc = validateDocument(withDefaultTokens(flattenNestedChildren(parsed.value)));
      // One image = one page; a model that still answers with a multi-page v2
      // document contributes its first page only (contract §4.1).
      const page = doc.pages[0];
      if (!page) {
        hint = "模型没有输出任何页面";
        continue;
      }
      return { ok: true, converted: { page: remapIds(page), tokens: doc.tokens } };
    } catch (err) {
      hint = (err as Error).message;
    }
  }
  return { ok: false, errors: hint ?? "转换失败" };
}

/** Page name: the model's own name when it gave one, else "<projectName> <n>". */
function pageNameOf(page: Page, projectName: string, index: number): string {
  const modelName = page.name.trim();
  return (modelName === "" ? `${projectName} ${index + 1}` : modelName).slice(0, 80);
}

/**
 * Assemble converted pages into the v2 response document: page order follows the
 * image order, nothing is reordered or merged, tokens come from the first
 * converted image (a single import keeps one shared palette). The result is
 * re-run through validateDocument + checkStudioDocument — the same acceptance
 * funnel the rest of the codebase uses, never a second migration site.
 */
export function assembleDocument(converted: ConvertedPage[], name: string): StudioDocument {
  if (converted.length === 0) throw new Error("没有可组装的页面");
  const pages = converted.map((item, i) => ({ ...item.page, name: pageNameOf(item.page, name, i) }));
  const candidate: StudioDocument = {
    documentVersion: 2,
    name: name.slice(0, 80) || "导入页面",
    tokens: converted[0]!.tokens,
    pages,
  };
  const document = validateDocument(candidate);
  const errors = checkStudioDocument(document);
  if (errors.length > 0) {
    throw new Error(`组装后的文档不满足不变量：${errors.join("; ")}`);
  }
  return document;
}
