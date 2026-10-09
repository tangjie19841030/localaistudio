import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createProjectsStore } from "../src/store/projects.js";

// PORT 决定允许的 Host 列表（与 index.ts 同一来源）；默认 8787。
const savedPort = process.env.PORT;

let baseDir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  delete process.env.PORT;
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-host-"));
  app = createApp(createProjectsStore(baseDir));
});

afterEach(async () => {
  if (savedPort === undefined) delete process.env.PORT;
  else process.env.PORT = savedPort;
  await fs.rm(baseDir, { recursive: true, force: true });
});

describe("Host 校验中间件（防 DNS rebinding）", () => {
  it("合法 host（127.0.0.1:8787 / localhost:8787）放行 200", async () => {
    for (const host of ["127.0.0.1:8787", "localhost:8787"]) {
      const res = await app.request("/api/health", { headers: { host } });
      expect(res.status, `host "${host}" 应放行`).toBe(200);
      expect(((await res.json()) as { status: string }).status).toBe("ok");
    }
  });

  it("无 Host 头（app.request 默认形态 / 本机探测）放行", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
  });

  it("外部域名 rebinding 形态 403 且 JSON 错误体", async () => {
    for (const host of [
      "evil.example.com:8787",
      "evil.example.com",
      "127.0.0.1.evil.example.com:8787",
      "[::1]:8787",
    ]) {
      const res = await app.request("/api/health", { headers: { host } });
      expect(res.status, `host "${host}" 应 403`).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe("forbidden_host");
    }
  });

  it("大小写不敏感：LOCALHOST:8787 放行", async () => {
    const res = await app.request("/api/health", { headers: { host: "LOCALHOST:8787" } });
    expect(res.status).toBe(200);
  });

  it("端口不匹配 403；PORT 环境变量同步允许列表", async () => {
    expect((await app.request("/api/health", { headers: { host: "localhost:9999" } })).status).toBe(403);
    process.env.PORT = "9999";
    const app2 = createApp(createProjectsStore(baseDir));
    expect((await app2.request("/api/health", { headers: { host: "localhost:9999" } })).status).toBe(200);
    expect((await app2.request("/api/health", { headers: { host: "localhost:8787" } })).status).toBe(403);
  });

  it("403 在路由逻辑之前生效（非法项目 id 也不会被解析）", async () => {
    const res = await app.request("/api/projects/not-a-uuid", {
      headers: { host: "evil.example.com:8787" },
    });
    expect(res.status).toBe(403);
  });
});
