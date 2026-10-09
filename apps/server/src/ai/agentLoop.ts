import {
  activePageOf,
  checkProps as checkPropsForLoop,
  guardNode as guardNodeForLoop,
  getComponentDef,
  insertNode,
  replacePage,
  STUDIO_TOOLS,
  toolByName,
  type Page,
  type StudioDocument,
  type StudioTool,
  type ToolScope,
} from "@studio/schema-core";
import type { ChatMessage } from "./provider.js";

/**
 * Server-side agent loop (P6-2): turn "choose tools → execute → feed back" into
 * a bounded pipeline over the frozen P6-1 StudioTool registry. Two drivers share
 * the SAME execution path:
 *  - the AI SDK driver (modelProvider + openai.ts's sdkDriver) for real models;
 *  - the deterministic mock driver (mock.ts createMockDriver) for the E2E marker
 *    protocol — marker semantics stay byte-compatible because only the SELECTOR
 *    differs, never the executor.
 */

export interface AgentStep {
  name: string;
  args: unknown;
  ok: boolean;
  message: string;
}

export interface AgentLoopResult {
  /** Accumulated final document; equals the input snapshot when nothing succeeded. */
  doc: StudioDocument;
  steps: AgentStep[];
  /** True when the driver stopped calling tools on its own (model done). */
  finished: boolean;
  /** Terminal failure text (budget exhausted / consecutive failures). */
  error?: string;
  /** Model explanation when it did not emit a tool call. */
  explanation?: string;
}

export type AgentEvent =
  | { type: "tool-call"; name: string; args: unknown }
  | { type: "tool-result"; name: string; ok: boolean; message: string };

export type LoopEvent = AgentEvent | { type: "delta"; text: string };

/** Loop-internal transcript entry (driver-facing; mock never inspects it). */
export type LoopMessage = ChatMessage;

export interface DriverInput {
  messages: LoopMessage[];
  doc: StudioDocument;
  /** Target page the loop edits (T21 §3.6); null/unknown resolves to pages[0]. */
  pageId?: string | null;
  /** Tool declarations for drivers that hand tools to the model (AI SDK). */
  tools?: readonly StudioTool[];
  scope?: ToolScope;
  signal?: AbortSignal;
  /**
   * Execute one tool call against a doc snapshot (zod + scope audited).
   * Drivers that self-execute (AI SDK) MUST use this so failures become
   * model-visible result text instead of a silent "ok".
   */
  executeTool?: (
    call: DriverCall,
    doc: StudioDocument,
  ) => { step: AgentStep; doc: StudioDocument };
}

export interface DriverCall {
  name: string;
  args: unknown;
}

export interface ToolDriver {
  /** Propose the next batch of tool calls; empty = done. */
  next(input: DriverInput): Promise<DriverCall[]>;
  /**
   * SDK-style drivers execute tools inside next() and return []. They stash
   * steps/doc here for the outer loop to adopt (no double-execution).
   */
  takeInternal?: () => { steps: AgentStep[]; doc: StudioDocument; fatal?: string; explanation?: string } | undefined;
}

export interface AgentLoopOptions {
  messages: ChatMessage[];
  doc: StudioDocument;
  /** Target page the loop edits (T21 §3.6); null/unknown resolves to pages[0]. */
  pageId?: string | null;
  scope?: ToolScope;
  tools?: readonly StudioTool[];
  /** Default 24 (plan P6-2). */
  maxSteps?: number;
  onEvent: (ev: LoopEvent) => void;
  signal?: AbortSignal;
  /** Test seam; default = AI SDK or mock driver per settings. */
  driver?: ToolDriver;
}

const DEFAULT_MAX_STEPS = 24;
export { DEFAULT_MAX_STEPS };
const MAX_CONSECUTIVE_FAILURES = 3;
const BUDGET_ERROR = "连续 3 步工具调用失败，已中止";

interface BatchOutcome {
  doc: StudioDocument;
  steps: AgentStep[];
  anyOk: boolean;
}

/**
 * Marker-seam id resolution (P6-2). The frozen registry's insert_node always
 * generates a fresh `n_*` id, so scripted marker targets (sec-1, n_abc12345…)
 * could never be found by later set_frame/update_props steps. A driver may
 * therefore attach `__markerId` to an insert_node call; the loop inserts the
 * node itself (bypassing the registry's id generation) and passes the sanitized
 * args (zod strips the marker key anyway) to the registry for validation. The
 * registry still owns the mutation — only the id is chosen here.
 */
const MARKER_ID_KEY = "__markerId";

function insertWithMarkerId(
  doc: StudioDocument,
  pageId: string | null,
  args: Record<string, unknown>,
  markerId: string,
  scope: ToolScope | undefined,
): { ok: true; doc: StudioDocument } | { ok: false; message: string } {
  const type = String(args.type ?? "");
  const def = getComponentDef(type);
  if (!def) return { ok: false, message: `未知组件类型 "${type}"，请先调用 list_components 查看可用组件` };
  const page = activePageOf(doc, pageId);
  const target = args.parentId === undefined ? page.rootId : String(args.parentId);
  // Scope gate identical to the insert_node tool: the TARGET PARENT is audited.
  const scopeResult = guardNodeForLoop(scope, target);
  if (scopeResult) return { ok: false, message: scopeResult.message };
  const parentRecord = page.nodes.find((n) => n.id === target);
  if (!parentRecord) return { ok: false, message: `父节点 "${target}" 不存在` };
  if (!getComponentDef(parentRecord.type)?.container) {
    return { ok: false, message: `父节点 "${target}" (${parentRecord.type}) 不是容器` };
  }
  const propsResult = checkPropsForLoop(type, args.props);
  if (propsResult) return { ok: false, message: propsResult.message };
  try {
    const node = {
      id: markerId,
      type,
      props: def.propsSchema.parse(args.props ?? {}),
      children: [],
    };
    const nextPage = insertNode(page, node, target, args.index as number | undefined);
    return { ok: true, doc: replacePage(doc, page.id, nextPage) };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
function runBatch(
  calls: DriverCall[],
  doc: StudioDocument,
  pageId: string | null,
  scope: ToolScope | undefined,
  onEvent: (ev: LoopEvent) => void,
): BatchOutcome {
  let current = doc;
  const steps: AgentStep[] = [];
  let anyOk = false;
  for (const call of calls) {
    onEvent({ type: "tool-call", name: call.name, args: call.args });
    const outcome = executeCall(call, current, pageId, scope);
    if (outcome.step.ok) current = outcome.doc;
    if (outcome.step.ok) anyOk = true;
    onEvent({ type: "tool-result", name: call.name, ok: outcome.step.ok, message: outcome.step.message });
    steps.push(outcome.step);
  }
  return { doc: current, steps, anyOk };
}

/** One call → {step, advanced doc (same ref on failure)}. */
function executeCall(
  call: DriverCall,
  doc: StudioDocument,
  pageId: string | null,
  scope: ToolScope | undefined,
): { step: AgentStep; doc: StudioDocument } {
  const args = (call.args ?? {}) as Record<string, unknown>;
  const markerId = args[MARKER_ID_KEY];
  if (call.name === "insert_node" && typeof markerId === "string" && markerId.length > 0) {
    const { [MARKER_ID_KEY]: _ignored, ...clean } = args;
    const inserted = insertWithMarkerId(doc, pageId, clean, markerId, scope);
    if (inserted.ok) {
      return {
        step: { name: call.name, args: call.args, ok: true, message: `已插入节点 ${markerId}` },
        doc: inserted.doc,
      };
    }
    return { step: { name: call.name, args: call.args, ok: false, message: inserted.message }, doc };
  }
  const tool = toolByName(call.name);
  if (!tool) {
    return { step: { name: call.name, args: call.args, ok: false, message: "未知工具" }, doc };
  }
  try {
    const page = activePageOf(doc, pageId);
    const result = tool.execute(args, { page, doc, scope });
    return {
      step: { name: call.name, args: call.args, ok: result.ok, message: result.message },
      doc: result.ok ? result.doc : doc,
    };
  } catch (err) {
    return { step: { name: call.name, args: call.args, ok: false, message: (err as Error).message }, doc };
  }
}

/** Append a batch's tool outcomes to the transcript the driver sees next round. */
export function appendBatchToTranscript(
  messages: LoopMessage[],
  calls: DriverCall[],
  steps: AgentStep[],
): LoopMessage[] {
  const appended: LoopMessage[] = [...messages];
  appended.push({
    role: "assistant",
    content: JSON.stringify({
      tool_calls: calls.map((c) => ({ name: c.name, args: c.args })),
    }),
  });
  appended.push({
    role: "user",
    content: steps
      .map((s) => `[${s.ok ? "成功" : "失败"}] ${s.name}: ${s.message}`)
      .join("\n"),
  });
  return appended;
}

/**
 * The bounded agent loop. Stop conditions (first match wins):
 *  1. driver returns no calls → finished: true
 *  2. maxSteps exhausted → finished: false (no error — the model kept going)
 *  3. abort signal → finished: false, no further executions
 *  4. MAX_CONSECUTIVE_FAILURES all-failed batches → finished: false + error
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const driver = opts.driver;
  if (!driver) return { doc: opts.doc, steps: [], finished: false, error: "缺少工具驱动" };
  const steps: AgentStep[] = [];
  let doc = opts.doc;
  const pageId = opts.pageId ?? null;
  let transcript = opts.messages;
  let finished = false;
  let consecutiveFailures = 0;
  let lastFailureMessage = "";
  let executed = 0;

  while (executed < maxSteps) {
    if (opts.signal?.aborted) return { doc, steps, finished: false };
    const calls = await driver.next({
      messages: transcript,
      doc,
      pageId,
      tools: opts.tools ?? STUDIO_TOOLS,
      scope: opts.scope,
      signal: opts.signal,
      executeTool: (call, snapshot) => {
        opts.onEvent({ type: "tool-call", name: call.name, args: call.args });
        const outcome = executeCall(call, snapshot, pageId, opts.scope);
        opts.onEvent({
          type: "tool-result",
          name: outcome.step.name,
          ok: outcome.step.ok,
          message: outcome.step.message,
        });
        return outcome;
      },
    });
    if (calls.length === 0) {
      const internal = driver.takeInternal?.();
      if (internal) {
        steps.push(...internal.steps);
        doc = internal.doc;
        executed += internal.steps.length;
        if (internal.fatal) {
          return { doc, steps, finished: false, error: internal.fatal };
        }
        if (internal.explanation) {
          return { doc, steps, finished: true, explanation: internal.explanation };
        }
      }
      finished = true;
      break;
    }
    const batch = runBatch(calls, doc, pageId, opts.scope, opts.onEvent);
    doc = batch.doc;
    steps.push(...batch.steps);
    transcript = appendBatchToTranscript(transcript, calls, batch.steps);
    executed += calls.length;
    if (batch.anyOk) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;
      lastFailureMessage = batch.steps.at(-1)?.message ?? "";
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        return { doc, steps, finished: false, error: `${BUDGET_ERROR}：${lastFailureMessage}` };
      }
    }
  }
  return { doc, steps, finished };
}
