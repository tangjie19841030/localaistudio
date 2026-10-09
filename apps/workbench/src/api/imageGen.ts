import { ApiError, getSettings } from "./client";

// U7 image generation client. Kept out of client.ts (debt file), following the
// api/import-image.ts standalone-file precedent. Settings probing reuses the
// existing masked GET /api/settings (the key itself never leaves the server;
// hasKey is the only signal the UI needs).

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "无法连接本地服务（127.0.0.1:8787）");
  }
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return (await res.json()) as T;
}

/** POST /api/projects/:id/image-gen 200 body. */
export interface ImageGenResult {
  /** Same-origin asset URL: /api/projects/<id>/assets/<sha1>.png */
  src: string;
  bytes: number;
}

/** True when the server has both an openai key and an image model configured. */
export async function getImageGenAvailability(): Promise<boolean> {
  const settings = await getSettings();
  const model = (settings as { imageGen?: { model?: string } }).imageGen?.model?.trim();
  return settings.hasKey === true && Boolean(model);
}

/** Call the image generation route for one project. */
export function generateImage(projectId: string, prompt: string): Promise<ImageGenResult> {
  return postJson<ImageGenResult>(`/api/projects/${encodeURIComponent(projectId)}/image-gen`, { prompt });
}

export interface ImageGenFailure {
  /** Server error code (image_gen_unavailable / _failed / _timeout / …). */
  code: string;
  /** User-readable Chinese message from the server body. */
  message: string;
  /** 501: the entry must hide itself (config disappeared server-side). */
  unavailable: boolean;
}

const FALLBACK_MESSAGE = "图片生成失败，请重试";

/** Normalize any thrown value from generateImage into a user-facing failure. */
export function describeImageGenError(err: unknown): ImageGenFailure {
  if (err instanceof ApiError) {
    if (err.status === 0) return { code: "network", message: err.message, unavailable: false };
    try {
      const body = JSON.parse(err.message) as { error?: string; message?: string };
      const code = typeof body.error === "string" ? body.error : `http_${err.status}`;
      return {
        code,
        message: typeof body.message === "string" && body.message ? body.message : FALLBACK_MESSAGE,
        unavailable: err.status === 501 || code === "image_gen_unavailable",
      };
    } catch {
      return { code: `http_${err.status}`, message: FALLBACK_MESSAGE, unavailable: err.status === 501 };
    }
  }
  return { code: "unknown", message: err instanceof Error ? err.message : FALLBACK_MESSAGE, unavailable: false };
}
