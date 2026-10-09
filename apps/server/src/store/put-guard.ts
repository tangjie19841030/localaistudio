import { z } from "zod";
import { studioDocumentSchema, projectMetaSchema } from "@studio/schema-core";
import type { ProjectSaveInput, ProjectsStore } from "./projects.js";

/** zod 的 issues 是对象数组，不可 JSON 直读；归一为 "path: message" 字符串 */
export function zodIssues(issues: { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

export interface PutGuardDeps {
  /** 路由层已 store.exists(id) 后仍需 meta.projectType；读失败按 ui 老路降级。 */
  readMetaProjectType: (id: string) => Promise<"ui" | "ppt" | "word">;
}

/**
 * PUT /api/projects/:id 的 body 校验分派（P7.3）：
 * - meta 始终用 projectMetaSchema（strip 模式，与旧行为一致）；
 * - document 按项目在磁盘上的 projectType 分派——ui 走 pageDocumentSchema
 *   快速 400（既有契约不变），ppt/word 不在路由层校验文档，交给 store.save
 *   的 toolkit.parse（失败 422 document_invalid，issues 来自各 toolkit 的
 *   zod/结构检查）。
 */
export function createPutDocumentGuard(deps: PutGuardDeps) {
  const uiBody = z.object({ meta: projectMetaSchema, document: studioDocumentSchema });
  const anyBody = z.object({ meta: projectMetaSchema, document: z.unknown() });
  return {
    async validatePut(
      id: string,
      raw: unknown,
    ): Promise<{ ok: true; data: ProjectSaveInput } | { ok: false; issues: string[] }> {
      let projectType: "ui" | "ppt" | "word";
      try {
        projectType = await deps.readMetaProjectType(id);
      } catch {
        projectType = "ui"; // 不可读按 ui 老路走；错误由 store.save 统一暴露
      }
      const parsed = (projectType === "ui" ? uiBody : anyBody).safeParse(raw);
      if (!parsed.success) {
        return { ok: false, issues: zodIssues(parsed.error.issues) };
      }
      return { ok: true, data: { meta: parsed.data.meta, document: parsed.data.document } };
    },
  };
}

/** 从 store 装配默认 guard（readMetaProjectType 只读 meta，不碰文档）。 */
export function createStorePutGuard(store: ProjectsStore) {
  return createPutDocumentGuard({ readMetaProjectType: (id) => store.readMetaProjectType(id) });
}
