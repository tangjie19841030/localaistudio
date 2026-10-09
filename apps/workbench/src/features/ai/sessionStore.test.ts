import { describe, expect, it } from "vitest";
import Dexie from "dexie";
import { pruneMessages, sessionTitle } from "./sessionStore";
import type { ChatLogMessage } from "./types";

// Pruning policy tests (roadmap §7 contract): dataURL → thumbnail reference,
// toolTrace truncated, title = first user message ≤80 chars.

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const msg = (over: Partial<ChatLogMessage>): ChatLogMessage => ({
  id: "m1",
  role: "user",
  text: "hi",
  streaming: false,
  ...over,
});

describe("sessionStore 裁剪策略", () => {
  it("dataURL 图片替换为缩略引用", () => {
    const out = pruneMessages([
      msg({ role: "user", text: `参考这张图 ${PNG_1PX} 谢谢` }),
    ]);
    expect(out[0]!.text).toContain("[图片已裁剪：image/png]");
    expect(out[0]!.text).not.toContain("base64");
    expect(out[0]!.text).toContain("参考这张图");
  });

  it("超长文本截断并带截断标记", () => {
    const long = "x".repeat(5000);
    const out = pruneMessages([msg({ text: long })]);
    expect(out[0]!.text.length).toBeLessThan(5000);
    expect(out[0]!.text).toContain("已截断");
  });

  it("activity 步骤数与 detail 截断（toolTrace 策略）", () => {
    const activity = {
      id: "a1",
      startedAt: 0,
      status: "done" as const,
      steps: Array.from({ length: 30 }, (_, i) => ({
        id: `s${i}`,
        kind: "tool" as const,
        label: `工具${i}`,
        status: "done" as const,
        startedAt: i,
        detail: "d".repeat(300),
      })),
    };
    const out = pruneMessages([msg({ kind: "activity", activity })]);
    expect(out[0]!.activity!.steps.length).toBe(20);
    expect(out[0]!.activity!.steps[0]!.detail!.length).toBeLessThan(300);
    expect(out[0]!.activity!.steps[0]!.detail).toContain("已截断");
  });

  it("title=首条用户消息截 80 字；无用户消息兜底", () => {
    expect(sessionTitle([msg({ text: "短标题" })])).toBe("短标题");
    const long = "题".repeat(100);
    expect(sessionTitle([msg({ text: long })]).length).toBe(80);
    // First user message wins even when an assistant message comes first.
    const two = [msg({ id: "a", role: "assistant", text: "答" }), msg({ id: "b", text: "第二" })];
    expect(sessionTitle(two)).toBe("第二");
    // dataURL inside the title line is also pruned.
    expect(sessionTitle([msg({ text: PNG_1PX })])).toBe("[图片已裁剪：image/png]");
    expect(sessionTitle([])).toBe("（无文本）");
  });
});

// W1-B manual "close window & reopen" semantics, simulated with an in-memory
// Dexie: a NEW StudioDb instance (fresh "window") must see rows written by the
// previous one through the same fake-indexeddb backing store.

class SchemaProbe extends Dexie {
  sessions!: Dexie.Table;
  constructor(name: string, withSessions: boolean) {
    super(name);
    this.version(2).stores({
      projects: "id, updatedAt",
      documents: "projectId",
      versions: "versionId, projectId, createdAt",
    });
    if (withSessions) {
      this.version(3).stores({
        projects: "id, updatedAt",
        documents: "projectId",
        versions: "versionId, projectId, createdAt",
        sessions: "sessionId, projectId, updatedAt",
      });
    }
  }
}

describe("W1-B 关窗重开语义（内存 Dexie 模拟）", () => {
  it("关窗写入的 session，重开（新连接）后仍在", async () => {
    const name = `w1b-reopen-${crypto.randomUUID()}`;
    // "Window 1": v3 schema writes one session row.
    {
      const db1 = new SchemaProbe(name, true);
      await db1.open();
      await db1.sessions.put({
        sessionId: "s1",
        projectId: "p1",
        title: "改标题",
        messages: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      db1.close();
    }
    // "Window 2": fresh connection reads the row back.
    const db2 = new SchemaProbe(name, true);
    await db2.open();
    const rows = await db2.sessions.where("projectId").equals("p1").toArray();
    expect(rows.map((r) => r.title)).toEqual(["改标题"]);
    db2.close();
  });

  it("v2 库（无 sessions 声明）升级到 v3 后旧数据不丢", async () => {
    const name = `w1b-upgrade-${crypto.randomUUID()}`;
    // "Old window": v2 schema writes project-era rows.
    {
      const old = new SchemaProbe(name, false);
      await old.open();
      await old.table("projects").put({ id: "p1", name: "旧项目", updatedAt: "2026-01-01T00:00:00.000Z" });
      await old.table("documents").put({ projectId: "p1", document: { name: "旧文档" }, updatedAt: "2026-01-01T00:00:00.000Z" });
      old.close();
    }
    // "New window": upgraded to v3 — sessions table exists, v1/v2 rows survive.
    const next = new SchemaProbe(name, true);
    await next.open();
    expect(await next.table("projects").get("p1")).toMatchObject({ name: "旧项目" });
    expect(await next.table("documents").get("p1")).toMatchObject({ projectId: "p1" });
    expect(await next.table("sessions").count()).toBe(0);
    next.close();
  });
});
