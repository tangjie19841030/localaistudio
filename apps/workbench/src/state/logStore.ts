import { create } from "zustand";

export type LogLevel = "info" | "success" | "error" | "warn";
export type LogSource = "ai" | "codegen" | "preview" | "export" | "visual" | "system";

export interface LogEntry {
  id: string;
  /** Epoch ms, for the timestamp column (monospace). */
  ts: number;
  level: LogLevel;
  source: LogSource;
  message: string;
}

export interface LogState {
  entries: LogEntry[];
  clear(): void;
}

/** Keep the ring small so the dock stays snappy and memory bounded. */
const MAX_LOGS = 200;

let seq = 0;

export const useLogStore = create<LogState>()((set) => ({
  entries: [],
  clear() {
    set({ entries: [] });
  },
}));

/**
 * Append one entry. Module-level function (not a hook) so every store action
 * can emit logs without going through React — the single source of truth for
 * the bottom dock "运行日志" tab.
 */
export function log(level: LogLevel, source: LogSource, message: string): void {
  const entry: LogEntry = {
    id: `log-${++seq}-${Date.now()}`,
    ts: Date.now(),
    level,
    source,
    message,
  };
  useLogStore.setState((s) => ({
    entries: [...s.entries.slice(-(MAX_LOGS - 1)), entry],
  }));
}

/** Human-readable source label for the log table. */
export const SOURCE_LABEL: Record<LogSource, string> = {
  ai: "AI",
  codegen: "代码生成",
  preview: "预览",
  export: "导出",
  visual: "本地质检",
  system: "系统",
};
