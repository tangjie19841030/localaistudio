import type { StudioSettings } from "../store/settings.js";

/**
 * U7 text-to-image generation (design §3.4 D1): a module SEPARATE from the
 * chat ChatProvider chain — ChatProvider.complete only does chat text + image
 * INPUT, there is no image-OUTPUT method on that interface. v1 speaks the
 * OpenAI-compatible images endpoint ({baseUrl}/images/generations); ollama has
 * no stable text-to-image endpoint in the local-first scope (§8-Q3), so it is
 * simply not configured rather than promised by a provider enum.
 *
 * Production path performs real HTTP and ONLY real HTTP. Tests inject a fake
 * through registerImageGenRoutes' deps seam; no fake is ever constructible
 * from a production import (mock ownership = image-gen.test.ts).
 */

export type ImageGenError =
  | { kind: "not_configured" } // imageGen.model empty -> 501
  | { kind: "no_key" } // openai.apiKey empty -> 501
  | { kind: "model_rejected"; message: string } // provider 4xx/5xx/network -> 502
  | { kind: "timeout"; message: string }; // 60s budget -> 504

export type ImageGenOutcome =
  | { ok: true; dataUrl: string }
  | { ok: false; error: ImageGenError };

export interface ImageGenerator {
  /** Settings-derived availability; the route answers 501 when false. */
  readonly available: boolean;
  generate(prompt: string): Promise<ImageGenOutcome>;
}

/** Single generation attempt wall-clock budget (design §3.5). */
export const IMAGE_GEN_TIMEOUT_MS = 60_000;

/** Strip a trailing slash so `${baseUrl}/images/generations` stays well-formed. */
function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/images/generations`;
}

/** Pull the b64 payload out of an OpenAI-shaped images response. */
function extractDataUrl(json: unknown): { ok: true; dataUrl: string } | { ok: false; message: string } {
  const b64 = (json as { data?: { b64_json?: unknown }[] } | null)?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || b64 === "") {
    return { ok: false, message: "图像模型返回中缺少图片数据（b64_json）" };
  }
  // The compatible endpoint returns PNG bytes for b64_json responses.
  return { ok: true, dataUrl: `data:image/png;base64,${b64}` };
}

/** Map a thrown fetch/HTTP failure onto the typed error union. */
function failure(err: unknown): ImageGenOutcome {
  if (err instanceof Error && err.name === "AbortError") {
    return { ok: false, error: { kind: "timeout", message: "图像生成超时（60 秒）" } };
  }
  const detail = err instanceof Error ? err.message : String(err);
  return { ok: false, error: { kind: "model_rejected", message: `图像模型请求失败：${detail}` } };
}

/**
 * Settings-driven single entry. Available only when an image model AND an
 * openai apiKey are both explicitly configured — never picks a default model
 * or billing tier for the user (§8-Q5).
 */
export function createImageGenerator(settings: StudioSettings): ImageGenerator {
  const { baseUrl, apiKey } = settings.openai;
  const model = settings.imageGen.model.trim();
  const available = model !== "" && apiKey !== "";

  async function generate(prompt: string): Promise<ImageGenOutcome> {
    if (model === "") return { ok: false, error: { kind: "not_configured" } };
    if (apiKey === "") return { ok: false, error: { kind: "no_key" } };
    let res: Response;
    try {
      res = await fetch(endpoint(baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, prompt, n: 1, response_format: "b64_json" }),
        signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT_MS),
      });
    } catch (err) {
      return failure(err);
    }
    if (!res.ok) {
      return {
        ok: false,
        error: { kind: "model_rejected", message: `图像模型拒绝请求：HTTP ${res.status}` },
      };
    }
    const parsed = extractDataUrl(await res.json().catch(() => null));
    if (!parsed.ok) {
      return { ok: false, error: { kind: "model_rejected", message: parsed.message } };
    }
    return { ok: true, dataUrl: parsed.dataUrl };
  }

  return { available, generate };
}
