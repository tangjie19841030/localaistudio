import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { saveSession } from "../../db/repo";
import { useAiStore } from "../../state/aiStore";
import { useEditorStore } from "../../state/editorStore";
import { emptyStack } from "../../state/undoStack";
import { AiChatPanel } from "./AiChatPanel";

// W1-B mount follow-up: the 历史 tab renders SessionHistory for the open
// project; clicking 载入回放 hands the session to onReplay and falls back to
// the live chat view. fake-indexeddb backs the sessions table (setup.ts).

const PID = "p-history";

beforeEach(async () => {
  await db.sessions.clear();
  useEditorStore.setState({
    projectId: PID,
    meta: null,
    document: null,
    dirty: false,
    saving: false,
    error: null,
    selectedId: null,
    canUndo: false,
    canRedo: false,
    undoStack: emptyStack,
  });
  useAiStore.getState().clear();
});

const renderPanel = () => render(<AiChatPanel projectId={PID} selectedId={null} />);

describe("AiChatPanel 历史 tab（W1-B 挂载）", () => {
  it("切到历史 tab 渲染 SessionHistory，展示本项目落库会话", async () => {
    await saveSession({
      sessionId: "s1",
      projectId: PID,
      title: "把标题改短一点",
      messages: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    renderPanel();
    expect(screen.getByRole("tab", { name: "对话", selected: true })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "历史" }));
    expect(screen.getByRole("tab", { name: "历史", selected: true })).toBeTruthy();
    expect(await screen.findByText("把标题改短一点")).toBeTruthy();
    // Switching back restores the live chat view (its log region, not history).
    await userEvent.click(screen.getByRole("tab", { name: "对话" }));
    expect(screen.queryByText("载入回放")).toBeNull();
  });

  it("载入回放回调携带完整 session 并切回对话视图", async () => {
    const session = {
      sessionId: "s2",
      projectId: PID,
      title: "生成登录页",
      messages: [{ id: "m1", role: "user" as const, text: "生成登录页", streaming: false }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await saveSession(session);
    let replayed: unknown = null;
    render(<AiChatPanel projectId={PID} selectedId={null} onReplaySession={(s) => (replayed = s)} />);
    await userEvent.click(screen.getByRole("tab", { name: "历史" }));
    await userEvent.click(await screen.findByText("载入回放"));
    expect(replayed).toMatchObject({ sessionId: "s2", title: "生成登录页" });
    // Replay hands control back to the live chat (history list unmounts).
    await waitFor(() => expect(screen.queryByText("载入回放")).toBeNull());
  });

  it("无历史会话时历史 tab 显示空态", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("tab", { name: "历史" }));
    expect(await screen.findByText("暂无历史会话。")).toBeTruthy();
  });
});
