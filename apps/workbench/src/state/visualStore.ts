import { create } from "zustand";
import type { ViewportName } from "@studio/schema-core";
import { ApiError } from "../api/client";
import { visualApi, type VisualRunResult } from "../api/visual";
import { log } from "./logStore";

export type VisualRunState = "idle" | "running" | "error";

export interface VisualState {
  /** Local quality-check pipeline state (POST /screenshots drives Playwright). */
  runState: VisualRunState;
  /** Most recent successful run (source of the shots + issue list on screen). */
  currentRun: VisualRunResult | null;
  /** Run history, createdAt desc; a fresh run is prepended. */
  runs: VisualRunResult[];
  /** Viewport whose screenshot is displayed (spec §7.4 three viewports). */
  selectedViewport: ViewportName;
  error: string | null;

  run(projectId: string): Promise<void>;
  loadRuns(projectId: string): Promise<void>;
  selectViewport(v: ViewportName): void;
  clear(): void;
}

/** Turn a thrown value into user-facing Chinese for known local-check errors. */
function messageOf(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) {
    if (err.message.includes("not_generated")) return "请先生成代码再执行本地质检";
    if (err.message.includes("preview_not_running")) {
      return "请先启动本地项目预览，再运行本地质检";
    }
  }
  return err instanceof Error ? err.message : String(err);
}

export const useVisualStore = create<VisualState>()((set, get) => ({
  runState: "idle",
  currentRun: null,
  runs: [],
  selectedViewport: "desktop",
  error: null,

  async run(projectId) {
    if (get().runState === "running") return;
    set({ runState: "running", error: null });
    log("info", "visual", "开始本地质检（三视口）…");
    try {
      const result = await visualApi.runCheck(projectId);
      set({
        runState: "idle",
        currentRun: result,
        // Prepend: server returns history createdAt desc, so newest goes first.
        runs: [result, ...get().runs.filter((r) => r.runId !== result.runId)],
        error: null,
      });
      const summary = result.summary;
      log(
        summary && summary.total > 0 ? "warn" : "success",
        "visual",
        summary ? `本地质检完成：${summary.total} 项问题（错误 ${summary.errorCount} / 警告 ${summary.warnCount}）` : "本地质检完成：无问题",
      );
    } catch (err) {
      set({ runState: "error", error: messageOf(err) });
      log("error", "visual", `本地质检失败：${messageOf(err)}`);
    }
  },

  async loadRuns(projectId) {
    try {
      const runs = await visualApi.listRuns(projectId);
      // History load never flips runState: a failed load must not hide the
      // panel's action buttons, and a fresh run keeps precedence over history.
      set({ runs, currentRun: get().currentRun ?? runs[0] ?? null });
    } catch {
      // Silent: an empty/failed history is not a user-actionable error here.
    }
  },

  selectViewport(v) {
    set({ selectedViewport: v });
  },

  clear() {
    set({
      runState: "idle",
      currentRun: null,
      runs: [],
      selectedViewport: "desktop",
      error: null,
    });
  },
}));
