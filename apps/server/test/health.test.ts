import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createProjectsStore } from "../src/store/projects.js";

let baseDir: string;

describe("GET /api/health", () => {
  it("返回 ok", async () => {
    baseDir = await fs.mkdtemp(join(tmpdir(), "studio-health-"));
    const store = createProjectsStore(baseDir);
    const app = createApp(store);
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string };
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
  });
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});
