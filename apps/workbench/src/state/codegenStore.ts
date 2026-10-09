import { create } from "zustand";
import type { StudioDocument } from "@studio/schema-core";
import {
  codegenApi,
  exportProject,
  runChecks,
  startPreview,
  stopPreview,
  type ChecksResult,
} from "../api/client";
import { log } from "./logStore";

export type GenerateState = "idle" | "generating" | "done" | "error";
export type PreviewState = "idle" | "starting" | "running" | "error";
export type ExportState = "idle" | "checking" | "confirm" | "downloading" | "done" | "error";

export interface CodegenState {
  /** Generate pipeline state (POST /generate writes files to disk). */
  generateState: GenerateState;
  generatedFiles: string[];
  /** Hand-edited files overwritten by the last generate (A3 visibility). */
  handEditedFiles: string[];
  /** JSON snapshot of the document as it was at the last successful generate;
   * the "old" side of the document Diff (spec §8: regen diff is in-memory). */
  lastGeneratedDocJson: string | null;
  /** File selected in the Diff tab file list (null → none). */
  selectedFile: string | null;
  /** Isolated vite preview lifecycle (POST /preview/start|stop). */
  previewState: PreviewState;
  previewPort: number | null;
  /** Pre-export checks result (spec §6.3: failed checks still allow export). */
  checks: ChecksResult | null;
  exportState: ExportState;
  error: string | null;

  /** Returns true when generation succeeded (false on error, already surfaced). */
  generate(projectId: string, docJson?: string): Promise<boolean>;
  selectFile(path: string | null): void;
  startPreview(projectId: string): Promise<void>;
  /** ProjectPreview entry: re-generate the current editor document before
   * starting vite so the preview never serves stale artifacts. A failed
   * generate skips the start (its error is already in state). */
  generateAndStartPreview(projectId: string, docJson?: string): Promise<void>;
  stopPreview(projectId: string): Promise<void>;
  /** Checks → download when ok; checks failure parks in "confirm" until the
   * user explicitly clicks "仍然导出" (spec §6.3 export gate). force skips the
   * re-run of checks (they already failed; the user accepted that). */
  runExport(projectId: string, opts?: { force?: boolean }): Promise<void>;
  clear(): void;
}

export const useCodegenStore = create<CodegenState>()((set, get) => ({
  generateState: "idle",
  generatedFiles: [],
  handEditedFiles: [],
  lastGeneratedDocJson: null,
  selectedFile: null,
  previewState: "idle",
  previewPort: null,
  checks: null,
  exportState: "idle",
  error: null,

  async generate(projectId, docJson): Promise<boolean> {
    if (get().generateState === "generating") return false;
    set({ generateState: "generating", error: null });
    log("info", "codegen", "开始生成代码…");
    try {
      const { files, handEdited } = await codegenApi.generateProject(projectId, docJson ? (JSON.parse(docJson) as StudioDocument) : undefined);
      set({
        generateState: "done",
        generatedFiles: files,
        handEditedFiles: handEdited ?? [],
        // Caller passes the current document JSON; the snapshot is only frozen
        // on success so a failed generate keeps the previous diff baseline.
        lastGeneratedDocJson: docJson ?? get().lastGeneratedDocJson,
      });
      log("success", "codegen", `代码生成完成（${files.length} 个文件）`);
      if (handEdited && handEdited.length > 0) {
        log(
          "warn",
          "codegen",
          `已覆盖 ${handEdited.length} 个手改文件：${handEdited.join("、")}`,
        );
      }
      return true;
    } catch (err) {
      set({
        generateState: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      log("error", "codegen", `代码生成失败：${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  },

  selectFile(path) {
    set({ selectedFile: path });
  },

  async startPreview(projectId) {
    if (get().previewState === "starting" || get().previewState === "running") return;
    set({ previewState: "starting", error: null });
    log("info", "preview", "启动预览…（首次需安装依赖）");
    try {
      const { port } = await startPreview(projectId);
      set({ previewState: "running", previewPort: port });
      log("success", "preview", `预览已启动：http://127.0.0.1:${port}`);
    } catch (err) {
      set({
        previewState: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      log("error", "preview", `预览启动失败：${err instanceof Error ? err.message : String(err)}`);
    }
  },

  async generateAndStartPreview(projectId, docJson) {
    if (get().previewState === "starting" || get().previewState === "running") return;
    const ok = await get().generate(projectId, docJson);
    if (!ok) return; // generate already surfaced the error; don't start stale files
    await get().startPreview(projectId);
  },

  async stopPreview(projectId) {
    if (get().previewState !== "running") return;
    try {
      await stopPreview(projectId);
      log("info", "preview", "预览已停止");
    } finally {
      // Even a failed stop leaves the UI consistent: server stop is idempotent.
      set({ previewState: "idle", previewPort: null });
    }
  },

  async runExport(projectId, opts) {
    const { exportState } = get();
    if (exportState === "checking" || exportState === "downloading") return;
    if (opts?.force) {
      // "仍然导出": checks already failed and the user accepted — go download.
      await downloadZip(projectId, set);
      return;
    }
    set({ exportState: "checking", checks: null, error: null });
    log("info", "export", "运行导出前检查…");
    let checks: ChecksResult;
    try {
      checks = (await runChecks(projectId)).checks;
    } catch (err) {
      set({
        exportState: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      log("error", "export", `导出前检查失败：${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    set({ checks });
    if (!checks.ok) {
      set({ exportState: "confirm" }); // user must confirm "仍然导出"
      log("warn", "export", `检查未通过（${checks.errors.length} 项），等待确认`);
      return;
    }
    log("success", "export", "检查通过，开始导出");
    await downloadZip(projectId, set);
  },

  clear() {
    set({
      generateState: "idle",
      generatedFiles: [],
      handEditedFiles: [],
      lastGeneratedDocJson: null,
      selectedFile: null,
      previewState: "idle",
      previewPort: null,
      checks: null,
      exportState: "idle",
      error: null,
    });
  },
}));

type SetState = (partial: Partial<CodegenState>) => void;

/** Fetch the zip and trigger a browser download via a temporary anchor. */
async function downloadZip(projectId: string, set: SetState): Promise<void> {
  set({ exportState: "downloading" });
  try {
    const blob = await exportProject(projectId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `project-${projectId.slice(0, 8)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    set({ exportState: "done" });
    log("success", "export", "已导出 zip 并触发下载");
  } catch (err) {
    set({
      exportState: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    log("error", "export", `导出失败：${err instanceof Error ? err.message : String(err)}`);
  }
}
