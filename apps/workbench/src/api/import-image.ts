import type { StudioDocument } from "@studio/schema-core";
import { ApiError } from "./client";

// Import-image endpoint lives here instead of client.ts (487-line debt): this
// file mirrors api/visual.ts's local twin of client.ts's private request() —
// same ApiError semantics, same normalized network-failure message.

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "无法连接本地服务（127.0.0.1:8787）");
  }
  if (!res.ok) {
    throw new ApiError(res.status, await res.text());
  }
  return (await res.json()) as T;
}

/** Import mode: rendered screenshot vs hand-drawn wireframe (prompt variant). */
export type ImportImageMode = "screenshot" | "wireframe";

/** Contract §4.1 (T48/T49 shared): POST /api/ai/import-image request body. */
export interface ImportImageInput {
  /** 1..4 base64 dataURLs; server hard limit 40MB total. */
  images: string[];
  /** Defaults to "screenshot" server-side. */
  mode?: ImportImageMode;
  /** Optional style supplement (≤500 chars) appended to the user prompt. */
  styleHint?: string;
  /** Optional; document.name / page naming only. Server default "导入页面". */
  projectName?: string;
}

/** Contract §4.1 200 response: one v2 document, one page per image. */
export interface ImportImageResult {
  document: StudioDocument;
  /** Per-image degradation warnings (e.g. skipped after the 3-round budget). */
  warnings: string[];
  /** Successful page count (equals document.pages.length). */
  pages: number;
}

export const importImageApi = {
  /** POST /api/ai/import-image: convert ≤4 screenshots into a v2 document. */
  importImage(input: ImportImageInput): Promise<ImportImageResult> {
    return request<ImportImageResult>("/api/ai/import-image", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};
