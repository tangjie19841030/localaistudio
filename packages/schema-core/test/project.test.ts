import { describe, expect, it } from "vitest";
import {
  createProjectInputSchema,
  newProjectId,
  newProjectMeta,
  projectMetaSchema,
} from "../src/project.js";

describe("ProjectMeta", () => {
  it("newProjectMeta 生成 uuid 与时间戳", () => {
    const meta = newProjectMeta({ name: "运营工作台", productType: "后台", targetUsers: "运营", goal: "看数据", referenceLinks: [], brandRules: "" });
    expect(meta.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(meta.createdAt).toBe(meta.updatedAt);
    expect(projectMetaSchema.parse(meta)).toEqual(meta);
  });

  it("createProjectInputSchema：名称必填，其余可选", () => {
    expect(createProjectInputSchema.safeParse({ name: "x" }).success).toBe(true);
    expect(createProjectInputSchema.safeParse({}).success).toBe(false);
    const parsed = createProjectInputSchema.parse({ name: "x" });
    expect(parsed.goal).toBe("");
    expect(parsed.referenceLinks).toEqual([]);
  });

  it("createProjectInputSchema 拒绝非法 URL", () => {
    expect(
      createProjectInputSchema.safeParse({ name: "x", referenceLinks: ["not-a-url"] }).success,
    ).toBe(false);
  });

  it("newProjectId 每次不同且为 uuid", () => {
    expect(newProjectId()).not.toBe(newProjectId());
  });
});

describe("ProjectMeta 契约边界（Task 3 审查采纳）", () => {
  const sample = { name: "x", productType: "a", targetUsers: "b", goal: "c", referenceLinks: [], brandRules: "d" };
  const uuid = "123e4567-e89b-42d3-a456-426614174000";

  it("name 60 接受、61 与空串拒绝（input 与 meta 两个 Schema）", () => {
    expect(createProjectInputSchema.safeParse({ ...sample, name: "a".repeat(60) }).success).toBe(true);
    expect(createProjectInputSchema.safeParse({ ...sample, name: "a".repeat(61) }).success).toBe(false);
    expect(createProjectInputSchema.safeParse({ ...sample, name: "" }).success).toBe(false);
    const meta = { id: uuid, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...sample, name: "a".repeat(60) };
    expect(projectMetaSchema.safeParse(meta).success).toBe(true);
    expect(projectMetaSchema.safeParse({ ...meta, name: "a".repeat(61) }).success).toBe(false);
    expect(projectMetaSchema.safeParse({ ...meta, name: "" }).success).toBe(false);
  });

  it("referenceLinks 10 条接受、11 条拒绝；javascript:/data: 链接拒绝", () => {
    const links = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`);
    expect(createProjectInputSchema.safeParse({ ...sample, referenceLinks: links }).success).toBe(true);
    expect(createProjectInputSchema.safeParse({ ...sample, referenceLinks: [...links, "https://example.com/10"] }).success).toBe(false);
    expect(createProjectInputSchema.safeParse({ ...sample, referenceLinks: ["javascript:alert(1)"] }).success).toBe(false);
    expect(createProjectInputSchema.safeParse({ ...sample, referenceLinks: ["data:text/html,<b>x</b>"] }).success).toBe(false);
    const meta = { id: uuid, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...sample, referenceLinks: ["javascript:alert(1)"] };
    expect(projectMetaSchema.safeParse(meta).success).toBe(false);
  });

  it("meta 拒绝坏 uuid / 坏 createdAt / 缺字段", () => {
    const ok = { id: uuid, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...sample };
    expect(projectMetaSchema.safeParse({ ...ok, id: "not-a-uuid" }).success).toBe(false);
    expect(projectMetaSchema.safeParse({ ...ok, createdAt: "2026-09-08T00:00:00+08:00" }).success).toBe(false);
    expect(projectMetaSchema.safeParse({ ...ok, brandRules: undefined }).success).toBe(false);
  });

  it("meta 解析时剥离未知键（strip 语义）", () => {
    const ok = { id: uuid, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...sample, extraJunk: 1 };
    const parsed = projectMetaSchema.parse(ok);
    expect(parsed).not.toHaveProperty("extraJunk");
  });

  it("newProjectId 符合严格 v4 UUID 格式", () => {
    expect(newProjectId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
