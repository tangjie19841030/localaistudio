import type { ProjectType } from "@studio/studio-core";
import type { StudioDocument } from "./document.js";
import { z } from "zod";

/** zod 的 url() 会放行 javascript:/data: 等伪协议；这里收紧为仅 http(s)。两个 Schema 必须保持一致。 */
const httpUrl = z.string().url().refine((v) => /^https?:\/\//i.test(v), "仅支持 http(s) 链接");

// P7.2：创建请求声明一级项目类型。默认 "ui" 保证未改动的旧调用方行为不变；
// "ppt"/"word" 由 server 按 builtin registry 校验（未注册类型创建被拒），zod 只管形状。
const projectTypeField = z.enum(["ui", "ppt", "word"]).default("ui");

export const createProjectInputSchema = z.object({
  name: z.string().min(1).max(60),
  productType: z.string().max(60).default(""),
  targetUsers: z.string().max(200).default(""),
  goal: z.string().max(500).default(""),
  referenceLinks: z.array(httpUrl).max(10).default([]),
  brandRules: z.string().max(500).default(""),
  projectType: projectTypeField,
});

export type NewProjectInput = z.infer<typeof createProjectInputSchema>;
/** 解析前形态（projectType 可缺省→默认 ui）。store 的 create 入参用这个，容忍旧调用方。 */
export type NewProjectInputBody = z.input<typeof createProjectInputSchema>;

/**
 * 读取策略（有意为之）：project.json 是程序写入的镜像格式，本 Schema 严格校验、
 * 不做默认值自愈——新增字段时需同步迁移旧文件；损坏文件在服务层表现为"元数据损坏"并跳过。
 * 注意：.datetime() 拒绝带时区偏移的时间串（+08:00）；本仓库所有写入方都用 toISOString()。
 * P7.2 例外：projectType/toolkitId 是"新增即写入、旧文件缺省"的向后兼容字段——
 * 缺省视为 legacy ui（与 server 的 project-format 降级读一致）。
 */
export const projectMetaSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(60),
  productType: z.string().max(60),
  targetUsers: z.string().max(200),
  goal: z.string().max(500),
  referenceLinks: z.array(httpUrl).max(10),
  brandRules: z.string().max(500),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  projectType: projectTypeField,
  /** V2 起记录归属工具包；legacy 文件缺省。 */
  toolkitId: z.string().min(1).optional(),
});

export type ProjectMeta = z.infer<typeof projectMetaSchema>;
export type ProjectBundleType = ProjectMeta["projectType"];

export function newProjectId(): string {
  return crypto.randomUUID();
}

export function newProjectMeta(input: NewProjectInputBody): ProjectMeta {
  const data = createProjectInputSchema.parse(input); // 运行时兜底：即使调用方绕过路由也保证合法
  const now = new Date().toISOString();
  const { projectType, ...rest } = data;
  return { ...rest, id: newProjectId(), projectType, createdAt: now, updatedAt: now };
}

/** 服务端磁盘 bundle 与工作台客户端共用的项目数据包（meta + 当前文档） */
export interface ProjectBundle {
  meta: ProjectMeta;
  document: StudioDocument;
}
