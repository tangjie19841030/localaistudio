import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { DocumentEnvelope, ToolKit, ToolKitRegistry } from "@studio/studio-core";
import {
  checkStudioDocument,
  newProjectMeta,
  projectMetaSchema,
  validateDocument,
  type NewProjectInputBody,
  type StudioDocument,
  type ProjectMeta,
} from "@studio/schema-core";
import { createBuiltinToolKitRegistry } from "../toolkits/builtin-registry.js";
import { atomicWriteJson } from "./atomic.js";
import {
  FORMAT_VERSION,
  ProjectFormatError,
  parseFormatKeys,
  readCurrentDocument,
  writeEnvelope,
  type CurrentDocument,
  type DocumentSource,
} from "../toolkits/project-format.js";

export type { ProjectBundle } from "@studio/schema-core"; // 向后兼容既有导入方（UI 文档包）
export type { DocumentSource };

export class StoreError extends Error {}
export class NotFoundError extends StoreError {}
export class PathError extends StoreError {}

export class DocumentInvalidError extends StoreError {
  constructor(public issues: string[]) {
    super(`文档结构校验失败: ${issues.join("; ")}`);
  }
}

/** 项目类型存在但当前 server 未注册其工具包（注册表缺项时仍可能触发）。 */
export class UnsupportedProjectTypeError extends StoreError {
  constructor(public readonly projectType: string) {
    super(`项目类型 ${projectType} 暂不可用：未注册对应的工具包`);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How a project's document is laid out on disk（P7.2 判别联合）。 */
export interface DocumentFormatInfo {
  source: DocumentSource;
  toolkitId: string;
}

/** 写侧载荷：meta + per-toolkit 文档（未知类型在 toolkit.parse 处被拒）。 */
export interface ProjectSaveInput {
  meta: ProjectMeta;
  document: unknown;
}

/**
 * Server-side bundle: `document` is the per-toolkit domain document
 * (StudioDocument / PptDocument / WordDocument); the API JSON shape stays
 * `{ meta, document }` for every project type.
 */
export interface StoredProjectBundle {
  meta: ProjectMeta;
  document: unknown;
}

export interface ProjectsStore {
  /** Root dir holding all project folders; version storage layers on top of it. */
  readonly baseDir: string;
  list(): Promise<ProjectMeta[]>;
  create(input: NewProjectInputBody): Promise<StoredProjectBundle>;
  read(id: string): Promise<StoredProjectBundle>;
  /** 仅确认项目存在（meta 可读且 ID 一致）；不读文档。用于路由的存在性预检。 */
  exists(id: string): Promise<void>;
  /** 文档落盘格式与归属工具包（P7.2）；版本存储按它选目录。 */
  formatInfo(id: string): Promise<DocumentFormatInfo>;
  /** V2 项目的当前信封（头部为权威值）；legacy 项目返回 null。 */
  currentEnvelope(id: string): Promise<DocumentEnvelope | null>;
  /** 当前文档（per-toolkit 校验后的领域文档）；供需要领域类型的调用方复用存在性读。 */
  readDocument(id: string): Promise<unknown>;
  /** 仅读 meta.projectType（不读文档）；路由层按它分派 document 校验器。 */
  readMetaProjectType(id: string): Promise<ProjectMeta["projectType"]>;
  save(id: string, data: ProjectSaveInput): Promise<StoredProjectBundle>;
  remove(id: string): Promise<void>;
}

/** Path-traversal guard: project ids are used as directory names, so only UUIDs pass. */
export function assertSafeId(id: string): string {
  if (!UUID_RE.test(id)) {
    throw new PathError(`非法项目 ID: "${id}"`);
  }
  return id;
}

interface MetaWithFormat {
  meta: ProjectMeta;
  toolkitId: string;
  source: DocumentSource;
}

export function createProjectsStore(
  baseDir: string,
  registry: ToolKitRegistry = createBuiltinToolKitRegistry(),
): ProjectsStore {
  const projectDir = (id: string) => join(baseDir, assertSafeId(id));
  const metaFile = (id: string) => join(projectDir(id), "project.json");
  const legacyDocFile = (id: string) => join(projectDir(id), "design", "document.json");

  /** 已注册类型返回其 toolkit；未注册类型统一抛 UnsupportedProjectTypeError。 */
  function requireToolkit(projectType: ProjectMeta["projectType"]): ToolKit {
    try {
      return registry.getForProjectType(projectType);
    } catch {
      throw new UnsupportedProjectTypeError(projectType);
    }
  }

  function assertMetaId(meta: ProjectMeta, id: string): void {
    // Task 3 审查采纳：手工改名的目录不得成为"幽灵项目"（列表可见、打开 404）
    if (meta.id !== id) {
      throw new StoreError(`项目目录与元数据 ID 不一致: 目录 ${id}，元数据声明的 ID 为 ${meta.id}`);
    }
  }

  /** 读 project.json：ENOENT→404 语义，损坏 JSON/Schema→元数据损坏，PathError 原样透传。 */
  async function readMetaWithFormat(id: string): Promise<MetaWithFormat> {
    let raw: string;
    try {
      raw = await fs.readFile(metaFile(id), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundError(`项目不存在: ${id}`);
      }
      if (err instanceof StoreError) throw err; // 保留 assertSafeId 抛出的 PathError
      throw new StoreError(`项目元数据损坏: ${id}`, { cause: err });
    }
    const keys = parseFormatKeys(raw); // 格式键解析失败同属元数据损坏
    const meta = projectMetaSchema.parse(JSON.parse(raw)); // projectType 缺省回填 ui
    assertMetaId(meta, id);
    const toolkitId = keys.toolkitId ?? `builtin.${keys.projectType}`;
    const source: DocumentSource = keys.formatVersion === FORMAT_VERSION ? "v2" : "legacy";
    return { meta, toolkitId, source };
  }

  async function writeMeta(raw: ProjectMeta): Promise<void> {
    await atomicWriteJson(metaFile(raw.id), raw);
  }

  async function writeLegacyDoc(id: string, doc: StudioDocument): Promise<void> {
    await atomicWriteJson(legacyDocFile(id), doc);
  }

  /** 读当前文档：损坏/缺失映射为既有 404/损坏语义；legacy 文档包装为 toolkit 信封视图。 */
  async function readDoc(id: string, info: MetaWithFormat): Promise<unknown> {
    let current: CurrentDocument;
    try {
      current = await readCurrentDocument(projectDir(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundError(`项目文档不存在: ${id}`);
      }
      if (err instanceof StoreError) throw err;
      throw new StoreError(`项目文档损坏: ${id}`, { cause: err });
    }
    try {
      const toolkit = registry.get(info.meta.projectType, info.toolkitId);
      const envelope = envelopeView(toolkit, current, info);
      return toolkit.document.parse(envelope).document;
    } catch (err) {
      if (err instanceof StoreError) throw err;
      throw new StoreError(`项目文档损坏: ${id}`, { cause: err });
    }
  }

  /** V2 save 修复路径的信封头部重建：toolkit 身份取自 meta，documentVersion 从 0 起算。 */
  function rebuiltEnvelope(info: MetaWithFormat): DocumentEnvelope {
    const toolkit = registry.get(info.meta.projectType, info.toolkitId);
    return {
      format: "studio-document",
      coreVersion: 1,
      projectType: info.meta.projectType,
      toolkitId: toolkit.id,
      toolkitVersion: toolkit.version,
      documentVersion: 0,
      document: null,
    };
  }

  /** legacy 裸文档读时包一层 toolkit 信封视图（不写盘）；V2 文档直接用其信封。 */
  function envelopeView(toolkit: ToolKit, current: CurrentDocument, info: MetaWithFormat): DocumentEnvelope {
    if (current.source === "v2" && current.envelope) {
      // ppt/word 的 adapter 把信封 documentVersion 钉在领域 schema 版本上
      //（UI 则把信封 documentVersion 用作 save 修订号）——读取视图按领域文档
      // 自身的 documentVersion 字段重盖，保证 adapter.parse 通过。
      if (info.meta.projectType !== "ui") {
        return { ...current.envelope, documentVersion: domainDocVersion(current.document) };
      }
      return current.envelope;
    }
    return {
      format: "studio-document",
      coreVersion: 1,
      projectType: info.meta.projectType,
      toolkitId: toolkit.id,
      toolkitVersion: toolkit.version,
      documentVersion: 1,
      document: current.document,
    };
  }

  /** 领域文档自身的 schema 版本号；缺失/非法时按 1 兜底（legacy 视图同值）。 */
  function domainDocVersion(document: unknown): number {
    const v = (document as { documentVersion?: unknown } | null)?.documentVersion;
    return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : 1;
  }

  /**
   * V2 save 专用的当前信封读取：读不到（损坏/缺失/仅剩 legacy 视图）不抛错——
   * PUT 重存是既定的崩溃窗口修复入口（Task 6 审查语义），头部由 meta + toolkit
   * 重建，documentVersion 重新从 1 起算。
   */
  async function readEnvelopeForRepair(projectDir: string): Promise<DocumentEnvelope | null> {
    try {
      return (await readCurrentDocument(projectDir)).envelope;
    } catch (err) {
      if (err instanceof ProjectFormatError) return null; // 损坏 → 重存修复
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null; // 缺失 → 重存修复
      throw err;
    }
  }

  /**
   * 写侧校验（per-toolkit）：按项目 meta 的 projectType 取 toolkit，UI 走
   * schema-core validate+check（与既有 422 契约一致），ppt/word 走各 toolkit
   * 的 adapter.parse（信封视图 → zod 全量校验 + 结构检查）。
   * 校验失败统一映射为 DocumentInvalidError（路由层 422 document_invalid）。
   */
  function validateForSave(projectType: ProjectMeta["projectType"], document: unknown): unknown {
    if (projectType !== "ui") {
      const toolkit = requireToolkit(projectType);
      try {
        return toolkit.document.parse({
          format: "studio-document",
          coreVersion: 1,
          projectType,
          toolkitId: toolkit.id,
          toolkitVersion: toolkit.version,
          documentVersion: 1,
          document,
        }).document;
      } catch (err) {
        throw new DocumentInvalidError(zodIssueLines(err));
      }
    }
    const doc = validateDocument(document);
    const issues = checkStudioDocument(doc);
    if (issues.length > 0) {
      throw new DocumentInvalidError(issues);
    }
    return doc;
  }

  /** zod/结构错误归一为 issue 行（"path: message"），非 zod 错误取 message。 */
  function zodIssueLines(err: unknown): string[] {
    if (err && typeof err === "object" && "issues" in err && Array.isArray(err.issues)) {
      return (err.issues as { path: PropertyKey[]; message: string }[]).map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      );
    }
    return [String((err as Error)?.message ?? err)];
  }

  return {
    baseDir,

    async list() {
      await fs.mkdir(baseDir, { recursive: true });
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      const metas: ProjectMeta[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          metas.push((await readMetaWithFormat(entry.name)).meta);
        } catch (err) {
          // Task 3 审查采纳：跳过无法读取的目录保证列表可用，但留一条可见线索
          console.warn(`[server] 跳过无法读取的项目目录: ${entry.name}（${(err as Error).message}）`);
        }
      }
      metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return metas;
    },

    async create(input) {
      const meta = newProjectMeta(input);
      const toolkit = requireToolkit(meta.projectType);
      const envelope = toolkit.document.createEmpty(meta.name);
      // V2 增补字段：projectType/toolkitId/formatVersion（project.json 为自由键镜像格式）
      const metaOnDisk = {
        ...meta,
        projectType: toolkit.projectType,
        toolkitId: toolkit.id,
        formatVersion: FORMAT_VERSION,
      } as ProjectMeta;
      // 写序：doc 先于 meta——崩溃窗口下宁可留下“无 meta 的目录”（list 跳过+告警）
      // 也不留“list 可见但 read 404 的幽灵”。
      await writeEnvelope(projectDir(meta.id), envelope);
      await writeMeta(metaOnDisk);
      return { meta: metaOnDisk, document: envelope.document };
    },

    async read(id) {
      const info = await readMetaWithFormat(id);
      return { meta: info.meta, document: await readDoc(id, info) };
    },

    async readDocument(id) {
      const info = await readMetaWithFormat(id);
      return readDoc(id, info);
    },

    async readMetaProjectType(id) {
      return (await readMetaWithFormat(id)).meta.projectType;
    },

    async exists(id) {
      await readMetaWithFormat(id); // PathError/NotFoundError/损坏语义与 read 一致
    },

    async formatInfo(id) {
      const info = await readMetaWithFormat(id);
      return { source: info.source, toolkitId: info.toolkitId };
    },

    async currentEnvelope(id) {
      const info = await readMetaWithFormat(id);
      if (info.source !== "v2") return null;
      const current = await readCurrentDocument(projectDir(id));
      return current.envelope;
    },

    async save(id, data) {
      const info = await readMetaWithFormat(id); // 确认项目存在，createdAt 的权威来源
      const meta: ProjectMeta = projectMetaSchema.parse({
        ...data.meta,
        id,
        createdAt: info.meta.createdAt, // 服务端保留，不信任客户端
        updatedAt: new Date().toISOString(),
      });
      if (meta.projectType !== info.meta.projectType) {
        // meta 上的 projectType 只是声明——保存不得偷换项目类型（文档格式/目录语义都会漂移）
        throw new StoreError(`项目类型不可变更: 磁盘为 ${info.meta.projectType}，请求声明 ${meta.projectType}`);
      }
      const doc = validateForSave(info.meta.projectType, data.document); // 写侧 per-toolkit 校验
      if (info.source === "legacy") {
        // legacy：写路径不变（design/document.json），不迁移格式、不递增信封版本。
        // meta 由 projectMetaSchema strip 模式解析——客户端伪造的 formatVersion 已被剥除。
        await writeLegacyDoc(id, doc as StudioDocument);
        await writeMeta(meta);
        return { meta, document: doc };
      }
      // V2：documentVersion 是 save 修订号，每次保存 +1（UI 语义，P7.2）。信封头部由
      // store 维护——不经过 toolkit.parse（UI adapter 的 schema 版本钉在 document.documentVersion 上；
      // ppt/word 的读取视图另按领域版本重盖，见 envelopeView）。
      // 崩溃窗口语义：文档损坏/缺失时重存可修复——头部退化由 meta + toolkit 重建。
      const previous =
        (await readEnvelopeForRepair(projectDir(id))) ?? rebuiltEnvelope(info);
      const next: DocumentEnvelope = {
        ...previous,
        document: doc,
        documentVersion: previous.documentVersion + 1,
      };
      const metaOnDisk = {
        ...meta,
        projectType: info.meta.projectType,
        toolkitId: info.toolkitId,
        formatVersion: FORMAT_VERSION,
      } as ProjectMeta;
      await writeEnvelope(projectDir(id), next); // doc 先写（见写序注释）
      await writeMeta(metaOnDisk);
      return { meta: metaOnDisk, document: doc };
    },

    async remove(id) {
      await readMetaWithFormat(id); // 不存在则 404
      await fs.rm(projectDir(id), { recursive: true, force: true });
    },
  };
}
