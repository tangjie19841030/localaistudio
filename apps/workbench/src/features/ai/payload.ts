import { patchOpSchema, validateDocument, type StudioDocument, type PatchOp } from "@studio/schema-core";
import type { ChatCompletionMessage } from "../../api/client";
import type { ChatLogMessage, PendingPlan, ToolTraceStep } from "./types";
import { type ToolkitCommand } from "./types";
import { withReset } from "./events";

/** Error-bubble truncation budget: same cap as formatStreamError's raw branch. */
const ERROR_TEXT_LIMIT = 300;

/**
 * Build the outbound chat history for /api/chat/completions.
 * - activity timeline cards are UI-only (never model context)
 * - empty assistant placeholders (failed/canceled turns) are dropped —
 *   the server schema requires content.length >= 1 (API 400 invalid_body)
 */
export function outboundChatMessages(
  messages: ChatLogMessage[],
): ChatCompletionMessage[] {
  return messages
    .filter((m) => m.kind !== "activity")
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.text }));
}

/**
 * Attach this turn's images to the LAST outbound message (the just-added user
 * turn). Returns the list unchanged when there are no images, so text-only
 * requests keep their exact previous body shape.
 */
export function attachImages(
  messages: ChatCompletionMessage[],
  images: string[] | undefined,
): ChatCompletionMessage[] {
  if (!images?.length || messages.length === 0) return messages;
  return messages.map((m, i) => (i === messages.length - 1 ? { ...m, images } : m));
}

/** Truncate long error payloads so a raw model dump cannot flood the bubble. */
function truncateErrorText(text: string): string {
  return text.length > ERROR_TEXT_LIMIT ? `${text.slice(0, ERROR_TEXT_LIMIT)}…` : text;
}

/**
 * Deep-validate a patch payload {plan, ops} with patchOpSchema (the discriminated
 * union itself; no zod import here — workbench has no direct zod dependency).
 * Returns null on any structural or schema failure.
 */
export function parsePatchPayload(
  text: string,
): { plan: string; ops: PatchOp[] } | null {
  let parsed: { plan?: unknown; ops?: unknown };
  try {
    parsed = JSON.parse(text) as { plan?: unknown; ops?: unknown };
  } catch {
    return null;
  }
  if (typeof parsed.plan !== "string" || !Array.isArray(parsed.ops)) return null;
  const ops: PatchOp[] = [];
  for (const op of parsed.ops) {
    const checked = patchOpSchema.safeParse(op);
    if (!checked.success) return null;
    ops.push(checked.data);
  }
  return { plan: parsed.plan, ops };
}

/**
 * Deep-validate a done frame's toolkit commands array (frozen P7.3 contract).
 * Returns null on any structural failure; an empty array stays valid (the
 * caller turns it into a neutral notice).
 */
export function parseToolkitCommands(value: unknown): ToolkitCommand[] | null {
  if (!Array.isArray(value)) return null;
  const commands: ToolkitCommand[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const c = item as Record<string, unknown>;
    if (
      typeof c.invocationId !== "string" ||
      typeof c.commandId !== "string" ||
      typeof c.title !== "string" ||
      (c.riskLevel !== "low" && c.riskLevel !== "medium" && c.riskLevel !== "high")
    ) {
      return null;
    }
    commands.push({
      invocationId: c.invocationId,
      commandId: c.commandId,
      title: c.title,
      riskLevel: c.riskLevel,
      args: c.args,
      ...(typeof c.summary === "string" ? { summary: c.summary } : {}),
    });
  }
  return commands;
}

/** Human-readable chat line for a finished turn (never raw document JSON). */
export function readableDoneText(ev: { text: string; validated?: string }): string {
  try {
    const parsed = JSON.parse(ev.text) as { plan?: unknown; ops?: unknown; document?: unknown };
    if (typeof parsed.plan === "string" && parsed.plan.trim() !== "") {
      const opCount = Array.isArray(parsed.ops) ? parsed.ops.length : undefined;
      return opCount !== undefined ? `${parsed.plan}（${opCount} 个变更操作）` : parsed.plan;
    }
    // Payload without a plan (or empty plan): never dump document/ops into chat.
    if (parsed.document !== undefined) return "文档已生成，请在确认卡中查看变更。";
    if (Array.isArray(parsed.ops)) return "变更计划已就绪，请在确认卡中确认。";
  } catch {
    // not JSON — fall through to truncation
  }
  if (ev.text.length > 400) {
    return `${ev.text.slice(0, 200)}…（已截断，共 ${ev.text.length} 字）`;
  }
  return ev.text;
}

/** Extract the plan line for the confirm card; falls back to a hint on dumps. */
export function planOf(text: string): string {
  try {
    const parsed = JSON.parse(text) as { plan?: unknown };
    if (typeof parsed.plan === "string" && parsed.plan.trim() !== "") return parsed.plan;
  } catch {
    // not JSON
  }
  if (text.length > 200) return "（变更计划见确认卡）";
  return text;
}

/** SSE error frame → one-line message (violations + truncated raw appendix). */
export function formatStreamError(ev: { error: string; raw?: string; violations?: string[] }): string {
  const parts = [ev.error];
  if (ev.violations?.length) parts.push(ev.violations.join("；"));
  if (ev.raw) {
    const raw = ev.raw.length > 300 ? `${ev.raw.slice(0, 200)}…` : ev.raw;
    parts.push(`原始响应：${raw}`);
  }
  return parts.join(" ");
}

/** Truncate done-payload error text to the error-bubble budget. */
export function toBubbleError(prefix: string, text: string): string {
  return `${prefix}：${truncateErrorText(text)}`;
}

/** Neutral-terminal notices (empty change set) — not a service failure. */
const EMPTY_OPS_NOTICE = "AI 认为无需修改（未产生变更操作）。试试选中具体节点后重试，或换一种描述方式。";
/** Toolkit counterpart: the model finished without producing any command. */
const TOOLKIT_EMPTY_NOTICE = "AI 认为无需修改（未产生变更命令）。调整描述或选择后重试。";

/**
 * T61 W3-B: validate each done-frame alternative through the schema-core funnel;
 * a broken candidate is dropped (contract §2.6) and never fails the whole turn.
 * Non-array / all-invalid input yields undefined (no alternatives on the plan).
 */
function parseAlternatives(value: unknown): StudioDocument[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const alts: StudioDocument[] = [];
  for (const item of value) {
    try {
      alts.push(validateDocument(item));
    } catch {
      // Bad candidate: drop it, keep the rest.
    }
  }
  return alts.length > 0 ? alts : undefined;
}

/**
 * Reduce a done event by request mode (payload contract differs, spec §5.2);
 * returns the zustand state patch for set() — a terminal phase plus its data.
 * Empty ops ({plan, ops:[]}) is a distinct outcome — the model decided nothing
 * needed changing (real-model flow finding) — and gets its own notice instead
 * of a schema-failure error or an empty confirm card.
 */
export function finalizeDone(
  ev: {
    done: true;
    text: string;
    validated?: "document";
    document?: unknown;
    alternatives?: unknown;
    commands?: unknown;
    partial?: boolean;
  },
  mode: "plan" | "generate" | "patch",
  toolTrace: ToolTraceStep[],
  violations: string[] | null,
  toAwaitingConfirm: (plan: PendingPlan, violations: string[] | null) => Record<string, unknown>,
  toError: (message: string) => Record<string, unknown>,
  toNotice: (message: string) => Record<string, unknown>,
): Record<string, unknown> {
  // Progressive batches (P7.3): partial:true frames are AUTO-APPLIED by the
  // caller (aiStore) — here we only mark the plan so it never shows a confirm
  // card; the caller reads ev.partial before calling this for the final frame.
  if (ev.partial === true) {
    const commands = Array.isArray(ev.commands) ? parseToolkitCommands(ev.commands) : null;
    return { phase: "idle" as const, pendingPlan: null, autoCommands: commands ?? [], partialText: ev.text };
  }
  if (mode === "generate") {
    if (ev.validated === "document" && ev.document !== undefined) {
      // T61 W3-B: alternatives are per-candidate validated; bad ones are dropped.
      return toAwaitingConfirm(
        {
          plan: planOf(ev.text),
          document: ev.document as StudioDocument,
          alternatives: parseAlternatives(ev.alternatives),
          toolTrace,
        },
        violations,
      );
    }
    return toError(toBubbleError("生成结果未通过校验（invalid_json）", ev.text));
  }
  if (mode === "plan") {
    // plan 模式无确认卡：终态同样要复位可见性行（stage/progress 清空）。
    return withReset({ phase: "idle" as const, pendingPlan: null });
  }
  // P7.3 toolkit done frames carry pre-executed commands instead of {plan,ops};
  // UI frames never carry commands, so the legacy contract stays byte-identical.
  if (Array.isArray(ev.commands)) {
    if (ev.commands.length === 0) return toNotice(TOOLKIT_EMPTY_NOTICE);
    const commands = parseToolkitCommands(ev.commands);
    if (!commands) return toError(toBubbleError("AI 返回的命令清单不合法", ev.text));
    return toAwaitingConfirm({ plan: planOf(ev.text), commands, toolTrace }, violations);
  }
  // patch: deep-validate {plan, ops} with patchOpSchema before trusting them.
  const payload = parsePatchPayload(ev.text);
  if (!payload && /"ops"\s*:\s*\[\s*\]/.test(ev.text)) return toNotice(EMPTY_OPS_NOTICE);
  if (!payload) {
    return toError(toBubbleError("AI 返回的操作集不合法（patchOpSchema 校验失败）", ev.text));
  }
  if (payload.ops.length === 0) {
    const plan = payload.plan.trim();
    return toNotice(plan !== "" ? plan : EMPTY_OPS_NOTICE);
  }
  return toAwaitingConfirm({ ...payload, toolTrace }, violations);
}
