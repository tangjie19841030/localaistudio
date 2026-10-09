import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { STUDIO_TOOLS } from "@studio/schema-core";
import { parseModelJson } from "./json.js";
import type { ChatMessage, ChatProvider } from "./provider.js";
import type { ToolDriver, LoopMessage } from "./agentLoop.js";

/**
 * P6-2 model layer: settings → AI SDK driver.
 *
 *  - openai-compat: `@ai-sdk/openai-compatible`@3.0.47 emits LanguageModelV4,
 *    accepted by ai@7 `generateText` (verified: resolveLanguageModel allows
 *    v2/v3/v4). This is the ONLY provider with an AI SDK path.
 *  - ollama: the registry's `ollama-ai-provider`@1.2.0 emits LanguageModelV1,
 *    which ai@7 REJECTS (UnsupportedModelVersionError). No newer build exists.
 *    Ollama therefore keeps the hand-rolled ChatProvider client from ollama.ts.
 *  - mock: no model at all — the deterministic mock driver (mock.ts) bypasses
 *    generateText entirely via the loop's driver seam.
 */

export interface StudioModel {
  /** AI SDK LanguageModel for generateText; absent for mock / ollama. */
  model?: unknown;
  /** Whether this settings row can drive the AI SDK loop. */
  sdk: boolean;
}

/**
 * Build an AI SDK model instance from settings. The offline/dead-proxy semantics
 * of openai.ts carry over: the default fetch already goes DIRECT (Node's fetch
 * ignores the dead npmrc proxy unless env vars say otherwise, and the existing
 * client never set a proxy agent), so we do not inject a custom fetch — same
 * network behavior as the hand-rolled path.
 */
export function createStudioModel(settings: {
  provider: string;
  openai: { baseUrl: string; apiKey: string; model: string };
}): StudioModel | null {
  if (settings.provider === "openai-compat") {
    const openai = createOpenAICompatible({
      name: "openai-compat",
      baseURL: settings.openai.baseUrl.replace(/\/$/, ""),
      apiKey: settings.openai.apiKey,
    });
    return { model: openai(settings.openai.model), sdk: true };
  }
  // ollama (v1 spec, incompatible) and mock (scripted driver) never reach generateText.
  return null;
}

/**
 * Driver for ChatProvider-based models (ollama today; any ChatDeps.provider
 * test stub too): one complete() call proposes tool calls parsed from the
 * OpenAI-style JSON the model emits; empty batch = done.
 *
 * Real OpenAI-compatible models use generateText's own tool-calling loop via
 * buildSdkDriver (openai.ts); this adapter exists so NON-SDK providers can still
 * ride the same loop when injected as the driver.
 */
export function createProviderDriver(provider: ChatProvider): ToolDriver {
  return {
    async next(input) {
      const result = await provider.complete({
        messages: input.messages as ChatMessage[],
      });
      return parseToolCalls(result.text);
    },
  };
}

/**
 * AI SDK tool-calling driver. execute() routes through DriverInput.executeTool
 * (the outer loop's zod+scope executor) so each step sees real document
 * evolution and failure text; the driver then returns [] and stashes
 * steps/doc for runAgentLoop to adopt via takeInternal.
 *
 * ai@7 API notes (verified against dist/index.d.ts):
 *  - tool({ description, inputSchema })   — `parameters` was renamed
 *  - result.toolCalls[].input             — args live on `input`, not `args`
 *  - stopWhen: stepCountIs(n)             — replaces the old maxSteps option
 *  - onStepEnd(event.text)               — per-LLM-call text hook (ai@7.0.97
 *    generateText runs on doGenerate, a non-streaming call: there is NO
 *    token-level onTextPart. Each step's full text arrives in ONE chunk.)
 */
export function buildSdkDriver(
  model: unknown,
  opts: {
    maxSteps?: number;
    /**
     * Streaming text hook: called once per LLM step with that step's text
     * (tool-loop models interleave intermediate reasoning here). Steps with
     * empty text are skipped, so nothing duplicates the caller's own
     * final-text handling.
     */
    onTextDelta?: (chunk: string) => void;
  } = {},
): ToolDriver {
  const maxSteps = opts.maxSteps ?? 16;
  let internal: {
    steps: import("./agentLoop.js").AgentStep[];
    doc: import("@studio/schema-core").StudioDocument;
    fatal?: string;
    explanation?: string;
  } | undefined;

  return {
    takeInternal() {
      const out = internal;
      internal = undefined;
      return out;
    },
    async next(input) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { generateText, tool, stepCountIs } = (await import("ai")) as any;
      let doc = input.doc;
      const steps: import("./agentLoop.js").AgentStep[] = [];
      const executeTool = input.executeTool;
      let streamedText = "";

      const tools: Record<string, unknown> = {};
      for (const t of input.tools ?? STUDIO_TOOLS) {
        tools[t.name] = tool({
          description: t.description,
          // StudioTool parameters are zod schemas; ai@7 accepts them directly.
          inputSchema: t.parameters,
          execute: async (args: unknown) => {
            if (!executeTool) {
              // Defensive: runAgentLoop always injects executeTool in production.
              return "工具执行器未就绪";
            }
            const outcome = executeTool({ name: t.name, args }, doc);
            steps.push(outcome.step);
            if (outcome.step.ok) doc = outcome.doc;
            return outcome.step.message;
          },
        });
      }
      // ai@7 rejects system messages inside `messages` (verified live: "System
      // messages are not allowed in the prompt or messages fields"); system
      // instructions move to the dedicated `instructions` option.
      const systemText = input.messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");
      const result = await generateText({
        model,
        tools,
        stopWhen: stepCountIs(maxSteps),
        // Reasoning models (e.g. glm-5.3-flash) burn their whole output budget
        // on chain-of-thought when facing the 24-tool schema and never emit the
        // tool call (verified live: 8000 tokens reasoning, finish=length, no
        // tool_calls; with effort low: tool call in 27s). "low" keeps planning
        // quality for tool-calling while cutting latency from minutes to tens
        // of seconds.
        reasoning: "low",
        // Per-step text visibility: one chunk per LLM call (see header note —
        // ai@7.0.97 generateText is doGenerate-based, no finer granularity).
        onStepEnd: (event: { text: string }) => {
          if (typeof event.text === "string" && event.text !== "") {
            streamedText += event.text;
            opts.onTextDelta?.(event.text);
          }
        },
        ...(input.signal ? { abortSignal: input.signal } : {}),
        ...(systemText ? { instructions: systemText } : {}),
        messages: input.messages
          .filter((m) => m.role !== "system")
          .map((m) => {
            const images = (m as { images?: string[] }).images;
            return images && images.length > 0
              ? {
                  role: m.role,
                  content: [
                    { type: "text", text: m.content },
                    ...images.map((url) => ({ type: "image", image: url })),
                  ],
                }
              : { role: m.role, content: m.content };
          }),
      });
      // Some OpenAI-compatible endpoints expose the declared tools but answer
      // with the legacy {plan,ops} JSON contract instead of native tool_calls.
      // Keep that compatibility path inside the same audited executor so a
      // token request cannot disappear as an empty batch.
      if (steps.length === 0 && input.executeTool && typeof result.text === "string") {
        for (const call of parseToolCalls(result.text)) {
          const tool = tools[call.name] as
            | { execute?: (args: unknown) => Promise<unknown> }
            | undefined;
          if (tool?.execute) await tool.execute(call.args);
        }
      }
      const explanation = [
        typeof result.text === "string" ? result.text.trim() : "",
        streamedText.trim(),
      ].find((text) => text !== "");
      if (steps.length === 0 && explanation && !input.signal?.aborted) {
        internal = { steps, doc, explanation };
        return [];
      }
      if (
        steps.length === 0
        && (typeof result.text !== "string" || result.text.trim() === "")
        && streamedText.trim() === ""
        && !input.signal?.aborted
      ) {
        internal = {
          steps,
          doc,
          fatal:
            "模型本轮未返回任何工具调用或说明文本（可能模型未理解当前选择范围，或网络/凭证异常）。请重试或调整描述后重发。",
        };
        return [];
      }
      // Tools already ran through executeTool; outer loop must NOT re-execute.
      internal = { steps, doc };
      return [];
    },
  };
}

/** Parse a completion into tool calls, accepting BOTH model shapes:
 *  1. native tool-calling:  {"tool_calls":[{"name":"...","args":{...}}]}
 *  2. legacy single-shot:   {"plan":..., "ops":[...]} or {"plan":..., "document":{...}}
 * Shape 2 is what every pre-P6 provider/stub emits; translating it here keeps
 * ollama, injected test stubs, and older prompts all riding the same loop.
 */
export function parseToolCalls(text: string): { name: string; args: unknown }[] {
  const parsed = parseModelJson(text);
  if (!parsed || typeof parsed !== "object") return [];
  const o = parsed as {
    tool_calls?: unknown;
    ops?: unknown;
    document?: unknown;
  };
  if (Array.isArray(o.tool_calls)) {
    return o.tool_calls.flatMap((c) => {
      const call = c as { name?: unknown; args?: unknown };
      return typeof call?.name === "string" ? [{ name: call.name, args: call.args ?? {} }] : [];
    });
  }
  if (Array.isArray(o.ops)) {
    return translatePatchOps(o.ops);
  }
  if (o.document !== undefined) {
    return [{ name: "propose_document", args: { document: o.document } }];
  }
  return [];
}

/** Map legacy patch ops onto the granular StudioTools. Unknown ops are dropped
 *  (the loop's budget then reports them) rather than aborting the whole batch. */
function translatePatchOps(ops: unknown[]): { name: string; args: unknown }[] {
  const out: { name: string; args: unknown }[] = [];
  for (const raw of ops) {
    if (!raw || typeof raw !== "object") continue;
    const op = raw as { op?: unknown; id?: unknown; nodeId?: unknown; props?: unknown; frame?: unknown;
      parentId?: unknown; index?: unknown; node?: unknown; path?: unknown; value?: unknown };
    const nodeId = typeof op.nodeId === "string" ? op.nodeId : typeof op.id === "string" ? op.id : undefined;
    switch (op.op) {
      case "node.update":
        if (nodeId) out.push({ name: "update_props", args: { nodeId, props: op.props ?? {} } });
        break;
      case "setFrame":
        if (nodeId) out.push({ name: "set_frame", args: { nodeId, frame: op.frame ?? {} } });
        break;
      case "node.remove":
        if (nodeId) out.push({ name: "remove_node", args: { nodeId } });
        break;
      case "node.move":
        if (nodeId && typeof op.parentId === "string") {
          out.push({ name: "move_node", args: { nodeId, newParentId: op.parentId, index: op.index } });
        }
        break;
      case "node.add": {
        const node = op.node as { type?: unknown; props?: unknown } | undefined;
        if (node && typeof node.type === "string") {
          out.push({
            name: "insert_node",
            args: { type: node.type, parentId: op.parentId, index: op.index, props: node.props ?? {} },
          });
        }
        break;
      }
      case "tokens.set":
        if (Array.isArray(op.path)) out.push({ name: "set_token", args: { path: op.path, value: op.value } });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Loop messages are ChatMessages (same wire shape); export the cast helper. */
export function asChatMessages(messages: LoopMessage[]): ChatMessage[] {
  return messages;
}
