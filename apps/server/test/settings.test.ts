import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createProjectsStore } from "../src/store/projects.js";
import {
  defaultSettings,
  maskSettings,
  readSettings,
  writeSettings,
} from "../src/store/settings.js";

let dataDir: string;
let baseDir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(join(tmpdir(), "studio-settings-"));
  baseDir = join(dataDir, "projects");
  app = createApp(createProjectsStore(baseDir), { dataDir });
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

const SETTINGS_PATH = () => join(dataDir, "settings.json");

async function putSettings(body: unknown): Promise<Response> {
  return app.request("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("settings store 读写", () => {
  it("无文件时返回默认（provider=mock）", async () => {
    const settings = await readSettings(dataDir);
    expect(settings).toEqual(defaultSettings());
    expect(settings.provider).toBe("mock");
    expect(settings.temperature).toBe(0.2);
    expect(settings.openai.baseUrl).toBe("https://api.openai.com/v1");
    expect(settings.ollama.baseUrl).toBe("http://127.0.0.1:11434");
  });

  it("写入后可回读；文件落在 dataDir/settings.json", async () => {
    const next = {
      ...defaultSettings(),
      provider: "ollama" as const,
      ollama: { baseUrl: "http://127.0.0.1:11434", model: "qwen2.5" },
      temperature: 0.7,
    };
    await writeSettings(dataDir, next);
    expect(existsSync(SETTINGS_PATH())).toBe(true);
    expect((await readSettings(dataDir)).ollama.model).toBe("qwen2.5");
  });

  it("损坏 JSON 回默认（不抛）", async () => {
    await fs.writeFile(SETTINGS_PATH(), "{truncated", "utf8");
    const settings = await readSettings(dataDir);
    expect(settings.provider).toBe("mock");
  });

  it("原子写：不留 .tmp 残留", async () => {
    await writeSettings(dataDir, defaultSettings());
    const files = await fs.readdir(dataDir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("maskSettings", () => {
  it("不回明文 key；hasKey/keyHint 正确", () => {
    const settings = {
      ...defaultSettings(),
      openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-abc1234", model: "gpt-4o-mini" },
    };
    const masked = maskSettings(settings);
    expect(masked.openai.apiKey).toBe("");
    expect(masked.hasKey).toBe(true);
    expect(masked.keyHint).toBe("1234");
    const raw = JSON.stringify(masked);
    expect(raw).not.toContain("sk-abc1234");
  });

  it("无 key 时 hasKey=false 且 keyHint 空", () => {
    const masked = maskSettings(defaultSettings());
    expect(masked.hasKey).toBe(false);
    expect(masked.keyHint).toBe("");
  });
});

describe("GET /api/settings", () => {
  it("默认返回 mock 配置且 hasKey=false", async () => {
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.provider).toBe("mock");
    expect(body.hasKey).toBe(false);
    expect(body.openai).toMatchObject({ apiKey: "" });
  });

  it("已存 key 的 GET 不泄漏明文", async () => {
    await putSettings({
      provider: "openai-compat",
      openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-secret9999", model: "gpt-4o-mini" },
    });
    const res = await app.request("/api/settings");
    const body = (await res.json()) as { hasKey: boolean; keyHint: string };
    expect(body.hasKey).toBe(true);
    expect(body.keyHint).toBe("9999");
    expect(JSON.stringify(body)).not.toContain("sk-secret9999");
  });
});

describe("PUT /api/settings", () => {
  it("合法 body 落盘并回掩码结果", async () => {
    const res = await putSettings({
      provider: "ollama",
      ollama: { baseUrl: "http://127.0.0.1:11434", model: "llama3" },
      temperature: 0.5,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: string };
    expect(body.provider).toBe("ollama");
    const onDisk = JSON.parse(await fs.readFile(SETTINGS_PATH(), "utf8"));
    expect(onDisk.ollama.model).toBe("llama3");
    expect(onDisk.temperature).toBe(0.5);
  });

  it("PUT 空 apiKey 保留旧 key", async () => {
    await putSettings({
      provider: "openai-compat",
      openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-keep1111", model: "gpt-4o-mini" },
    });
    const res = await putSettings({
      provider: "openai-compat",
      openai: { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasKey: boolean; keyHint: string };
    expect(body.hasKey).toBe(true);
    expect(body.keyHint).toBe("1111");
    const onDisk = JSON.parse(await fs.readFile(SETTINGS_PATH(), "utf8"));
    expect(onDisk.openai.apiKey).toBe("sk-keep1111");
  });

  it("PUT 非空 apiKey 替换旧 key", async () => {
    await putSettings({
      provider: "openai-compat",
      openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-old1111", model: "gpt-4o-mini" },
    });
    await putSettings({
      provider: "openai-compat",
      openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-new2222", model: "gpt-4o-mini" },
    });
    const onDisk = JSON.parse(await fs.readFile(SETTINGS_PATH(), "utf8"));
    expect(onDisk.openai.apiKey).toBe("sk-new2222");
  });

  it("非法 temperature / baseUrl 返回 400 invalid_body", async () => {
    const badTemp = await putSettings({ ...defaultSettings(), temperature: 5 });
    expect(badTemp.status).toBe(400);
    const body = (await badTemp.json()) as { error: string };
    expect(body.error).toBe("invalid_body");

    const badUrl = await putSettings({
      provider: "openai-compat",
      openai: { baseUrl: "ftp://x", apiKey: "k", model: "m" },
    });
    expect(badUrl.status).toBe(400);
  });

  it("部分字段可省（zod 默认值补齐）", async () => {
    const res = await putSettings({ provider: "mock" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { temperature: number; openai: { baseUrl: string } };
    expect(body.temperature).toBe(0.2);
    expect(body.openai.baseUrl).toBe("https://api.openai.com/v1");
  });
});
