import { useCallback, useEffect, useState } from "react";
import {
  deleteSession,
  listSessionsByProject,
} from "../../db/repo";
import type { SessionRecord } from "../../db/db";

/**
 * W1-B: persisted AI session history (read-only replay list).
 *
 * Mount interface: AiChatPanel integration is a micro follow-up (W1-A writes
 * the panel this round), so `<SessionHistory projectId=... />` is a standalone
 * component today. The optional `replay`/`onLoad` props receive the pruned
 * message list when the user clicks a session; the host decides how to render.
 */

/** Format "2026-09-18T12:34:56.789Z" as a short local label. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
        d.getMinutes(),
      ).padStart(2, "0")}`;
}

/** Outcome badge derived from the last archived activity (error turns stay visible). */
function outcomeLabel(s: SessionRecord): string | null {
  const last = [...s.messages].reverse().find((m) => m.kind === "activity" && m.activity);
  if (!last?.activity) return null;
  if (last.activity.status === "error") return "失败";
  if (last.activity.status === "canceled") return "已取消";
  return null;
}

interface SessionRowProps {
  session: SessionRecord;
  open: boolean;
  onToggle: (s: SessionRecord) => void;
  onReplay: (s: SessionRecord) => void;
  onDelete: (s: SessionRecord) => void;
}

/** One history row: title + time + outcome badge, expandable message preview. */
function SessionRow({ session, open, onToggle, onReplay, onDelete }: SessionRowProps) {
  const badge = outcomeLabel(session);
  return (
    <li>
      <div className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors duration-150 hover:bg-rail">
        <button
          type="button"
          onClick={() => onToggle(session)}
          aria-expanded={open}
          className="studio-transition min-w-0 flex-1 truncate text-left text-ink"
          title={session.title}
        >
          {session.title}
          <span className="ml-2 text-xs text-ink-muted">{formatTime(session.updatedAt)}</span>
          {badge && (
            <span className="ml-2 rounded border border-danger/30 px-1 text-[10px] text-danger">
              {badge}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onReplay(session)}
          className="studio-transition rounded-md border border-hairline-strong px-2 h-6 text-xs font-medium text-ink-soft hover:bg-canvas hover:text-ink"
        >
          载入回放
        </button>
        <button
          type="button"
          onClick={() => onDelete(session)}
          className="studio-transition rounded-md border border-hairline-strong px-2 h-6 text-xs font-medium text-ink-soft hover:border-danger hover:text-danger"
        >
          删除
        </button>
      </div>
      {open && (
        <div className="mx-2 mb-1 space-y-1 rounded-md border border-hairline bg-canvas p-2 text-xs">
          {session.messages.map((m) => (
            <p key={m.id} className={m.role === "user" ? "text-ink" : "text-ink-soft"}>
              <span className="mr-1 font-medium">{m.role === "user" ? "我：" : "AI："}</span>
              {m.kind === "activity" ? (m.activity?.resultTitle ?? "（执行时间线）") : m.text}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}

export interface SessionHistoryProps {
  projectId: string;
  /** Click handler for read-only replay; host owns how the messages render. */
  onReplay?: (session: SessionRecord) => void;
  /** Convenience alias used by tests / future panel mount (same as onReplay). */
  onLoad?: (session: SessionRecord) => void;
}

export function SessionHistory({ projectId, onReplay, onLoad }: SessionHistoryProps) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSessions(await listSessionsByProject(projectId));
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleToggle = (s: SessionRecord): void =>
    setOpenId((cur) => (cur === s.sessionId ? null : s.sessionId));

  const handleReplay = (s: SessionRecord): void => {
    onReplay?.(s);
    onLoad?.(s);
  };

  const handleDelete = async (s: SessionRecord): Promise<void> => {
    await deleteSession(projectId, s.sessionId);
    setOpenId((cur) => (cur === s.sessionId ? null : cur));
    void refresh();
  };

  if (sessions.length === 0) {
    return (
      <div className="p-3 text-xs text-ink-muted" aria-label="会话历史">
        暂无历史会话。
      </div>
    );
  }

  return (
    <div aria-label="会话历史" className="flex min-h-0 flex-col text-sm">
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {sessions.map((s) => (
          <SessionRow
            key={s.sessionId}
            session={s}
            open={openId === s.sessionId}
            onToggle={handleToggle}
            onReplay={handleReplay}
            onDelete={(row) => void handleDelete(row)}
          />
        ))}
      </ul>
    </div>
  );
}
