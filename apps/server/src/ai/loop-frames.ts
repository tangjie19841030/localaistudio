import type { StudioDocument } from "@studio/schema-core";
import type { ChatMessage } from "./provider.js";
import type { GuardedOp } from "./patchGuard.js";
import type { AgentLoopResult } from "./agentLoop.js";
import type { SendEvent } from "./routes.js";
import { parseModelJson } from "./json.js";

/**
 * Text/frame construction for the agent-loop SSE pipeline (T54 split).
 * Pure formatting only: turns loop results into the human plan text and the
 * 5-delta cadence; no orchestration and no terminal-state assembly here.
 */

/**
 * Extract a short human-facing stream text from a done payload.
 * The full {plan, document} JSON must NEVER hit the chat bubble — the document
 * rides only on the done frame's structured `document` field (and on ops in
 * patch mode). Streaming the raw JSON fills the left rail with a schema dump.
 */
export function humanStreamText(fullText: string): string {
  try {
    const parsed = parseModelJson(fullText) as { plan?: unknown } | undefined;
    if (typeof parsed?.plan === "string" && parsed.plan.trim() !== "") {
      return parsed.plan;
    }
  } catch {
    // not JSON — pass through below
  }
  if (fullText.length > 400 && fullText.trimStart().startsWith("{")) {
    return "正在整理变更摘要…";
  }
  return fullText;
}

/**
 * Legacy streaming parity: the mock provider streamed its reply in 5 segments
 * before the loop refactor. Stream the HUMAN plan (never the document JSON) so
 * the workbench bubble stays scannable while keeping the 5-delta cadence.
 */
export async function streamLoopDeltas(send: SendEvent, text: string): Promise<void> {
  const stream = humanStreamText(text);
  const size = Math.max(1, Math.ceil(stream.length / 5));
  for (let i = 0; i < stream.length; i += size) {
    await send({ delta: stream.slice(i, i + size) });
  }
}

/** Image-count echo (P4) carried from the transcript into the plan text. */
export function noteOf(messages: ChatMessage[]): string {
  const count = messages.reduce(
    (n, m) => n + ((m as { images?: string[] }).images?.length ?? 0),
    0,
  );
  return count > 0 ? `（收到 ${count} 张截图）` : "";
}

/** Generate-mode done text: plan only. The document rides on the done frame. */
export function planText(result: AgentLoopResult): string {
  const stepLine = summarizeSteps(result.steps);
  return JSON.stringify({
    plan: `规划：AI 助手通过工具调用完成本次变更。${stepLine}`,
  });
}

/** Cap tool-step noise so the plan line stays readable in the bubble/card. */
export function summarizeSteps(steps: AgentLoopResult["steps"]): string {
  if (steps.length === 0) return "";
  const head = steps
    .slice(0, 6)
    .map((s) => `${s.name}${s.ok ? "" : "（失败）"}`)
    .join("、");
  return steps.length > 6 ? `经 ${steps.length} 步：${head}…` : `经 ${steps.length} 步：${head}`;
}

/** Budget-exhausted generate text: the plan names every unresolved issue so
 *  the confirm card can show what the model failed to fix (user may reject).
 *  `document` is kept here only for the verify-loop contract test; the SSE
 *  done frame still carries the structured document field. */
export function planTextWithIssues(doc: StudioDocument, issues: string[]): string {
  const issueLines = issues.map((i) => `- ${i}`).join("\n");
  return JSON.stringify({
    plan: `规划：AI 助手完成本次变更，但以下问题未修复，请检查确认。\n${issueLines}`,
    document: doc,
  });
}

/** Patch-mode done text: { plan, ops } JSON (workbench parsePatchPayload parses ops). */
export function patchPlanText(ops: GuardedOp[], note: string): string {
  return JSON.stringify({
    plan: `规划：AI 助手通过工具调用完成本次局部修改。${note}${ops.length ? `（${ops.length} 个操作）` : ""}`,
    ops,
  });
}
