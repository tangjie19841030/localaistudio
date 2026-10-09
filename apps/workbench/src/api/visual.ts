import type { Issue, IssueSummary, ViewportName } from "@studio/schema-core";
import { ApiError } from "./client";

// Visual-check endpoints live here instead of client.ts: that file is already at
// 272/400 lines and this feature owns a self-contained slice of the API surface.
// request() below is a local twin of client.ts's private helper — same ApiError
// semantics, same normalized "无法连接本地服务" message for network failures.

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

export interface VisualShot {
  viewport: ViewportName;
  /** File name inside snapshots/<runId>/, e.g. "desktop.png". */
  file: string;
}

export interface VisualRunResult {
  runId: string;
  createdAt: string;
  /** Preview URL the shots were taken against. */
  url: string;
  issues: Issue[];
  summary: IssueSummary;
  shots: VisualShot[];
}

export const visualApi = {
  /** POST /screenshots: run the three-viewport check; 409 not_generated when no code exists yet. */
  runCheck(projectId: string): Promise<VisualRunResult> {
    return request<VisualRunResult>(`/api/projects/${projectId}/screenshots`, { method: "POST" });
  },
  /** GET /screenshots: past runs, createdAt desc. */
  listRuns(projectId: string): Promise<VisualRunResult[]> {
    return request<{ runs: VisualRunResult[] }>(`/api/projects/${projectId}/screenshots`).then(
      (d) => d.runs,
    );
  },
  /** Pure URL builder for <img src>; performs no fetch. */
  shotUrl(projectId: string, runId: string, file: string): string {
    return `/api/projects/${projectId}/screenshots/${runId}/${encodeURIComponent(file)}`;
  },
  /**
   * Read a PNG shot as a data URL, for the later "发给 AI 修复" multimodal payload.
   * Uses FileReader.readAsDataURL rather than Blob.arrayBuffer()/text(): jsdom's
   * Blob lacks reliable binary readers, while FileReader is fully implemented.
   */
  async fetchShotDataUrl(projectId: string, runId: string, file: string): Promise<string> {
    const url = visualApi.shotUrl(projectId, runId, file);
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      throw new ApiError(0, "无法连接本地服务（127.0.0.1:8787）");
    }
    if (!res.ok) throw new ApiError(res.status, await res.text());
    const blob = await res.blob();
    return await blobToDataUrl(blob);
  },
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ApiError(0, "截图读取失败"));
    reader.readAsDataURL(blob);
  });
}
