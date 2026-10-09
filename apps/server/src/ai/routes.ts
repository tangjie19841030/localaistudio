import { z } from "zod";
import { validateDocument, type StudioDocument } from "@studio/schema-core";
import type { ProjectsStore } from "../store/projects.js";
import { readSettings } from "../store/settings.js";
import { getProvider, type ChatProvider, type ChatMessage } from "./provider.js";
import { guardOps, type GuardedOp, type ScopeChecker } from "./patchGuard.js";
import type { ToolDriver } from "./agentLoop.js";
import { createMockDriver } from "./mock.js";
import { runLoopPipeline } from "./loopPipeline.js";
import { buildSdkDriver, createProviderDriver, createStudioModel } from "./modelProvider.js";
import { createOllamaToolDriver } from "./ollama.js";
import { runToolkitChatStream } from "./toolkit-pipeline.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { parseModelJson } from "./json.js";

export const chatRequestSchema = z.object({
  projectId: z.string().uuid(),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1),
        images: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  mode: z.enum(["plan", "generate", "patch"]),
  scope: z
    .object({
      nodeIds: z.array(z.string()).optional(),
      allowAllTokens: z.boolean().optional(),
      // Toolkit projects (ppt/word): scoped by selection kind + target ids.
      kind: z.enum(["file", "container", "selection"]).optional(),
      targetIds: z.array(z.string()).optional(),
    })
    .optional(),
  // Target page for the loop (T21 §3.6): absent/unknown -> pages[0].
  pageId: z.string().optional(),
  // W3-B multi-variant generate: total round count; generate-only. plan/patch
  // silently ignore it (OP-6 tolerance, no 400).
  variants: z.number().int().min(2).max(3).optional(),
  requestId: z.string().min(1).max(128),
});

export type ChatRequestBody = z.infer<typeof chatRequestSchema>;
export type ChatMode = ChatRequestBody["mode"];

export interface ChatDeps {
  store: ProjectsStore;
  dataDir: string;
  /** Injected scope checker; real implementation is schema-core checkScope (wired in index.ts). */
  scopeChecker?: ScopeChecker;
  /** Test seam: overrides the settings-derived provider (same pattern as screenshotRunner). */
  provider?: ChatProvider;
  /**
   * Test seam (P6-2): overrides the settings-derived agent-loop driver. When set,
   * runChatStream routes generate/patch through runAgentLoop with this driver
   * (mirrors the provider seam; used by the agent-loop route tests).
   */
  driver?: ToolDriver;
}

/** Sends one SSE data frame; routes.ts hands this to the Hono streamSSE writer. */
export type SendEvent = (event: Record<string, unknown>) => Promise<void>;

/** request lifecycle registry: cancel aborts the provider call and the SSE stream. */
export interface RequestRegistry {
  register(requestId: string): AbortController;
  release(requestId: string): void;
  cancel(requestId: string): boolean;
}

export function createRequestRegistry(): RequestRegistry {
  const inFlight = new Map<string, AbortController>();
  return {
    register(requestId) {
      inFlight.get(requestId)?.abort(); // duplicate registration: abort the old stream
      const controller = new AbortController();
      inFlight.set(requestId, controller);
      return controller;
    },
    release(requestId) {
      // Unconditional delete: an aborted entry left behind (client closed the
      // tab without pressing cancel) lived for the whole server process before.
      inFlight.delete(requestId);
    },
    cancel(requestId) {
      const controller = inFlight.get(requestId);
      if (!controller) return false;
      controller.abort();
      inFlight.delete(requestId);
      return true;
    },
  };
}

/**
 * Streaming-visibility stage frames (additive; unknown to older workbench
 * parsers). Emitted from the send side only — agentLoop/verifyLoop stay pure.
 *  - stage/reading: project + settings loaded, model round-trip about to start
 *  - stage/model:   one per model round-trip (complete() / driver.next())
 *  - stage/verify:  emitted by loopPipeline when the verify round is announced
 */
export interface StageFrame {
  type: "stage";
  id: "reading" | "model" | "verify";
  label: string;
  /** verify only: the repair round number (1-based). */
  round?: number;
}

/** Stage labels kept next to the frame type so send sites stay one-liners. */
export const STAGE_LABELS = {
  reading: "正在读取项目…",
  model: "模型思考中…",
  verify: "校验与修复中…",
} as const;

/** Generate-mode gate: text must parse into a schema-valid document. */
export function parseGenerate(text: string):
  | { ok: true; document: StudioDocument }
  | { ok: false } {
  try {
    const parsed = parseModelJson(text) as { document?: unknown } | undefined;
    if (parsed?.document === undefined) return { ok: false };
    try {
      return { ok: true, document: validateDocument(parsed.document) };
    } catch {
      return { ok: false };
    }
  } catch {
    return { ok: false };
  }
}

/** Patch-mode gate: text must parse into structurally guarded ops (deep checks stay frontend-side). */
function parsePatch(text: string):
  | { ok: true; ops: GuardedOp[] }
  | { ok: false } {
  try {
    const parsed = parseModelJson(text) as { ops?: unknown } | undefined;
    if (!Array.isArray(parsed?.ops)) return { ok: false };
    if (guardOps(parsed.ops).length > 0) return { ok: false };
    return { ok: true, ops: parsed.ops as GuardedOp[] };
  } catch {
    return { ok: false };
  }
}

export function scopeViolations(
  scopeChecker: ScopeChecker | undefined,
  ops: GuardedOp[],
  scope: ChatRequestBody["scope"],
): string[] {
  if (!scopeChecker) return [];
  return scopeChecker(ops, scope ?? {});
}

/**
 * Graceful degradation: providers that can't do multimodal get images stripped
 * so the request still succeeds as text-only. The issue list is always in the
 * text prompt regardless, so a text-only model loses no actionable information.
 * Rule: only providers declaring supportsImages=true (openai-compat vision
 * content parts, ollama message.images, mock) receive image payloads.
 */
function degradeForProvider(
  provider: ChatProvider,
  messages: ChatMessage[],
): ChatMessage[] {
  if (provider.supportsImages) return messages;
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/** Full SSE conversation pipeline for one request (used by the route in app.ts). */
/**
 * Pick the agent-loop driver for this request. Real models MUST ride the loop —
 * before this, only mock did, so every real-provider request fell back to the
 * legacy single-shot JSON pipeline (no tool calling, no verify ring).
 * Returns undefined only for plan mode, which stays a plain completion.
 */
function resolveDriver(
  deps: ChatDeps,
  settings: Awaited<ReturnType<typeof readSettings>>,
  provider: ChatProvider,
  onTextDelta?: (chunk: string) => void,
): ToolDriver | undefined {
  if (settings.provider === "mock" && !deps.provider) return createMockDriver();
  if (settings.provider === "openai-compat") {
    const studio = createStudioModel(settings);
    if (studio?.sdk && studio.model) {
      return buildSdkDriver(studio.model, { onTextDelta });
    }
  }
  // ollama: native tool-calling via /api/chat tools (A2). Injected stubs keep
  // the text-JSON provider driver so existing tests stay deterministic.
  if (deps.provider) return createProviderDriver(provider);
  if (settings.provider === "ollama") return createOllamaToolDriver(settings);
  return undefined;
}

export async function runChatStream(
  deps: ChatDeps,
  body: ChatRequestBody,
  controller: AbortController,
  send: SendEvent,
): Promise<void> {
  const bundle = await deps.store.read(body.projectId);
  // P7.3: toolkit projects (ppt/word) ride the command-based pipeline.
  const projectType = await deps.store.readMetaProjectType(body.projectId);
  if (projectType === "ppt" || projectType === "word") {
    await runToolkitChatStream(deps, body, controller, send);
    return;
  }
  // Chat 目前只服务 UI 文档；store.read 的 document 是 per-toolkit unknown，
  // 这里收紧回 StudioDocument。
  const uiBundle = { meta: bundle.meta, document: bundle.document as StudioDocument };
  const settings = await readSettings(deps.dataDir);
  const provider: ChatProvider = deps.provider ?? getProvider(settings);
  const outbound = degradeForProvider(provider, body.messages);
  const system: ChatMessage = {
    role: "system",
    content: buildSystemPrompt(uiBundle, body.mode, body.scope, body.pageId ?? null),
  };
  // Visibility frames: reading done → model round-trip starting. The provider's
  // own onDelta chunks (mock segments / openai-compat SSE) keep streaming as-is.
  const onTextDelta = (chunk: string): void => void send({ delta: chunk });
  const complete = async (messages: ChatMessage[]): Promise<string> => {
    await send({ type: "stage", id: "model", label: STAGE_LABELS.model });
    const result = await provider.complete({
      messages,
      signal: controller.signal,
      onDelta: (chunk) => void send({ delta: chunk }),
    });
    return result.text;
  };
  await send({ type: "stage", id: "reading", label: STAGE_LABELS.reading });

  // P6-2/P6-3 driver selection. All three provider families ride the SAME
  // agent loop; only the "which tool next" selector differs:
  //  - deps.driver      : test seam (highest priority)
  //  - mock             : deterministic marker script (E2E contract)
  //  - openai-compat    : AI SDK generateText tool-calling (the real-model path)
  //  - ollama           : no AI SDK model (v1 spec rejected by ai@7) -> the
  //                       hand-rolled ChatProvider proposes tool calls as JSON
  //                       through createProviderDriver's transcript shape.
  const driver = deps.driver ?? resolveDriver(deps, settings, provider, onTextDelta);
  if (driver && body.mode !== "plan") {
    // Generate-mode scope strip (must stay AFTER the toolkit branch above, which
    // owns the toolkit scope shape). A whole-page run writes wherever the model
    // needs to — new containers included — so a client-sent selection scope only
    // turned every insert/update into "节点 ... 超出修改范围" and left the canvas
    // empty. Patch mode keeps its scope verbatim (strictness unchanged).
    const loopBody = body.mode === "generate" ? { ...body, scope: undefined } : body;
    await runLoopPipeline(deps, loopBody, controller, send, driver, [system, ...outbound], uiBundle.document);
    return;
  }

  const text = await complete([system, ...outbound]);
  if (controller.signal.aborted) {
    await send({ canceled: true });
    return;
  }
  if (body.mode === "plan") {
    await send({ done: true, text });
    return;
  }
  if (body.mode === "generate") {
    const parsed = parseGenerate(text);
    if (parsed.ok) {
      await send({ done: true, validated: "document", document: parsed.document, text });
    } else {
      await send({ error: "invalid_json", raw: text });
    }
    return;
  }
  await runPatchScope(deps, body, controller, complete, text, send, outbound);
}

/** Patch mode with scope interception and exactly one automatic retry (spec §8.3). */

/** Patch mode with scope interception and exactly one automatic retry (spec §8.3). */
async function runPatchScope(
  deps: ChatDeps,
  body: ChatRequestBody,
  controller: AbortController,
  complete: (messages: ChatMessage[]) => Promise<string>,
  text: string,
  send: SendEvent,
  messages: ChatMessage[],
): Promise<void> {
  const first = parsePatch(text);
  if (!first.ok) {
    await send({ error: "invalid_json", raw: text });
    return;
  }
  const firstViolations = scopeViolations(deps.scopeChecker, first.ops, body.scope);
  if (firstViolations.length === 0) {
    await send({ done: true, text });
    return;
  }
  await send({ violation: firstViolations, retry: true });
  if (controller.signal.aborted) {
    await send({ canceled: true });
    return;
  }
  const retryText = await complete([
    ...messages,
    { role: "assistant", content: text },
    {
      role: "user",
      content: `以下操作超出允许范围，请只修改范围内的节点：\n${firstViolations.join("\n")}`,
    },
  ]);
  if (controller.signal.aborted) {
    await send({ canceled: true });
    return;
  }
  const retried = parsePatch(retryText);
  if (!retried.ok) {
    await send({ error: "invalid_json", raw: retryText });
    return;
  }
  const retryViolations = scopeViolations(deps.scopeChecker, retried.ops, body.scope);
  if (retryViolations.length === 0) {
    await send({ done: true, text: retryText });
  } else {
    await send({ error: "scope_violation", violations: retryViolations, raw: retryText });
  }
}
