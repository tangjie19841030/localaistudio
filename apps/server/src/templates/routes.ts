import type { Hono } from "hono";
import { TEMPLATES } from "@studio/schema-core";
import { readSettings } from "../store/settings.js";
import { getProvider, type ChatProvider } from "../ai/provider.js";
import {
  listSourceIds,
  listTemplateRecords,
  readBlockSource,
  readTemplateRecord,
  writeTemplateRecord,
} from "./store.js";
import { convertBlock } from "./converter.js";
import type { TemplateRecord } from "./store.js";

export interface TemplateRoutesDeps {
  dataDir: string;
  /** Test seam: override the settings-derived provider (real conversion in tests). */
  provider?: ChatProvider;
}

/** Gallery response: lightweight record without the full document tree. */
function galleryItem(rec: TemplateRecord) {
  return {
    id: rec.id,
    name: rec.name,
    category: rec.category,
    description: rec.description,
    source: rec.source,
    // The document is sent so the gallery can render a live Schema preview.
    document: rec.document,
  };
}

/** Human-readable gallery name/category from a source id when no record exists yet. */
function pendingMetaOf(sourceId: string): { name: string; category: string } {
  if (sourceId.startsWith("login")) return { name: `登录页（${sourceId}）`, category: "认证" };
  if (sourceId.startsWith("signup")) return { name: `注册页（${sourceId}）`, category: "认证" };
  if (sourceId.startsWith("dashboard")) return { name: `数据看板（${sourceId}）`, category: "数据看板" };
  if (sourceId.startsWith("chart-")) return { name: `图表（${sourceId}）`, category: "数据可视化" };
  return { name: `应用框架（${sourceId}）`, category: "管理后台" };
}

export function registerTemplateRoutes(app: Hono, deps: TemplateRoutesDeps): void {
  /** Schema-core built-in templates as gallery items (instant, no import needed). */
  const builtinItems = TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
    source: "内置模板",
    document: t.build(t.name),
  }));

  /** GET /api/templates — gallery list: builtins + converted records + pending sources. */
  app.get("/api/templates", async (c) => {
    const records = await listTemplateRecords(deps.dataDir);
    const converted = records.map(galleryItem);
    const convertedIds = new Set(converted.map((r) => r.id));
    const sources = await listSourceIds(deps.dataDir);
    const pending = sources
      .filter((id) => !convertedIds.has(id))
      .map((id) => ({ id, ...pendingMetaOf(id) }));
    return c.json({ templates: [...builtinItems, ...converted, ...pending] });
  });

  /** GET /api/templates/:id — full record incl. validated document (for single preview). */
  app.get("/api/templates/:id", async (c) => {
    const id = c.req.param("id");
    const rec = await readTemplateRecord(deps.dataDir, id);
    if (!rec) return c.json({ error: "not_found" }, 404);
    return c.json(galleryItem(rec));
  });

  /**
   * POST /api/templates/import — convert a downloaded source block into the
   * registry. ALWAYS goes through the real AI conversion (convertBlock);
   * conversion failure is an explicit 422 and nothing fake is persisted.
   * (Historical note: a mock-provider seed shortcut once silently filled the
   * registry with identical placeholder templates — removed, never reintroduce.)
   */
  app.post("/api/templates/import", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const id = (raw as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || id === "") {
      return c.json({ error: "invalid_body" }, 400);
    }

    // Source must exist before any provider decision (unknown id → 404,
    // matching the project API convention: existence precedes body logic).
    let bundle: string;
    try {
      ({ bundle } = await readBlockSource(deps.dataDir, id));
    } catch {
      return c.json({ error: "source_not_found", message: `未找到源码文件 ${id}.json` }, 404);
    }

    const settings = await readSettings(deps.dataDir);
    const provider = deps.provider ?? getProvider(settings);
    const outcome = await convertBlock(provider, id, bundle);
    if (!outcome.ok) {
      return c.json({ error: "convert_failed", message: outcome.errors }, 422);
    }
    const meta = pendingMetaOf(id);
    // The model often names similar pages identically ("登录页" ×5); suffix a
    // colliding gallery name with the source id so every card stays distinct.
    const taken = new Set((await listTemplateRecords(deps.dataDir)).map((r) => r.name));
    const baseName = outcome.document.name || meta.name;
    const record: TemplateRecord = {
      id,
      name: taken.has(baseName) ? `${baseName}（${id}）` : baseName,
      category: meta.category,
      description: "由 AI 从开源页面源码转换的可编辑 Schema 模板",
      source: "shadcn/ui (MIT)",
      document: outcome.document,
      importedAt: Date.now(),
    };
    await writeTemplateRecord(deps.dataDir, record);
    return c.json({ ok: true, template: galleryItem(record) });
  });
}