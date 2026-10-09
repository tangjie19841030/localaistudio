import type { StudioSettings } from "../store/settings.js";
import { createMockProvider } from "./mock.js";
import { createOpenAIProvider } from "./openai.js";
import { createOllamaProvider } from "./ollama.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** Multimodal inputs as base64 data URLs. */
  images?: string[];
}

export interface CompleteRequest {
  messages: ChatMessage[];
  signal?: AbortSignal;
  /** Streaming callback: mock fires it per segment, network providers per chunk. */
  onDelta?: (chunk: string) => void;
}

export interface CompleteResult {
  text: string;
}

export interface DetectResult {
  id: string;
  available: boolean;
  detail?: string;
}

export interface ChatProvider {
  /**
   * Whether this provider can carry image payloads.
   * Rule: only providers with a documented multimodal request shape declare true
   * (openai-compat vision content parts, ollama message.images, mock echo).
   * When false, routes.ts drops the images and the request degrades to text-only.
   */
  supportsImages: boolean;
  detect(): Promise<DetectResult>;
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

/** Provider factory keyed by the persisted settings (spec §5.1). */
export function getProvider(settings: StudioSettings): ChatProvider {
  switch (settings.provider) {
    case "openai-compat":
      return createOpenAIProvider(settings);
    case "ollama":
      return createOllamaProvider(settings);
    case "mock":
      return createMockProvider();
  }
}

export { createMockProvider, createOpenAIProvider, createOllamaProvider };
