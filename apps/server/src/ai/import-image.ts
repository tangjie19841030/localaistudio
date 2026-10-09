import type { Context, Hono } from "hono";
import { z } from "zod";
import { readSettings } from "../store/settings.js";
import { getProvider, type ChatProvider } from "./provider.js";
import { PayloadTooLargeError, readLimitedBody } from "../http/limitedBody.js";
import {
  MAX_ATTEMPTS,
  assembleDocument,
  convertImagePage,
  type ConvertedPage,
  type ImportMode,
} from "./import-converter.js";

/**
 * W2-A screenshot / wireframe import (T48): POST /api/ai/import-image
 *
 * Body (JSON): { images: string[] (1..4 base64 data URLs), mode?:
 * "screenshot"|"wireframe" (default screenshot), styleHint? (<=500 chars),
 * projectName? (default 导入页面) }
 *
 * 200: { document: StudioDocument v2 (one page per image), warnings: string[],
 * pages: number }. Errors: 400 invalid_body / 413 payload_too_large (40MB) /
 * 422 import_failed (every image failed, or the provider cannot take images).
 *
 * The route NEVER answers a bare 500: provider exceptions are folded into the
 * per-image retry budget, and a failed image is skipped into `warnings` while
 * the rest continue. Nothing is written to disk — the workbench saves the
 * returned document through the normal project path (same semantics as the
 * pptx import route).
 */

/** Server-side hard cap on the request body (design §4.1). */
const MAX_BODY_BYTES = 40_000_000;

export interface ImportImageRouteDeps {
  dataDir: string;
  /** Test seam: bypasses the settings-derived provider. */
  provider?: ChatProvider;
}

const dataUrl = z
  .string()
  .min(1)
  .refine((v) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(v), "必须是 base64 data URL");

export const importImageBodySchema = z.object({
  images: z.array(dataUrl).min(1).max(4),
  mode: z.enum(["screenshot", "wireframe"]).default("screenshot"),
  styleHint: z.string().max(500).optional(),
  projectName: z.string().min(1).max(80).default("导入页面"),
});

type ImportImageBody = z.infer<typeof importImageBodySchema>;

/** zod issues are object arrays, not JSON-readable: normalize to "path: message". */
function zodIssues(issues: { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

/** Read + JSON.parse the capped body; null means "not a JSON object body". */
async function readJsonBody(c: Context): Promise<unknown> {
  const buffer = await readLimitedBody(c.req.raw, MAX_BODY_BYTES);
  if (buffer.length === 0) return null;
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return null;
  }
}

/** Per-image conversion results split into the two response channels. */
interface ConversionTally {
  converted: ConvertedPage[];
  warnings: string[];
  failures: string[];
}

/**
 * Convert every image in order. A single image exhausting its budget is skipped
 * into warnings; only when ALL images fail does the caller answer 422.
 */
async function convertAll(provider: ChatProvider, body: ImportImageBody): Promise<ConversionTally> {
  const converted: ConvertedPage[] = [];
  const warnings: string[] = [];
  const failures: string[] = [];
  const opts = { mode: body.mode as ImportMode, styleHint: body.styleHint, total: body.images.length };
  for (let index = 0; index < body.images.length; index += 1) {
    const outcome = await convertImagePage(provider, body.images[index]!, { ...opts, index });
    if (outcome.ok) {
      converted.push(outcome.converted);
      continue;
    }
    const label = `图 ${index + 1}`;
    failures.push(`${label}：${outcome.errors}`);
    warnings.push(`${label} 校验重试 ${MAX_ATTEMPTS} 轮后仍失败，已跳过：${outcome.errors}`);
  }
  return { converted, warnings, failures };
}

export function registerImportImageRoute(app: Hono, deps: ImportImageRouteDeps): void {
  app.post("/api/ai/import-image", async (c) => {
    let raw: unknown;
    try {
      raw = await readJsonBody(c);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        return c.json({ error: "payload_too_large", message: "图片总体积超过 40MB 上限" }, 413);
      }
      throw err;
    }
    const parsed = importImageBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: zodIssues(parsed.error.issues) }, 400);
    }
    const body = parsed.data;

    const settings = await readSettings(deps.dataDir);
    const provider = deps.provider ?? getProvider(settings);
    // Vision dual-track: a provider that cannot carry images is refused outright
    // — never silently degraded to text (design §4.1 / roadmap §8).
    if (!provider.supportsImages) {
      return c.json(
        { error: "import_failed", message: "当前模型不支持图片输入，请在设置中切换视觉模型" },
        422,
      );
    }

    const tally = await convertAll(provider, body);
    if (tally.converted.length === 0) {
      return c.json(
        { error: "import_failed", message: `全部图片转换失败：${tally.failures.join("；")}`, issues: tally.failures },
        422,
      );
    }
    try {
      const document = assembleDocument(tally.converted, body.projectName);
      return c.json({ document, warnings: tally.warnings, pages: document.pages.length });
    } catch (err) {
      // Assembly is the last funnel: a shape that cannot be assembled is a
      // failed import (422), not an opaque 500.
      return c.json(
        { error: "import_failed", message: `页面组装失败：${(err as Error).message}`, issues: tally.failures },
        422,
      );
    }
  });
}
