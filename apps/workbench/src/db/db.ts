import Dexie, { type EntityTable } from "dexie";
import type { StudioDocument, ProjectMeta } from "@studio/schema-core";
import type { EditorDocument } from "../state/editorStore";
import type { ChatLogMessage } from "../features/ai/types";

export interface DocumentRecord {
  projectId: string;
  /** P7.3: per-toolkit 领域文档（UI/PPT/Word 联合；仅镜像存储，不改 Dexie 键结构）。 */
  document: EditorDocument;
  updatedAt: string;
}

export interface DocumentVersion {
  versionId: string;
  projectId: string;
  name: string;
  document: StudioDocument;
  createdAt: string;
}

/**
 * W1-B: one persisted AI chat session (terminal state of a turn chain).
 * `messages` is the pruned ChatLogMessage[] (images→thumbnail refs, toolTrace
 * truncated); title derives from the first user message (≤80 chars).
 */
export interface SessionRecord {
  sessionId: string;
  projectId: string;
  title: string;
  messages: ChatLogMessage[];
  createdAt: string;
  updatedAt: string;
}

export class StudioDb extends Dexie {
  projects!: EntityTable<ProjectMeta, "id">;
  // 注意：documents 以 projectId 为主键（每项目一份当前文档）。Dexie 无法在后续版本
  // 变更既有表的主键——未来引入聊天记录等时需要新表 + 数据迁移，而非改键。
  documents!: EntityTable<DocumentRecord, "projectId">;
  // 命名版本（P1-10）：server 侧同款落盘后的本地镜像；versionId 为主键。
  versions!: EntityTable<DocumentVersion, "versionId">;
  // W1-B：AI 会话历史；sessionId 为主键，projectId 支撑按项目过滤，updatedAt 支撑倒序。
  sessions!: EntityTable<SessionRecord, "sessionId">;

  constructor(name = "studio-db") {
    super(name);
    this.version(1).stores({
      projects: "id, updatedAt",
      documents: "projectId",
    });
    // v2 迁移：仅新增 versions 表，v1 表结构原样保留（Dexie 惯例——
    // 已发布的 schema 版本不可回改，演进只追加新版本声明）。
    this.version(2).stores({
      projects: "id, updatedAt",
      documents: "projectId",
      versions: "versionId, projectId, createdAt",
    });
    // v3 迁移（W1-B）：仅追加 sessions 表，v1/v2 表结构原样保留（同 v2 惯例）。
    this.version(3).stores({
      projects: "id, updatedAt",
      documents: "projectId",
      versions: "versionId, projectId, createdAt",
      sessions: "sessionId, projectId, updatedAt",
    });
  }
}

export const db = new StudioDb();
