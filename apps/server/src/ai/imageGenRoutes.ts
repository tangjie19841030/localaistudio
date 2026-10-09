import type { Context, Hono } from "hono";
import { z } from "zod";
import type { ProjectsStore } from "../store/projects.js";
import { NotFoundError, PathError, StoreError } from "../store/projects.js";
import { readSettings } from "../store/settings.js";
import { projectTypeMismatch } from "../toolkits/export-shared.js";
import { PptAssetError, saveProjectImage } from "../toolkits/ppt/assets.js";
import {
  createImageGenerator,
  type ImageGenError,
  type ImageGenerator,
} from "./imageGen.js";

/**
 * U7 image generation route (design §3.4):
 * POST /api/projects/:id/image-gen  body { prompt: 1..500, nodeId? }
 *
 * ui projects only. The generated PNG goes through the SAME content-hash
 * asset chain as ppt uploads (saveProjectImage: magic-byte sniff + sha1 +
 * jailed path), so the returned src is a normal
 * /api/projects/:id/assets/<sha>.<ext> URL that the ppt GET gate already
 * serves (extended to ui). Nothing here writes document state — the
 * workbench swaps the selected node's src in one undo step.
 *
 * The generator is a deps seam for tests ONLY: createApp never passes one,
 * so every production call builds the settings-derived real HTTP generator.
 */

const UNCONFIGURED_MESSAGE = "未配置图像生成模型，请在设置中填写图像模型名称与 API Key";

const imageGenBodySchema = z.object({
  prompt: z.string().trim().min(1, "提示词不能为空").max(500, "提示词不能超过 500 字"),
  nodeId: z.string().min(1).optional(),
});

export interface ImageGenRouteDeps {
  store: ProjectsStore;
  dataDir: string;
  /** Test seam ONLY — production (createApp) always omits this. */
  generator?: ImageGenerator;
}

/** Store errors reuse the app.ts wire mapping; unknown errors rethrow. */
function fail(c: Context, err: unknown): Response {
  if (err instanceof PathError) return c.json({ error: "invalid_id" }, 400);
  if (err instanceof NotFoundError) return c.json({ error: "not_found" }, 404);
  if (err instanceof StoreError) {
    return c.json({ error: "store_error", message: err.message }, 500);
  }
  throw err;
}

/** Typed generation failure -> status + wire body (501/502/504). */
function generationFailure(c: Context, error: ImageGenError): Response {
  if (error.kind === "not_configured" || error.kind === "no_key") {
    return c.json({ error: "image_gen_unavailable", message: UNCONFIGURED_MESSAGE }, 501);
  }
  if (error.kind === "timeout") {
    return c.json({ error: "image_gen_timeout", message: error.message }, 504);
  }
  return c.json({ error: "image_gen_failed", message: error.message }, 502);
}

/** Decode a data:image/...;base64 URL; null on any shape/encoding mismatch. */
function decodeDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  const buffer = Buffer.from(match[1]!, "base64");
  return buffer.length > 0 ? buffer : null;
}

export function registerImageGenRoutes(app: Hono, deps: ImageGenRouteDeps): void {
  app.post("/api/projects/:id/image-gen", async (c) => {
    const id = c.req.param("id") ?? "";
    try {
      const parsed = imageGenBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
        return c.json({ error: "invalid_body", issues }, 400);
      }
      // Existence/type gate before any model call: 404 beats 501 just like
      // the chat route's 404-before-stream contract.
      await deps.store.exists(id);
      const projectType = await deps.store.readMetaProjectType(id);
      if (projectType !== "ui") return projectTypeMismatch(c, projectType, "ui");

      const settings = await readSettings(deps.dataDir);
      const generator = deps.generator ?? createImageGenerator(settings);
      if (!generator.available) {
        return c.json({ error: "image_gen_unavailable", message: UNCONFIGURED_MESSAGE }, 501);
      }
      const outcome = await generator.generate(parsed.data.prompt);
      if (!outcome.ok) return generationFailure(c, outcome.error);

      const buffer = decodeDataUrl(outcome.dataUrl);
      if (!buffer) {
        return c.json(
          { error: "image_gen_failed", message: "图像模型返回了无法识别的图片数据" },
          502,
        );
      }
      // saveProjectImage re-validates magic bytes and names the file by sha1.
      const saved = await saveProjectImage(deps.store, id, buffer);
      return c.json({ src: saved.src, bytes: saved.bytes });
    } catch (err) {
      if (err instanceof PptAssetError) {
        return c.json({ error: "export_failed", message: err.message }, 500);
      }
      return fail(c, err);
    }
  });
}
