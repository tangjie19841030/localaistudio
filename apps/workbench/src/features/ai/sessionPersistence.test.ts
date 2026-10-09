import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { listSessionsByProject } from "../../db/repo";
import { useAiStore } from "../../state/aiStore";
import { useEditorStore } from "../../state/editorStore";
import { startSessionPersistence } from "./sessionStore";

// Terminal-state subscription test: aiStore internals untouched — transitions
// are driven via setState exactly like the store's own reducers do (withReset /
// toError / toNotice shapes), then a session row must land in Dexie.

/** Flush the microtask-deferred persistTurn + its awaited Dexie write. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  await db.sessions.clear();
  useAiStore.setState({
    messages: [],
    phase: "idle",
    error: null,
    notice: null,
    pendingPlan: null,
  });
  useEditorStore.setState({ projectId: null });
});

describe("sessionPersistence 终态落库", () => {
  it("streaming→awaiting-confirm（done）落库：标题=首条用户消息，窗口不含上一轮", async () => {
    const stop = startSessionPersistence();
    try {
      useEditorStore.setState({ projectId: "p-done" });
      useAiStore.setState({ messages: [{ id: "old", role: "assistant", text: "上一轮", streaming: false }] });
      // Turn starts: user + placeholder bubbles, phase → streaming.
      useAiStore.setState((s) => ({
        messages: [
          ...s.messages,
          { id: "u1", role: "user", text: "把标题改短", streaming: false },
          { id: "a1", role: "assistant", text: "计划：…", streaming: false },
        ],
        phase: "streaming",
      }));
      // Terminal awaiting-confirm (toAwaitingConfirm shape).
      useAiStore.setState({ phase: "awaiting-confirm", pendingPlan: { plan: "p" } });
      await flush();
      const list = await listSessionsByProject("p-done");
      expect(list).toHaveLength(1);
      expect(list[0]!.title).toBe("把标题改短");
      // The window starts at the previous boundary: the old assistant message
      // must NOT leak into this turn's record.
      expect(list[0]!.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    } finally {
      stop();
    }
  });

  it("streaming→error 落库；canceled（纯 idle 无 notice）不落库但推进边界", async () => {
    const stop = startSessionPersistence();
    try {
      useEditorStore.setState({ projectId: "p-err" });
      useAiStore.setState({
        messages: [{ id: "u1", role: "user", text: "生成登录页", streaming: false }],
        phase: "streaming",
      });
      useAiStore.setState({ phase: "error", error: "模型超时" });
      await flush();
      let list = await listSessionsByProject("p-err");
      expect(list).toHaveLength(1);
      expect(list[0]!.title).toBe("生成登录页");

      // Canceled turn: back to idle with no notice — window advances, no row.
      useAiStore.setState((s) => ({
        messages: [...s.messages, { id: "u2", role: "user", text: "重试", streaming: false }],
        phase: "streaming",
        error: null,
      }));
      useAiStore.setState({ phase: "idle" });
      await flush();
      list = await listSessionsByProject("p-err");
      expect(list).toHaveLength(1); // unchanged

      // The canceled window is consumed: next done turn records only its own.
      useAiStore.setState((s) => ({
        messages: [...s.messages, { id: "u3", role: "user", text: "再试一次", streaming: false }],
        phase: "streaming",
      }));
      useAiStore.setState({ phase: "idle", notice: "无需修改" });
      await flush();
      list = await listSessionsByProject("p-err");
      expect(list).toHaveLength(2);
      expect(list[0]!.messages.map((m) => m.id)).toEqual(["u3"]);
      expect(list[0]!.title).toBe("再试一次");
    } finally {
      stop();
    }
  });

  it("clear()（messages 缩短）不落库；随后的新轮窗口干净", async () => {
    const stop = startSessionPersistence();
    try {
      useEditorStore.setState({ projectId: "p-clear" });
      useAiStore.setState({
        messages: [
          { id: "u1", role: "user", text: "第一轮", streaming: false },
          { id: "a1", role: "assistant", text: "完成", streaming: false },
        ],
        phase: "streaming",
      });
      // Project switch: messages drop to [] while streaming (clear() shape).
      useAiStore.setState({ messages: [], phase: "idle" });
      await flush();
      expect(await listSessionsByProject("p-clear")).toEqual([]);

      useAiStore.setState({
        messages: [{ id: "u2", role: "user", text: "新项目第一问", streaming: false }],
        phase: "streaming",
      });
      useAiStore.setState({ phase: "idle", notice: "无需修改" });
      await flush();
      const list = await listSessionsByProject("p-clear");
      expect(list).toHaveLength(1);
      expect(list[0]!.messages.map((m) => m.id)).toEqual(["u2"]);
    } finally {
      stop();
    }
  });
});

// T52: idempotency guard (`active` flag) — StrictMode double-invokes effects, so
// start() can run twice before the first stop. A duplicate start must return a
// no-op stop, leaving exactly one live subscription; a restart after a real stop
// must re-arm it. A double subscription would persist every terminal transition
// twice (two rows with distinct sessionIds).

describe("sessionPersistence start 幂等", () => {
  it("双 start：二次 start 返回空 stop，一轮终态只落 1 条（不重复订阅）", async () => {
    const stopFirst = startSessionPersistence();
    const stopDup = startSessionPersistence(); // StrictMode second mount
    try {
      useEditorStore.setState({ projectId: "p-double" });
      useAiStore.setState({
        messages: [{ id: "u1", role: "user", text: "双 start 轮", streaming: false }],
        phase: "streaming",
      });
      useAiStore.setState({ phase: "awaiting-confirm", pendingPlan: { plan: "p" } });
      await flush();
      const list = await listSessionsByProject("p-double");
      expect(list).toHaveLength(1); // a double subscription would yield 2
      expect(list[0]!.title).toBe("双 start 轮");
    } finally {
      stopDup();
      stopFirst();
    }
  });

  it("重复 start 的 stop 不拆首个订阅：终态仍落库", async () => {
    const stopFirst = startSessionPersistence();
    const stopDup = startSessionPersistence();
    try {
      stopDup(); // duplicate cleanup must be a no-op, not a teardown
      useEditorStore.setState({ projectId: "p-dup-stop" });
      useAiStore.setState({
        messages: [{ id: "u1", role: "user", text: "守卫仍在", streaming: false }],
        phase: "streaming",
      });
      useAiStore.setState({ phase: "idle", notice: "无需修改" });
      await flush();
      const list = await listSessionsByProject("p-dup-stop");
      expect(list).toHaveLength(1); // the first subscription survived the dup stop
      expect(list[0]!.title).toBe("守卫仍在");
    } finally {
      stopFirst();
    }
  });

  it("严格 [start→stop→start→终态]：重启后订阅唯一，只落 1 条", async () => {
    const stopFirst = startSessionPersistence();
    stopFirst(); // real teardown releases the guard
    const stopSecond = startSessionPersistence();
    try {
      useEditorStore.setState({ projectId: "p-restart" });
      useAiStore.setState({
        messages: [{ id: "u1", role: "user", text: "重启后一轮", streaming: false }],
        phase: "streaming",
      });
      useAiStore.setState({ phase: "awaiting-confirm", pendingPlan: { plan: "p" } });
      await flush();
      const list = await listSessionsByProject("p-restart");
      expect(list).toHaveLength(1);
      expect(list[0]!.messages.map((m) => m.id)).toEqual(["u1"]);
    } finally {
      stopSecond();
    }
  });
});
