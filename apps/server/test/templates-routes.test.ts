import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStudioDocument } from "@studio/schema-core";
import { createApp } from "../src/app.js";
import { createProjectsStore } from "../src/store/projects.js";

const PID = "00000000-0000-4000-8000-000000000000";
let baseDir: string;
let dataDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-tpl-"));
  dataDir = await fs.mkdtemp(join(tmpdir(), "studio-tpl-data-"));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function seedSource(id: string, bundle: string): Promise<void> {
  const dir = join(dataDir, "templates", "source");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, `${id}.json`),
    JSON.stringify({ name: id, files: [{ path: "page.tsx", type: "registry:page", content: bundle }] }),
    "utf8",
  );
}

describe("template gallery & import (route A)", () => {
  it("GET /api/templates：内置 3 项 + 外部来源；未导入项为 pending", async () => {
    const app = createApp(createProjectsStore(baseDir), { dataDir });
    await seedSource("login-01", "// login page");
    await seedSource("dashboard-01", "// dashboard");
    const res = await app.request("/api/templates");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { templates: { id: string; category: string; source?: string; document?: unknown }[] };
    // builtin templates are always present
    for (const id of ["dashboard", "list-detail", "form"]) {
      const b = body.templates.find((t) => t.id === id);
      expect(b?.source).toBe("内置模板");
      expect(b?.document).toBeTruthy();
    }
    // external sources: pending until imported (carry no doc)
    const external = body.templates.filter((t) => t.source !== "内置模板");
    expect(external.map((t) => t.id).sort()).toEqual(["dashboard-01", "login-01"]);
    for (const t of external) {
      expect(t.category).toBeTruthy();
      expect(t.document).toBeUndefined(); // pending sources carry no doc
    }
  });

  it("POST /api/templates/import（默认 mock provider）：转换必然失败 → 显式 422，绝不落假模板", async () => {
    const app = createApp(createProjectsStore(baseDir), { dataDir });
    await seedSource("login-01", "// login page");
    // mock provider's scripted reply is a {plan,...} wrapper → validateDocument fails.
    const res = await app.request("/api/templates/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "login-01" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("convert_failed");
    // Nothing was persisted: the gallery still lists the source as pending (no doc).
    const list = (await (await app.request("/api/templates")).json()) as { templates: { id: string; document?: unknown }[] };
    const rec = list.templates.find((t) => t.id === "login-01");
    expect(rec?.document).toBeUndefined();
  });

  it("POST import（provider seam）：真实转换成功 → 落盘并出现于列表，名称取自文档", async () => {
    const doc = defaultStudioDocument("登录页测试");
    const provider = {
      supportsImages: false,
      detect: async () => ({ id: "fake", available: true }),
      complete: async () => ({ text: JSON.stringify(doc) }),
    };
    const app = createApp(createProjectsStore(baseDir), { dataDir, provider });
    await seedSource("login-01", "// login page");
    const res = await app.request("/api/templates/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "login-01" }),
    });
    expect(res.status).toBe(200);
    const { template } = (await res.json()) as { template: { id: string; name: string; document?: unknown } };
    expect(template.id).toBe("login-01");
    expect(template.name).toBe("登录页测试");
    expect(template.document).toBeTruthy();
    // appears in the gallery with a document now
    const list = (await (await app.request("/api/templates")).json()) as { templates: { id: string; document?: unknown }[] };
    const rec = list.templates.find((t) => t.id === "login-01");
    expect(rec?.document).toBeTruthy();
  });

  it("POST import：合法 id 校验失败 400；未知来源 404", async () => {
    const app = createApp(createProjectsStore(baseDir), { dataDir });
    expect((await app.request("/api/templates/import", { method: "POST", body: JSON.stringify({}) })).status).toBe(400);
    expect(
      (await app.request("/api/templates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "ghost" }),
      })).status,
    ).toBe(404);
  });

  it("GET /api/templates/:id：已导入模板返回文档；未导入 404", async () => {
    const provider = {
      supportsImages: false,
      detect: async () => ({ id: "fake", available: true }),
      complete: async () => ({ text: JSON.stringify(defaultStudioDocument("看板页")) }),
    };
    const app = createApp(createProjectsStore(baseDir), { dataDir, provider });
    await seedSource("dashboard-01", "// dashboard page");
    const imported = await app.request("/api/templates/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "dashboard-01" }),
    });
    expect(imported.status).toBe(200);
    const ok = await app.request("/api/templates/dashboard-01");
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { document: unknown };
    expect(body.document).toBeTruthy();
    expect((await app.request("/api/templates/nope")).status).toBe(404);
  });
});

describe("convertBlock（真实 provider 侧）", () => {
  it("AI 输出合法文档 → 校验通过返回 document", async () => {
    const { convertBlock } = await import("../src/templates/converter.js");
    const doc = defaultStudioDocument("看板");
    const provider = {
      supportsImages: false,
      detect: async () => ({ id: "t", available: true }),
      complete: async () => ({ text: JSON.stringify(doc) }),
    };
    const out = await convertBlock(provider, "x", "bundle");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.document).toEqual(doc);
    }
  });

  it("children 里的嵌套节点对象被确定性展平为 id 引用（模型常见偏差自动修复）", async () => {
    const { convertBlock } = await import("../src/templates/converter.js");
    const { defaultTokens } = await import("@studio/schema-core");
    // The exact deviation the live model produced: full node objects (and a
    // null) inside a children array instead of id strings.
    const nested = {
      documentVersion: 1,
      name: "看板",
      tokens: defaultTokens(),
      rootId: "root",
      nodes: [
        {
          id: "root",
          type: "Container",
          props: {},
          children: [
            { id: "h", type: "Heading", props: { text: "标题", level: 1 }, children: [] },
            null,
          ],
        },
        { id: "h", type: "Heading", props: { text: "标题", level: 1 }, children: [] },
      ],
    };
    const provider = {
      supportsImages: false,
      detect: async () => ({ id: "t", available: true }),
      complete: async () => ({ text: JSON.stringify(nested) }),
    };
    const out = await convertBlock(provider, "x", "bundle");
    expect(out.ok).toBe(true);
    if (out.ok) {
      const root = out.document.pages[0]!.nodes.find((n) => n.id === "root");
      expect(root?.children).toEqual(["h"]);
    }
  });

  it("AI 输出坏 JSON → 重试后修正 → ok；一直坏 → ok:false", async () => {
    const { convertBlock } = await import("../src/templates/converter.js");
    const good = JSON.stringify(defaultStudioDocument("看板"));
    let calls = 0;
    const provider = {
      supportsImages: false,
      detect: async () => ({ id: "t", available: true }),
      complete: async () => {
        calls += 1;
        return { text: calls === 1 ? "not json" : good };
      },
    };
    const out = await convertBlock(provider, "x", "bundle");
    expect(out.ok).toBe(true);
    expect(calls).toBe(2);

    const stubborn = {
      supportsImages: false,
      detect: async () => ({ id: "t", available: true }),
      complete: async () => ({ text: "still not json" }),
    };
    const failed = await convertBlock(stubborn, "x", "bundle");
    expect(failed.ok).toBe(false);
  });

  it("AI 输出带代码围栏的合法 JSON 也能解析", async () => {
    const { convertBlock } = await import("../src/templates/converter.js");
    const doc = defaultStudioDocument("看板");
    const provider = {
      supportsImages: false,
      detect: async () => ({ id: "t", available: true }),
      complete: async () => ({ text: `\`\`\`json\n${JSON.stringify(doc)}\n\`\`\`` }),
    };
    const out = await convertBlock(provider, "x", "bundle");
    expect(out.ok).toBe(true);
  });
});