import { useEffect, useRef, useState } from "react";
import { normalizeJsonText } from "../../utils/json";
import { useAiStore } from "../../state/aiStore";
import { useEditorStore, isUiDoc } from "../../state/editorStore";
import { ActivityCard } from "./ActivityTimeline";

/** Collapse raw model dumps / prompt echoes into a readable one-liner. */
function bubbleText(m: { text: string; role: string }, prev?: { text: string; role: string }): string {
  const raw = m.text;
  if (m.role !== "assistant") {
    // User repair prompts can be long but stay scannable; only trim extreme.
    if (raw.length > 1200) return `${raw.slice(0, 800)}\n…（已截断，共 ${raw.length} 字）`;
    return raw;
  }
  // Model echoed the previous user prompt (or a large prefix of it) verbatim.
  const prevUser = prev && prev.role === "user" ? prev.text.trim() : "";
  if (prevUser.length > 40 && raw.trim().startsWith(prevUser.slice(0, 80))) {
    return "（模型回显了输入内容，未给出可读的变更摘要）";
  }
  const trimmed = raw.trimStart();
  // Never render a document/schema dump into the chat bubble.
  if (trimmed.startsWith("{") && raw.length > 400) {
    try {
      const parsed = JSON.parse(normalizeJsonText(raw)) as { plan?: unknown; document?: unknown; ops?: unknown };
      if (typeof parsed.plan === "string" && parsed.plan.trim()) return parsed.plan;
    } catch {
      // fall through
    }
    return "（响应包含大段结构化数据，已折叠；详见确认卡 / 运行日志）";
  }
  if (raw.length > 600) {
    return `${raw.slice(0, 400)}\n…（已截断，共 ${raw.length} 字）`;
  }
  return raw;
}

/** Assistant mark: a small gradient orb (streaming adds a soft glow pulse). */
export function AssistantMark({ live }: { live: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-[oklch(0.7_0.17_200)] text-[10px] font-bold text-white ${
        live ? "shadow-[0_0_12px_var(--color-accent)]" : ""
      }`}
    >
      AI
    </span>
  );
}

/** User mark: neutral initial disc. */
export function UserMark() {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-rail text-[10px] font-bold text-ink-muted ring-1 ring-hairline"
    >
      我
    </span>
  );
}

/** Empty state: suggestion chips adapt to selection / document depth. */
function EmptyState({
  onPick,
  selectedId,
  hasContent,
}: {
  onPick: (text: string) => void;
  selectedId: string | null;
  hasContent: boolean;
}) {
  const suggestions = selectedId
    ? [
        "把这里改紧凑一点",
        "突出主数据，弱化次要信息",
        "换成警告色强调",
        "只改这个区块的间距",
      ]
    : hasContent
      ? [
          "整体换成暖色品牌色",
          "给页面加一个订单数据表",
          "移动端优先，压缩导航",
          "检查并简化视觉层级",
        ]
      : [
          "生成一个运营数据看板",
          "做一个登录 + 设置页",
          "生成落地页：英雄区 + 功能栅格",
          "整体换成暖色品牌色",
        ];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-3 text-center">
      <span
        aria-hidden
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-[oklch(0.7_0.17_200)] text-xs font-bold text-white"
      >
        AI
      </span>
      <p className="text-xs font-medium text-ink">描述你想要的页面，AI 直接生成</p>
      <p className="text-[11px] leading-4 text-ink-muted">
        {selectedId
          ? "已选中节点：指令将限制在该范围内"
          : "生成后可继续对话局部修改，或点选组件手动调整"}
      </p>
      <div className="mt-1 flex flex-col gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="studio-transition rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-[11px] text-ink-soft hover:border-accent hover:text-accent"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Message list body: assistant messages align left with the AI mark, user
 * messages align right; streaming renders a breathing cursor; tool progress
 * (P6) stays a small chrome-free row. Auto-scrolls to the newest message.
 */
export function MessageList({
  onPickSuggestion,
  selectedId,
}: {
  onPickSuggestion: (text: string) => void;
  selectedId: string | null;
}) {
  const messages = useAiStore((s) => s.messages);
  const activity = useAiStore((s) => s.activity);
  const document = useEditorStore((s) => s.document);
  const hasContent = Boolean(isUiDoc(document) && document.pages[0]!.nodes.length > 1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streaming = messages.some((m) => m.streaming) || activity?.status === "live";

  // G3: per-turn scope trace, display-only via CustomEvent (never in log text / outbound).
  const [traces, setTraces] = useState<Record<string, string>>({});
  useEffect(() => {
    const onScopeTrace = (e: Event): void => {
      const text = (e as CustomEvent<string | null>).detail;
      const lastUser = [...useAiStore.getState().messages].reverse().find((m) => m.role === "user");
      if (text && lastUser) setTraces((prev) => ({ ...prev, [lastUser.id]: text }));
    };
    window.addEventListener("studio-ai-scope-trace", onScopeTrace);
    return () => window.removeEventListener("studio-ai-scope-trace", onScopeTrace);
  }, []);

  useEffect(() => {
    // Keep the newest message in view while streaming. jsdom lacks
    // scrollIntoView — guard so tests don't need a polyfill.
    bottomRef.current?.scrollIntoView?.({ block: "end", behavior: streaming ? "smooth" : "instant" });
  }, [messages, streaming, activity?.steps.length]);

  if (messages.length === 0) {
    return (
      <div className="min-h-0 flex-1">
        <EmptyState onPick={onPickSuggestion} selectedId={selectedId} hasContent={hasContent} />
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {messages.map((m, i) => {
        // Archived turn timeline: card instead of a chat bubble.
        if (m.kind === "activity" && m.activity) {
          return (
            <li key={m.id} className="pl-9">
              <ActivityCard activity={m.activity} />
            </li>
          );
        }
        const isUser = m.role === "user";
        const display = bubbleText(m, messages[i - 1]);
        return (
          <li key={m.id} className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
            {isUser ? <UserMark /> : <AssistantMark live={m.streaming} />}
            <div
              className={`chat-message max-w-[85%] rounded-xl px-3 py-2 text-xs leading-5 ${
                isUser
                  ? "rounded-tr-sm border border-hairline bg-surface text-ink"
                  : "rounded-tl-sm border border-accent/25 bg-accent-soft text-ink"
              }`}
            >
              <span className="whitespace-pre-wrap break-words">{display}</span>
              {isUser && traces[m.id] && (
                <span className="mt-0.5 block text-[10px] text-ink-muted">{traces[m.id]}</span>
              )}
              {m.streaming && (
                <span aria-hidden className="typing-cursor ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 rounded-[1px] bg-accent"
                />
              )}
            </div>
          </li>
        );
      })}
      {activity && (
        <li className="pl-9">
          <ActivityCard activity={activity} live />
        </li>
      )}
      <div ref={bottomRef} />
    </ul>
  );
}
