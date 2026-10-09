import type { StudioSettings } from "../store/settings.js";
import type {
  ChatMessage,
  ChatProvider,
  CompleteRequest,
  CompleteResult,
  DetectResult,
} from "./provider.js";
import type { StudioTool } from "@studio/schema-core";
import type { DriverCall, DriverInput, ToolDriver } from "./agentLoop.js";
import { zodParametersToJsonSchema } from "./zodJsonSchema.js";

const DETECT_TIMEOUT_MS = 2000;
const base = (url: string) => url.replace(/\/$/, "");

/** Ollama wants raw base64 — strip any "data:<mime>;base64," prefix the caller sent. */
function rawBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return dataUrl.startsWith("data:") && comma !== -1 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Message body for /api/chat; the images key is omitted entirely when there are none. */
function outboundMessage(message: ChatMessage): {
  role: string;
  content: string;
  images?: string[];
} {
  return message.images?.length
    ? { role: message.role, content: message.content, images: message.images.map(rawBase64) }
    : { role: message.role, content: message.content };
}

interface OllamaStreamChunk {
  message?: {
    content?: string;
    tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
  };
  done?: boolean;
}

/** Ollama streams NDJSON: one JSON object per line, terminated by {done:true}. */
async function consumeNdjson(
  body: ReadableStream<Uint8Array>,
  onDelta?: (chunk: string) => void,
): Promise<{ text: string; toolCalls: { name: string; args: unknown }[] }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let text = "";
  const toolCalls: { name: string; args: unknown }[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, sep).trim();
      buffered = buffered.slice(sep + 1);
      if (!line) continue;
      const chunk = JSON.parse(line) as OllamaStreamChunk;
      const piece = chunk.message?.content ?? "";
      if (piece) {
        text += piece;
        onDelta?.(piece);
      }
      for (const call of chunk.message?.tool_calls ?? []) {
        const name = call?.function?.name;
        if (typeof name !== "string" || name.length === 0) continue;
        const rawArgs = call.function?.arguments;
        toolCalls.push({ name, args: normalizeToolArgs(rawArgs) });
      }
      if (chunk.done) return { text, toolCalls };
    }
  }
  return { text, toolCalls };
}

/** Ollama may deliver tool args as object or JSON string. */
function normalizeToolArgs(raw: unknown): unknown {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

/** Map StudioTools onto Ollama's OpenAI-compatible tools payload. */
function toOllamaTools(tools: readonly StudioTool[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: zodParametersToJsonSchema(t.parameters),
    },
  }));
}

export function createOllamaProvider(settings: StudioSettings): ChatProvider {
  const { ollama, temperature } = settings;

  async function detect(): Promise<DetectResult> {
    try {
      const res = await fetch(`${base(ollama.baseUrl)}/api/tags`, {
        signal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
      });
      if (!res.ok) {
        return { id: "ollama", available: false, detail: `HTTP ${res.status}` };
      }
      const tags = (await res.json()) as { models?: { name?: string }[] };
      const count = tags.models?.length ?? 0;
      return { id: "ollama", available: true, detail: `本机 ollama 可达，${count} 个模型` };
    } catch (err) {
      return { id: "ollama", available: false, detail: `不可达: ${(err as Error).message}` };
    }
  }

  async function complete(req: CompleteRequest): Promise<CompleteResult> {
    const res = await fetch(`${base(ollama.baseUrl)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollama.model,
        stream: true,
        temperature,
        messages: req.messages.map(outboundMessage),
      }),
      signal: req.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`ollama 请求失败: HTTP ${res.status}`);
    }
    const { text } = await consumeNdjson(res.body, req.onDelta);
    return { text };
  }

  return { supportsImages: true, detect, complete };
}

/**
 * Native tool-calling driver for Ollama (A2). Each next() is one /api/chat
 * turn WITH the StudioTool registry advertised as Ollama tools; the response's
 * message.tool_calls become the outer loop's batch. Falls back to empty when
 * the model replies with plain text (finished).
 */
export function createOllamaToolDriver(settings: StudioSettings): ToolDriver {
  const { ollama, temperature } = settings;
  return {
    async next(input: DriverInput): Promise<DriverCall[]> {
      const res = await fetch(`${base(ollama.baseUrl)}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollama.model,
          stream: true,
          temperature,
          tools: toOllamaTools(input.tools ?? []),
          messages: input.messages.map((m) => outboundMessage(m as ChatMessage)),
        }),
        signal: input.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`ollama 请求失败: HTTP ${res.status}`);
      }
      const { toolCalls } = await consumeNdjson(res.body);
      return toolCalls;
    },
  };
}
