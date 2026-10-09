import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkScope, type StudioDocument } from "@studio/schema-core";
import { createProjectsStore, type ProjectsStore } from "../src/store/projects.js";
import { runChatStream } from "../src/ai/routes.js";
import type { DriverCall, ToolDriver } from "../src/ai/agentLoop.js";

/**
 * Regression: whole-page generate must NEVER run under a selection scope.
 * A leftover canvas selection used to reach the patch pipeline, so every write
 * came back "节点 <id> 超出修改范围" and the canvas ended up empty.
 */

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(join(tmpdir(), "studio-chat-gen-scope-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(dataDir, { recursive: true, force: true });
});

/** Seed doc: root + three leaves, so "stat" can be the request scope while
 *  "other"/"extra" stay outside it. */
const SEED: StudioDocument = {
  documentVersion: 2,
  name: "整页生成范围回归",
  tokens: {
    color: {
      brand: "#0F766E", surface: "#FFFFFF", text: "#172033", muted: "#64748B",
      border: "#E2E8F0", accent: "#0EA5E9", success: "#16A34A", warning: "#D97706", danger: "#DC2626",
    },
    radius: { card: 6, control: 4 },
    spacing: { unit: 4 },
    font: { sans: "Inter" },
  },
  pages: [
    {
      id: "page-1",
      name: "整页生成范围回归",
      rootId: "root",
      nodes: [
        { id: "root", type: "Container", props: {}, children: ["stat", "other", "extra"] },
        { id: "stat", type: "StatCard", props: { label: "选中", value: "1", delta: "", tone: "brand" }, children: [] },
        { id: "other", type: "Text", props: { content: "范围外", muted: false }, children: [] },
        { id: "extra", type: "Text", props: { content: "待删除", muted: false }, children: [] },
      ],
    },
  ],
};

async function seedProject(): Promise<{ store: ProjectsStore; projectId: string }> {
  const store = createProjectsStore(join(dataDir, "projects-gen-scope"));
  const created = await store.create({
    name: "整页生成范围回归",
    productType: "后台",
    targetUsers: "运营",
    goal: "验证生成模式不受选区范围限制",
    referenceLinks: [],
    brandRules: "",
  });
  await store.save(created.meta.id, { meta: created.meta, document: SEED });
  return { store, projectId: created.meta.id };
}

/** Scripted driver: one batch, then done (verify rounds see an empty batch). */
function scriptedDriver(calls: DriverCall[]): ToolDriver {
  let used = false;
  return {
    async next() {
      if (used) return [];
      used = true;
      return calls;
    },
  };
}

async function runOnce(
  store: ProjectsStore,
  projectId: string,
  mode: "generate" | "patch",
  scope: { nodeIds: string[] },
  driver: ToolDriver,
  withScopeChecker = false,
): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  await runChatStream(
    {
      store,
      dataDir,
      driver,
      scopeChecker: withScopeChecker
        ? (ops, allowed) => checkScope(ops as Parameters<typeof checkScope>[0], allowed)
        : undefined,
    },
    {
      projectId,
      messages: [{ role: "user", content: "做一个运营看板" }],
      mode,
      scope,
      requestId: crypto.randomUUID(),
    },
    new AbortController(),
    async (ev) => void events.push(ev),
  );
  return events;
}

const toolResults = (events: Record<string, unknown>[]) =>
  events.filter((e) => e.type === "tool-result") as { name: string; ok: boolean; message: string }[];

describe("generate 模式忽略客户端选区范围（回归）", () => {
  it("generate + scope：insert_node / update_props / remove_node 对范围外节点全部成功，done 带 validated 文档", async () => {
    const { store, projectId } = await seedProject();
    // Every target except the first insert is OUTSIDE the request scope. The
    // real checkScope is wired in so any leftover scope would fail the run.
    const events = await runOnce(
      store,
      projectId,
      "generate",
      { nodeIds: ["stat"] },
      scriptedDriver([
        { name: "insert_node", args: { type: "Heading", parentId: "root", props: { text: "新标题" } } },
        { name: "update_props", args: { nodeId: "other", props: { content: "范围外也被改写" } } },
        { name: "remove_node", args: { nodeId: "extra" } },
      ]),
      true,
    );

    const results = toolResults(events);
    expect(results.map((r) => r.name)).toEqual(["insert_node", "update_props", "remove_node"]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.every((r) => !r.message.includes("超出修改范围"))).toBe(true);

    // No scope frames at all on the generate path.
    expect(events.filter((e) => "violation" in e)).toHaveLength(0);
    expect(events.filter((e) => "error" in e)).toHaveLength(0);

    const done = events.find((e) => "done" in e) as { validated?: string; document?: StudioDocument } | undefined;
    expect(done?.validated).toBe("document");
    const nodes = done?.document?.pages[0]!.nodes ?? [];
    expect(nodes.length).toBeGreaterThan(0);
    // The out-of-scope edits really landed in the generated document.
    expect(nodes.find((n) => n.id === "other")?.props.content).toBe("范围外也被改写");
    expect(nodes.some((n) => n.id === "extra")).toBe(false);
    expect(nodes.some((n) => n.type === "Heading")).toBe(true);
  });

  it("generate + scope：最终文档校验失败时也不回落到 scope 审计（无 scope_violation 帧）", async () => {
    const { store, projectId } = await seedProject();
    // Nonexistent target fails with its own error text (not a scope rejection).
    const events = await runOnce(
      store,
      projectId,
      "generate",
      { nodeIds: ["stat"] },
      scriptedDriver([{ name: "update_props", args: { nodeId: "ghost", props: { content: "x" } } }]),
      true,
    );

    expect(events.filter((e) => "violation" in e)).toHaveLength(0);
    const errors = events.filter((e) => "error" in e) as { error?: string }[];
    expect(errors.every((e) => e.error !== "scope_violation")).toBe(true);
  });
});

describe("patch 模式范围严格性不放宽（回归）", () => {
  it("patch + scope：范围外 update_props 仍报「超出修改范围」并走 violation → scope_violation", async () => {
    const { store, projectId } = await seedProject();
    const events = await runOnce(
      store,
      projectId,
      "patch",
      { nodeIds: ["stat"] },
      scriptedDriver([{ name: "update_props", args: { nodeId: "other", props: { content: "越界改写" } } }]),
      true,
    );

    const failed = toolResults(events).filter((r) => !r.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.message).toContain("超出修改范围");

    expect(events.filter((e) => "done" in e)).toHaveLength(0);
    const violations = events.filter((e) => "violation" in e) as { retry?: boolean }[];
    expect(violations).toHaveLength(1);
    expect(violations[0]?.retry).toBe(true);
    const errors = events.filter((e) => "error" in e) as { error?: string; violations?: string[] }[];
    expect(errors[0]?.error).toBe("scope_violation");
    expect(errors[0]?.violations?.join("\n")).toContain("节点 other 超出修改范围");
  });
});
