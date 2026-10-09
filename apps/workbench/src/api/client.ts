import type {
  NewProjectInput,
  StudioDocument,
  ProjectMeta,
} from "@studio/schema-core";
import type { PptDocument } from "@studio/ppt-toolkit";
import type { WordDocument } from "@studio/word-toolkit";

/**
 * API bundle 形状（P7.3 泛化）：meta + per-toolkit 领域文档。
 * UI 文档包沿用 schema-core 的 ProjectBundle（document: StudioDocument）；
 * ppt/word 各自的文档类型来自 @studio/ppt-toolkit / @studio/word-toolkit
 *（纯类型 import，不进运行时 bundle）。运行时 document 的形状由 server
 * 按项目类型校验，客户端用 isUiDocument 系列守卫做类型收窄。
 */
export type UiProjectBundle = { meta: ProjectMeta; document: StudioDocument };
export type PptProjectBundle = { meta: ProjectMeta; document: PptDocument };
export type WordProjectBundle = { meta: ProjectMeta; document: WordDocument };
export type ProjectBundle = UiProjectBundle | PptProjectBundle | WordProjectBundle;

/** UI 文档判别（documentVersion + nodes/rootId 是 StudioDocument 独有形状）。 */
export function isUiDocument(document: unknown): document is StudioDocument {
  const doc = document as StudioDocument | null;
  return (
    typeof doc === "object" &&
    doc !== null &&
    Array.isArray((doc as StudioDocument).pages)
  );
}

/** projectType 判别守卫：meta 缺省/为 ui 时按 UI 文档收窄。 */
export function isUiBundle(
  bundle: ProjectBundle,
): bundle is { meta: ProjectMeta; document: StudioDocument } {
  return bundle.meta.projectType === "ui" || isUiDocument(bundle.document);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message.slice(0, 500));
  }
}

/** Pull a human-readable Chinese detail out of a JSON error body, if present. */
function errorDetail(raw: string, status: number): string {
  try {
    const body = JSON.parse(raw) as { message?: string; issues?: unknown; error?: string };
    if (typeof body.message === "string" && body.message) return body.message;
    if (Array.isArray(body.issues)) return body.issues.map(String).join("；");
    if (typeof body.error === "string" && body.error) return `服务端拒绝请求（${body.error}）`;
  } catch {
    // non-JSON body: keep raw
  }
  return raw.trim() || `请求失败（${status}）`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    // 网络层失败（服务未启动/连接拒绝）归一为 status 0 的 ApiError，让界面展示统一
    throw new ApiError(0, "无法连接本地服务（127.0.0.1:8787）");
  }
  if (!res.ok) {
    throw new ApiError(res.status, errorDetail(await res.text(), res.status));
  }
  return (await res.json()) as T;
}

export interface RemoteVersion {
  versionId: string;
  projectId: string;
  name: string;
  createdAt: string;
}

/** Template registry item returned by the gallery API. */
export interface TemplateGalleryItem {
  id: string;
  name: string;
  category: string;
  description: string;
  source: string;
  document: StudioDocument;
}

/** A single version read back from the server, document included (P4-5 diff). */
export interface RemoteVersionRecord extends RemoteVersion {
  document: StudioDocument;
}

export const api = {
  listProjects(): Promise<ProjectMeta[]> {
    return request<{ projects: ProjectMeta[] }>("/api/projects").then((d) => d.projects);
  },
  // -------------------------------------------------------------------
  // Template gallery + import (route A: external → Schema).
  // -------------------------------------------------------------------
  listTemplates(): Promise<{ templates: TemplateGalleryItem[] }> {
    return request<{ templates: TemplateGalleryItem[] }>("/api/templates");
  },
  importTemplate(id: string): Promise<{ ok: boolean; template: TemplateGalleryItem }> {
    return request<{ ok: boolean; template: TemplateGalleryItem }>("/api/templates/import", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
  },
  createProject(input: NewProjectInput): Promise<ProjectBundle> {
    return request<ProjectBundle>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  getProject(id: string): Promise<ProjectBundle> {
    return request<ProjectBundle>(`/api/projects/${id}`);
  },
  saveProject(id: string, data: ProjectBundle): Promise<ProjectBundle> {
    return request<ProjectBundle>(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },
  /**
   * Import a .pptx template (raw upload, NOT the JSON request() helper):
   * replace = new-project flow, append = add the template's slides to a deck.
   * The server writes image assets and returns the parsed PptDocument; the
   * caller saves it through saveProject (new project) or the editor store.
   */
  async importPptx(
    id: string,
    file: File,
    mode: "replace" | "append",
  ): Promise<{ document: PptDocument; warnings: string[]; imported: { slides: number; assets: number } }> {
    let res: Response;
    try {
      res = await fetch(`/api/projects/${id}/import/pptx?mode=${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
    } catch {
      throw new ApiError(0, "无法连接本地服务（127.0.0.1:8787）");
    }
    if (!res.ok) {
      const raw = await res.text();
      let detail = raw;
      try {
        const body = JSON.parse(raw) as { message?: string };
        if (body.message) detail = body.message;
      } catch {
        // non-JSON error body: keep the raw text
      }
      throw new ApiError(res.status, detail);
    }
    return res.json();
  },
  /**
   * Upload one media file as a PPT project asset (raw octet-stream, same
   * shape as importPptx). kind=video routes to the 200MB video branch server
   * side; the default stays image. Returns the asset URL to use as an
   * image/video object src.
   */
  async uploadPptAsset(
    id: string,
    file: File,
    kind?: "image" | "video",
  ): Promise<{ src: string; sha1: string; ext: string; contentType: string; bytes: number }> {
    let res: Response;
    try {
      res = await fetch(`/api/projects/${id}/assets${kind === "video" ? "?kind=video" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
    } catch {
      throw new ApiError(0, "无法连接本地服务（127.0.0.1:8787）");
    }
    if (!res.ok) {
      const raw = await res.text();
      let detail = raw;
      try {
        const body = JSON.parse(raw) as { message?: string };
        if (body.message) detail = body.message;
      } catch {
        // non-JSON error body: keep the raw text
      }
      throw new ApiError(res.status, detail);
    }
    return res.json();
  },
  deleteProject(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" });
  },
  createVersion(id: string, data: { name: string; document: StudioDocument }): Promise<RemoteVersion> {
    return request<RemoteVersion>(`/api/projects/${id}/versions`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  listVersions(id: string): Promise<RemoteVersion[]> {
    return request<{ versions: RemoteVersion[] }>(`/api/projects/${id}/versions`).then(
      (d) => d.versions,
    );
  },
  /** GET a single version including its document (works without a Dexie mirror). */
  getVersion(id: string, versionId: string): Promise<RemoteVersionRecord> {
    return request<RemoteVersionRecord>(`/api/projects/${id}/versions/${versionId}`);
  },
  deleteVersion(id: string, versionId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/api/projects/${id}/versions/${versionId}`, {
      method: "DELETE",
    });
  },
};

// ---------------------------------------------------------------------------
// AI chat (P2-4): SSE stream + cancel + settings (spec §9.1).
// ---------------------------------------------------------------------------

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** Multimodal inputs as base64 data URLs (P4-4 screenshot repair). */
  images?: string[];
}

export interface StreamChatBody {
  projectId: string;
  messages: ChatCompletionMessage[];
  mode: "plan" | "generate" | "patch";
  scope?: { nodeIds?: string[]; allowAllTokens?: boolean };
  /** Target page for the loop (T21 §3.6); server defaults to pages[0] when absent. */
  pageId?: string;
  requestId: string;
}

/** Terminal/intermediate SSE events; "delta" frames go through onDelta instead. */
export type ChatEvent =
  | { done: true; text: string; validated?: "document"; document?: unknown }
  | { violation: string[]; retry: true }
  | { error: string; raw?: string; violations?: string[] }
  | { canceled: true }
  | { type: "tool-call"; name: string; args: unknown }
  | { type: "tool-result"; name: string; ok: boolean; message: string }
  // 流式可见性帧（server verifyLoop / stage / progress / heartbeat）：
  // 无终态语义，只喂 UI 的阶段行与停滞检测；heartbeat 绝不进 onDelta。
  | { type: "stage"; id: string; label: string; round?: number }
  | { type: "progress"; step: number; total: number; label: string }
  | { type: "heartbeat"; at: number }
  | { type: "verify-round"; round: number; issues: string[] };

export interface StreamChatHandlers {
  onDelta(text: string): void;
  onEvent(ev: ChatEvent): void;
}

/**
 * POST /api/chat/completions and parse the SSE body: accumulate a byte buffer,
 * split frames on "\n\n", and dispatch each "data: {...}" line as one event.
 * delta frames additionally feed onDelta; the AbortSignal is passed to fetch so
 * the browser tears the connection down natively.
 */
export async function streamChat(
  body: StreamChatBody,
  handlers: StreamChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err; // user-initiated abort is not a network error
    throw new ApiError(0, "无法连接本地服务（127.0.0.1:8787）");
  }
  if (!res.ok) {
    // Surface the server's Chinese message instead of a raw JSON blob.
    const raw = await res.text();
    let detail = raw;
    try {
      const body = JSON.parse(raw) as { message?: string; error?: string };
      if (body.message) detail = body.message;
      else if (body.error) detail = body.error;
    } catch {
      // non-JSON body: keep raw text
    }
    throw new ApiError(res.status, detail);
  }
  if (!res.body) throw new ApiError(0, "SSE 响应缺少 body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const dispatchFrame = (frame: string): void => {
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      const ev = JSON.parse(payload) as { delta?: string; type?: string } & ChatEvent;
      // Frames carrying a "type" discriminator are routed to onEvent (tool
      // frames + visibility frames stage/progress/heartbeat/verify-round);
      // every other frame keeps its shapeless key-based discrimination
      // (done/violation/error/canceled) unchanged. "type" frames never carry
      // deltas, so heartbeat can never leak text into the bubble.
      if (typeof ev.type === "string") {
        handlers.onEvent(ev);
        continue;
      }
      if (typeof ev.delta === "string") handlers.onDelta(ev.delta);
      else handlers.onEvent(ev);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffered.indexOf("\n\n")) !== -1) {
      dispatchFrame(buffered.slice(0, sep));
      buffered = buffered.slice(sep + 2);
    }
  }
  buffered += decoder.decode();
  if (buffered.trim()) dispatchFrame(buffered);
  // Note: a stream can end here without a terminal frame (server restart).
  // The caller (aiStore) tracks terminal frames and posts a connection error.
}

/** Ask the server to abort an in-flight stream; unknown ids resolve to ok:false. */
export async function cancelChat(requestId: string): Promise<void> {
  await request<{ ok: boolean }>("/api/chat/cancel", {
    method: "POST",
    body: JSON.stringify({ requestId }),
  });
}

// Settings shapes mirror the server contract (apps/server/src/store/settings.ts):
// GET never exposes the raw apiKey; empty apiKey on PUT means "keep stored".

export interface MaskedSettings {
  provider: "mock" | "openai-compat" | "ollama";
  openai: { baseUrl: string; apiKey: ""; model: string };
  ollama: { baseUrl: string; model: string };
  temperature: number;
  hasKey: boolean;
  keyHint: string;
}

export interface DetectResultDto {
  id: string;
  available: boolean;
  detail?: string;
}

export type ModelTestResult =
  | { ok: true; sample: string }
  | { ok: false; sample: string; detail: string };

export async function getSettings(): Promise<MaskedSettings> {
  return request<MaskedSettings>("/api/settings");
}

export async function putSettings(input: MaskedSettings): Promise<MaskedSettings> {
  return request<MaskedSettings>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function getModelProviders(): Promise<DetectResultDto[]> {
  const d = await request<{ providers: DetectResultDto[] }>("/api/model/providers");
  return d.providers;
}

export async function testModel(): Promise<ModelTestResult> {
  return request<ModelTestResult>("/api/model/test", { method: "POST" });
}

// ---------------------------------------------------------------------------
// Codegen endpoints (P3-4): generate / files / preview / checks / export zip.
// ---------------------------------------------------------------------------

export interface GeneratedFileList {
  files: string[];
  /** Paths whose on-disk hand-edits were overwritten by this generate (A3). */
  handEdited?: string[];
}

export interface ProjectFileContent {
  path: string;
  content: string;
}

export interface ChecksResult {
  ok: boolean;
  errors: string[];
}

export const codegenApi = {
  /** POST /generate: write the current document's project to disk. */
  generateProject(id: string, document?: StudioDocument): Promise<GeneratedFileList> {
    // Pass the in-memory document so unsaved edits still generate current code;
    // the server falls back to its disk copy when omitted.
    return request<GeneratedFileList>(`/api/projects/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: document ? JSON.stringify({ document }) : undefined,
    });
  },
  /** GET /files without path: last generated file list. */
  listProjectFiles(id: string): Promise<GeneratedFileList> {
    return request<GeneratedFileList>(`/api/projects/${id}/files`);
  },
  /** GET /files?path=<rel>: single file content (server jails traversal). */
  getProjectFile(id: string, path: string): Promise<ProjectFileContent> {
    return request<ProjectFileContent>(
      `/api/projects/${id}/files?path=${encodeURIComponent(path)}`,
    );
  },
};

/** POST /preview/start → { port }; 409 not_generated when nothing was generated yet. */
export async function startPreview(id: string): Promise<{ port: number }> {
  return request<{ port: number }>(`/api/projects/${id}/preview/start`, { method: "POST" });
}

export async function stopPreview(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/projects/${id}/preview/stop`, { method: "POST" });
}

/** POST /checks: build/typecheck gate before export (spec §6.3). */
export async function runChecks(id: string): Promise<{ checks: ChecksResult }> {
  return request<{ checks: ChecksResult }>(`/api/projects/${id}/checks`, { method: "POST" });
}

/**
 * POST /export → zip binary. Distinct from request<T>: consumes the body as a
 * Blob instead of JSON; non-2xx and network failures normalize to ApiError.
 */
export async function exportProject(id: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`/api/projects/${id}/export`, { method: "POST" });
  } catch {
    throw new ApiError(0, "无法连接本地服务（127.0.0.1:8787）");
  }
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.blob();
}

/**
 * POST /export/ui-png → zip of the three-viewport screenshots (W1-D). The
 * server regenerates code from the STORED document, so callers must save
 * first (saveBeforeExport). Error bodies carry a Chinese "message" field
 * (project_type_mismatch / screenshots_unavailable), surfaced like importPptx.
 */
export async function exportUiPng(id: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`/api/projects/${id}/export/ui-png`, { method: "POST" });
  } catch {
    throw new ApiError(0, "无法连接本地服务（127.0.0.1:8787）");
  }
  if (!res.ok) {
    const raw = await res.text();
    let detail = raw;
    try {
      const body = JSON.parse(raw) as { message?: string };
      if (body.message) detail = body.message;
    } catch {
      // non-JSON error body: keep the raw text
    }
    throw new ApiError(res.status, detail);
  }
  return res.blob();
}

/**
 * POST /export/ui-pdf?mode=single → PDF of the first page (W3 debt OP-5).
 * Mirrors exportUiPng: the server renders from the STORED document, so
 * callers must save first (saveBeforeExport); error bodies carry a Chinese
 * "message" field surfaced as ApiError like every other blob endpoint.
 */
export async function exportUiPdf(id: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`/api/projects/${id}/export/ui-pdf?mode=single`, { method: "POST" });
  } catch {
    throw new ApiError(0, "无法连接本地服务（127.0.0.1:8787）");
  }
  if (!res.ok) {
    const raw = await res.text();
    let detail = raw;
    try {
      const body = JSON.parse(raw) as { message?: string };
      if (body.message) detail = body.message;
    } catch {
      // non-JSON error body: keep the raw text
    }
    throw new ApiError(res.status, detail);
  }
  return res.blob();
}
