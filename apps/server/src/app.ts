import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  studioDocumentSchema,
  projectMetaSchema,
  createProjectInputSchema,
} from "@studio/schema-core";
import {
  DocumentInvalidError,
  NotFoundError,
  PathError,
  StoreError,
  UnsupportedProjectTypeError,
  type ProjectsStore,
} from "./store/projects.js";
import { createVersionsStore, type VersionsStore } from "./store/versions.js";
import { createStorePutGuard } from "./store/put-guard.js";
import {
  maskSettings,
  readSettings,
  settingsSchema,
  writeSettings,
  type StudioSettings,
} from "./store/settings.js";
import { getProvider, type ChatProvider } from "./ai/provider.js";
import {
  chatRequestSchema,
  createRequestRegistry,
  runChatStream,
} from "./ai/routes.js";
import type { ScopeChecker } from "./ai/patchGuard.js";
import { getDataDir } from "./paths.js";
import { streamSSE } from "hono/streaming";
import { createPreviewManager, type PreviewManager } from "./preview/processes.js";
import { registerCodegenRoutes } from "./codegen/routes.js";
import type { GenerateFiles } from "./codegen/files.js";
import type { CheckRunner } from "./codegen/export.js";
import { registerVisualRoutes } from "./visual/routes.js";
import { createPlaywrightRunner, type ScreenshotRunner } from "./visual/screenshots.js";
import { registerTemplateRoutes } from "./templates/routes.js";
import { registerImportImageRoute } from "./ai/import-image.js";
import { registerImageGenRoutes } from "./ai/imageGenRoutes.js";
import type { ImageGenerator } from "./ai/imageGen.js";
import { registerPptExportRoutes } from "./toolkits/ppt/routes.js";
import { registerWordExportRoutes } from "./toolkits/word/routes.js";

const VERSION = "0.1.0";

/**
 * Anti DNS-rebinding guard (P1): the server binds 127.0.0.1 only, but a
 * remote page can still reach it by rebinding a public domain to 127.0.0.1
 * and then fetching http://evil.example.com:8787 — the browser sends
 * `Host: evil.example.com:8787`. Only requests whose Host header names THIS
 * server are allowed; anything else 403s.
 *
 * Allowed set (minimal per the binding in index.ts):
 * - `127.0.0.1:<port>` / `localhost:<port>` for direct access.
 * - No Host header at all — @hono/node-server synthesizes a request without
 *   one for its own internal probes, and Hono's app.request() defaults to
 *   http://localhost without setting one (all existing unit tests).
 * Port is read from the same PORT env source index.ts binds with.
 */
function allowedHosts(): Set<string> {
  const port = Number.parseInt(process.env.PORT ?? "8787", 10) || 8787;
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

/** Middleware factory: 403 any request whose Host is not the local server. */
export function createHostGuard() {
  const allowed = allowedHosts();
  return async (c: Context, next: () => Promise<void>) => {
    const host = c.req.header("host");
    if (host !== undefined && !allowed.has(host.toLowerCase())) {
      return c.json({ error: "forbidden_host" }, 403);
    }
    return next();
  };
}

export interface AppOptions {
  /** Data dir holding settings.json (defaults to getDataDir()). */
  dataDir?: string;
  /** Scope checker for patch-mode interception; real one is schema-core checkScope. */
  scopeChecker?: ScopeChecker;
  /** Preview process registry; a real one is created when omitted. */
  previewManager?: PreviewManager;
  /** Test seam for the schema-core generateFiles dynamic import (P3-1 parallel). */
  generateFiles?: GenerateFiles;
  /** Test seam for export-check subprocess execution. */
  checkRunner?: CheckRunner;
  /** Test seam: skip install inside export checks. */
  skipInstall?: boolean;
  /** Test seam for Playwright screenshots; the real runner launches nothing until called. */
  screenshotRunner?: ScreenshotRunner;
  /** Test seam for template import conversion (bypasses settings-derived provider). */
  provider?: ChatProvider;
  /** Test seam for U7 image generation (production always builds the settings-derived generator). */
  imageGenerator?: ImageGenerator;
}

const createVersionBodySchema = z.object({
  name: z.string().min(1).max(60),
  document: studioDocumentSchema,
});

/** 统一把 store 错误映射为 JSON 响应；未识别错误 rethrow（Hono 默认 500） */
function fail(c: Context, err: unknown): Response {
  if (err instanceof DocumentInvalidError) {
    return c.json({ error: "document_invalid", issues: err.issues }, 422);
  }
  if (err instanceof PathError) {
    return c.json({ error: "invalid_id" }, 400);
  }
  if (err instanceof UnsupportedProjectTypeError) {
    // P7.2：类型合法但工具包未注册（ppt/word 待 P9/P10）→ 400 + 明确消息
    return c.json({ error: "project_type_unavailable", message: err.message }, 400);
  }
  if (err instanceof NotFoundError) {
    return c.json({ error: "not_found" }, 404);
  }
  if (err instanceof StoreError) {
    // Task 5 审查采纳：损坏/不一致等基础 StoreError 必须是结构化 500，而不是 Hono 的纯文本 500
    return c.json({ error: "store_error", message: err.message }, 500);
  }
  throw err;
}

/** zod 的 issues 是对象数组，不可 JSON 直读；归一为 "path: message" 字符串 */
function zodIssues(issues: { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

/** PUT semantics: empty apiKey means "keep the stored key"; non-empty replaces it. */
function mergeApiKey(previous: StudioSettings, incoming: StudioSettings): StudioSettings {
  if (incoming.openai.apiKey !== "") return incoming;
  return { ...incoming, openai: { ...incoming.openai, apiKey: previous.openai.apiKey } };
}

export function createApp(store: ProjectsStore, opts?: AppOptions) {
  const versions = createVersionsStore(store.baseDir, store);
  const documentGuard = createStorePutGuard(store);
  const dataDir = opts?.dataDir ?? getDataDir();
  const previewManager = opts?.previewManager ?? createPreviewManager();
  const app = new Hono();

  // P1: reject cross-origin (DNS-rebinding) requests before any route runs.
  app.use(createHostGuard());

  app.get("/api/health", (c) =>
    c.json({ status: "ok", version: VERSION, previews: previewManager.status().length }),
  );

  app.get("/api/settings", async (c) => c.json(maskSettings(await readSettings(dataDir))));

  app.put("/api/settings", async (c) => {
    const previous = await readSettings(dataDir);
    const raw = await c.req.json().catch(() => null);
    const parsed = settingsSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: zodIssues(parsed.error.issues) }, 400);
    }
    const next = mergeApiKey(previous, parsed.data);
    await writeSettings(dataDir, next);
    return c.json(maskSettings(next));
  });

  app.get("/api/model/providers", async (c) => {
    const settings = await readSettings(dataDir);
    // Detect all three so the settings page can show reachability regardless of the active one.
    const providers = await Promise.all([
      getProvider({ ...settings, provider: "mock" }).detect(),
      getProvider({ ...settings, provider: "openai-compat" }).detect(),
      getProvider({ ...settings, provider: "ollama" }).detect(),
    ]);
    return c.json({ providers });
  });

  app.post("/api/model/test", async (c) => {
    const settings = await readSettings(dataDir);
    const provider = getProvider(settings);
    try {
      const result = await provider.complete({
        messages: [{ role: "user", content: "ping" }],
      });
      return c.json({ ok: true, sample: result.text.slice(0, 200) });
    } catch (err) {
      return c.json({ ok: false, sample: "", detail: (err as Error).message }, 200);
    }
  });

  app.get("/api/projects", async (c) => {
    try {
      return c.json({ projects: await store.list() });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/projects", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = createProjectInputSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: zodIssues(parsed.error.issues) }, 400);
    }
    try {
      const bundle = await store.create(parsed.data);
      return c.json(bundle, 201);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/api/projects/:id", async (c) => {
    try {
      return c.json(await store.read(c.req.param("id")));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.put("/api/projects/:id", async (c) => {
    const id = c.req.param("id");
    // 先经 store 解析 id（PathError→400）并确认项目存在（404），再做 body 校验：
    // 测试契约规定未知 id 的 404 优先于 invalid_body 的 400。
    // 预检只确认存在性、不读文档——崩溃窗口留下的损坏文档必须能靠重存修复。
    try {
      await store.exists(id);
    } catch (err) {
      return fail(c, err);
    }
    const raw = await c.req.json().catch(() => null);
    const parsed = await documentGuard.validatePut(id, raw);
    if (!parsed.ok) {
      return c.json({ error: "invalid_body", issues: parsed.issues }, 400);
    }
    try {
      return c.json(await store.save(id, parsed.data));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.delete("/api/projects/:id", async (c) => {
    try {
      await store.remove(c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/projects/:id/versions", async (c) => {
    const id = c.req.param("id");
    // 未知 id 的 404 优先于 invalid_body 的 400（对齐 PUT 的既有契约）
    try {
      await store.exists(id);
    } catch (err) {
      return fail(c, err);
    }
    const raw = await c.req.json().catch(() => null);
    const parsed = createVersionBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: zodIssues(parsed.error.issues) }, 400);
    }
    try {
      return c.json(await versions.create(id, parsed.data.name, parsed.data.document), 201);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/api/projects/:id/versions", async (c) => {
    try {
      return c.json({ versions: await versions.list(c.req.param("id")) });
    } catch (err) {
      return fail(c, err);
    }
  });

  // Placed before the :versionId DELETE sibling; reading a version's document is what
  // makes cross-session comparison possible (the client's Dexie mirror may be gone).
  app.get("/api/projects/:id/versions/:versionId", async (c) => {
    try {
      return c.json(await versions.read(c.req.param("id"), c.req.param("versionId")));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.delete("/api/projects/:id/versions/:versionId", async (c) => {
    try {
      await versions.remove(c.req.param("id"), c.req.param("versionId"));
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  registerChatRoutes(app, { store, dataDir, scopeChecker: opts?.scopeChecker });
  registerCodegenRoutes(app, {
    store,
    previewManager,
    generateFiles: opts?.generateFiles,
    checkRunner: opts?.checkRunner,
    skipInstall: opts?.skipInstall,
  });
  registerVisualRoutes(app, {
    store,
    previewManager,
    runner: opts?.screenshotRunner ?? createPlaywrightRunner(),
    generateFiles: opts?.generateFiles,
  });
  registerTemplateRoutes(app, { dataDir, provider: opts?.provider });
  registerImportImageRoute(app, { dataDir, provider: opts?.provider });
  registerImageGenRoutes(app, { store, dataDir, generator: opts?.imageGenerator });
  registerPptExportRoutes(app, { store });
  registerWordExportRoutes(app, { store });

  return app;
}

/** SSE chat proxy + cancel (spec §9.1); 404/400 must precede stream start. */
function registerChatRoutes(
  app: Hono,
  deps: { store: ProjectsStore; dataDir: string; scopeChecker?: ScopeChecker },
): void {
  const registry = createRequestRegistry();

  app.post("/api/chat/completions", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = chatRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: zodIssues(parsed.error.issues) }, 400);
    }
    const body = parsed.data;
    try {
      await deps.store.exists(body.projectId); // 404 before any streaming
    } catch (err) {
      return fail(c, err);
    }
    const controller = registry.register(body.requestId);
    return streamSSE(c, async (stream) => {
      const send = (event: Record<string, unknown>) =>
        stream.writeSSE({ data: JSON.stringify(event) });
      // Heartbeat (visibility): a model round-trip can sit silent 10-60s; a
      // 5s keepalive byte proves the connection + pipeline are alive. Fully
      // detached from runChatStream — a failed heartbeat only warns.
      const heartbeat = setInterval(() => {
        try {
          void send({ type: "heartbeat", at: Date.now() }).catch(() =>
            console.warn("heartbeat send failed"),
          );
        } catch {
          console.warn("heartbeat send failed");
        }
      }, 5000);
      stream.onAbort(() => controller.abort());
      try {
        await runChatStream(deps, body, controller, send);
      } catch (err) {
        if (controller.signal.aborted) {
          await send({ canceled: true });
        } else {
          await send({ error: (err as Error).message });
        }
      } finally {
        clearInterval(heartbeat);
        registry.release(body.requestId);
      }
    });
  });

  app.post("/api/chat/cancel", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const requestId = (raw as { requestId?: unknown } | null)?.requestId;
    if (typeof requestId !== "string" || requestId === "") {
      return c.json({ error: "invalid_body" }, 400);
    }
    return c.json({ ok: registry.cancel(requestId) });
  });
}
