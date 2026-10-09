export type TaskKind = "import" | "export" | "preview" | "inspection";
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "unavailable";

export interface ArtifactRecord {
  id: string;
  taskId: string;
  mediaType: string;
  relativePath: string;
  label: string;
}

export interface TaskLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface TaskResult {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  logs: TaskLogEntry[];
  artifacts: ArtifactRecord[];
  requiresConfirmation: boolean;
  unavailableReason?: string;
}
