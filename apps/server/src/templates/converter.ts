import { defaultTokens, listComponentDefs, validateDocument } from "@studio/schema-core";
import type { ChatProvider } from "../ai/provider.js";

/**
 * External → Schema converter (route A): a shadcn-style page bundle is sent to
 * the configured model with our component catalog + hard output contract; the
 * model returns a PageDocument JSON which we zod-validate. Failures are fed
 * back ONCE for a retry, then rejected (never silently accept a bad doc).
 */

/** Catalog with per-component prop intent, so the model maps semantics not names. */
function catalogPrompt(): string {
  const lines = listComponentDefs().map((d) => {
    const container = d.container ? "（容器，可含子节点）" : "";
    return `- ${d.type}（${d.title}）${container}`;
  });
  return lines.join("\n");
}

const SYSTEM_PROMPT = `你是本地 UI 工作台的外部模板转换器。你的任务：把给定的开源页面源码（React/Tailwind）翻译成一个符合我们 Schema 的 JSON 文档——不是逐行转译 JSX，而是保留页面的信息结构与视觉意图，用我们注册表里的组件重建它。

可用组件目录：
__CATALOG__

约束（必须全部满足）：
1. 输出必须是单个 JSON 对象（不要 markdown 围栏，不要注释），结构：
   {"name":"页面名","tokens":{...},"rootId":"root","nodes":[...]}
   - tokens 的精确形状（缺一项都会被拒）：{"color":{"brand":"#RRGGBB","surface":"#RRGGBB","text":"#RRGGBB","muted":"#RRGGBB","border":"#RRGGBB","accent":"#RRGGBB","success":"#RRGGBB","warning":"#RRGGBB","danger":"#RRGGBB"},"radius":{"card":12,"control":8},"spacing":{"unit":4},"font":{"sans":"Inter, 'Segoe UI', system-ui, sans-serif"}}
   - 第一个节点是根容器（AppShell 或 Container），id 必须是 "root"；所有节点 id 唯一、与父链一致。
   - 每个节点的 children 数组只能包含其他节点的 id 字符串（如 "children":["header","table"]），绝不允许嵌套节点对象或 null。
2. 只能使用目录中的组件类型；每个节点的 props 只含该组件真实支持的有效字段，文案用你能从源码提取的原意（如登录页标题、指标数值、表格行、表单字段名）。
3. 布局只允许：Section（标题区块）、Grid/Stack/Container（容器）、Card（卡片）、MetricGrid+StatCard（指标）、Table（含 columns/rows 数据）、Form+FormField+Input/Select/Checkbox/Textarea/Button（表单）、Header/Heading/Text（文本）、Badge/Alert/Timeline/List/KeyValList/Pagination/Steps（信息组件）、Hero/FeatureGrid/PricingCard/Testimonial/StatsBanner/Footer（营销）、BarChart/LineChart/DonutChart/Sparkline（图表）。
4. 不做绝对定位；不要输出 frame。
5. 转英文界面为中文文案（保留数字/品牌名），保持原信息的数量与类型。`;

function buildUserPrompt(sourceId: string, bundle: string, retryHint?: string): string {
  const retry = retryHint ? `\n\n上一次转换未通过校验，错误如下，请修正后重试：\n${retryHint}` : "";
  return `页面源码 id：${sourceId}\n\n${bundle.slice(0, 24_000)}${retry}`;
}

/** One conversion attempt → validated document or error text. */
export type ConvertOutcome =
  | { ok: true; document: ReturnType<typeof validateDocument> }
  | { ok: false; errors: string };

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
    if (knownIds.has(embedded.id as string)) return;
    nodes.push(embedded);
    knownIds.add(embedded.id as string);
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
  // T19: the model emits the LEGACY v1 shape (documentVersion 1 + flat node
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

/**
 * Convert a page bundle to a validated PageDocument.
 * One retry on validation failure (model self-corrects from the zod errors).
 */
export async function convertBlock(
  provider: ChatProvider,
  sourceId: string,
  bundle: string,
  opts?: { retries?: number },
): Promise<ConvertOutcome> {
  const retries = opts?.retries ?? 1;
  let hint: string | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await provider.complete({
      messages: [
        { role: "system", content: SYSTEM_PROMPT.replace("__CATALOG__", catalogPrompt()) },
        { role: "user", content: buildUserPrompt(sourceId, bundle, hint) },
      ],
    });
    const trimmed = (result.text ?? "").trim();
    // Strip accidental code fences the model may wrap around the JSON.
    const jsonText = trimmed.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      hint = `输出不是合法 JSON：${(err as Error).message}`;
      continue;
    }
    try {
      const doc = validateDocument(withDefaultTokens(flattenNestedChildren(parsed)));
      return { ok: true, document: doc };
    } catch (err) {
      hint = (err as Error).message;
      continue;
    }
  }
  return { ok: false, errors: hint ?? "转换失败" };
}