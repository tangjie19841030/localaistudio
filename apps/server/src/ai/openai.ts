import type { StudioSettings } from "../store/settings.js";
import type {
  ChatMessage,
  ChatProvider,
  CompleteRequest,
  CompleteResult,
  DetectResult,
} from "./provider.js";

interface ContentPart {
  type: string;
  text?: string;
  image_url?: { url: string };
}

/** OpenAI content part: text, or image_url with a base64 data URL. */
function contentParts(message: ChatMessage): ContentPart[] {
  const parts: ContentPart[] = [{ type: "text", text: message.content }];
  for (const url of message.images ?? []) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return parts;
}

/**
 * Vision content parts only when images are attached; a text-only message keeps
 * the plain-string content shape, which every openai-compatible endpoint accepts
 * (some non-vision servers reject the array form).
 */
function outboundMessage(message: ChatMessage): { role: string; content: string | ContentPart[] } {
  return message.images?.length
    ? { role: message.role, content: contentParts(message) }
    : { role: message.role, content: message.content };
}

/** Parse an OpenAI SSE body: "data: {...}" frames, terminated by "data: [DONE]". */
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onDelta?: (chunk: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, sep).replace(/\r$/, "");
      buffered = buffered.slice(sep + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return text;
      if (!payload) continue;
      const delta = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] })
        .choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onDelta?.(delta);
      }
    }
  }
  return text;
}

export function createOpenAIProvider(settings: StudioSettings): ChatProvider {
  const { openai, temperature } = settings;

  async function complete(req: CompleteRequest): Promise<CompleteResult> {
    const res = await fetch(`${openai.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openai.apiKey}`,
      },
      body: JSON.stringify({
        model: openai.model,
        stream: true,
        temperature,
        messages: req.messages.map(outboundMessage),
      }),
      signal: req.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`openai-compat 请求失败: HTTP ${res.status}`);
    }
    return { text: await consumeSse(res.body, req.onDelta) };
  }

  async function detect(): Promise<DetectResult> {
    // Config check only — no network probing with a possibly-wrong key.
    const ready = Boolean(openai.baseUrl && openai.apiKey && openai.model);
    return ready
      ? { id: "openai-compat", available: true, detail: `模型 ${openai.model}` }
      : { id: "openai-compat", available: false, detail: "缺少 baseUrl / apiKey / model 配置" };
  }

  return { supportsImages: true, detect, complete };
}
