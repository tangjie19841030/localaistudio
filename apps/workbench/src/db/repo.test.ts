import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { deleteSession, listSessionsByProject, saveSession } from "./repo";
import type { SessionRecord } from "./db";

// W1-B repo CRUD tests: sessions table isolated per project, newest-first,
// delete guarded by projectId. Runs against fake-indexeddb (setup.ts).

const session = (over: Partial<SessionRecord>): SessionRecord => ({
  sessionId: "s1",
  projectId: "p1",
  title: "第一句",
  messages: [],
  createdAt: "2026-01-01T00:00:01.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
  ...over,
});

beforeEach(async () => {
  await db.sessions.clear();
});

describe("Dexie sessions 表（W1-B）", () => {
  it("saveSession put 覆盖同键（upsert）", async () => {
    await saveSession(session({ title: "旧" }));
    await saveSession(session({ title: "新" }));
    const list = await listSessionsByProject("p1");
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe("新");
  });

  it("listSessionsByProject 只含本项目且按 updatedAt 倒序", async () => {
    await saveSession(session({ sessionId: "s1", updatedAt: "2026-01-01T00:00:01.000Z" }));
    await saveSession(session({ sessionId: "s2", updatedAt: "2026-01-01T00:00:03.000Z" }));
    await saveSession(session({ sessionId: "s3", projectId: "p2" }));
    const list = await listSessionsByProject("p1");
    expect(list.map((s) => s.sessionId)).toEqual(["s2", "s1"]);
    const p2List = await listSessionsByProject("p2");
    expect(p2List.map((s) => s.sessionId)).toEqual(["s3"]);
  });

  it("deleteSession 项目隔离：别的项目删不掉", async () => {
    await saveSession(session({}));
    await deleteSession("p2", "s1");
    expect(await listSessionsByProject("p1")).toHaveLength(1);
    await deleteSession("p1", "s1");
    expect(await listSessionsByProject("p1")).toEqual([]);
  });
});
