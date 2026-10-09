import { saveSession } from "../../db/repo";
import { log } from "../../state/logStore";
import { useAiStore } from "../../state/aiStore";
import { useEditorStore } from "../../state/editorStore";
import type { ActivityState } from "./activity";
import type { ChatLogMessage } from "./types";

/**
 * W1-B session persistence: subscribes to aiStore terminal transitions and
 * mirrors each finished turn into the Dexie `sessions` table. aiStore internals
 * are NOT touched — everything is read via subscribe/getState (same data flow
 * the roadmap §6 W1-B card prescribes).
 *
 * Turn model: one session record per AI turn. The turn's message window is
 * [boundary, end) where `boundary` is the log length already accounted for by
 * previous turns / clear(); title = first user message (≤80 chars).
 *
 * Pruning policy (roadmap §7 contract):
 *   - dataURL images  → short "[图片已裁剪：<mime>]" reference
 *   - tool trace      → activity steps capped (count 20, detail 200 chars)
 *   - message text    → capped at 4000 chars (generated document dumps)
 */

const TITLE_MAX = 80;
const TEXT_MAX = 4000;
const MAX_STEPS = 20;
const STEP_DETAIL_MAX = 200;

/** Replace one base64 data URL with a compact human-readable reference. */
function dataUrlRef(url: string): string {
  const mime = url.slice(5, url.indexOf(";")) || "image";
  return `[图片已裁剪：${mime}]`;
}

const DATA_URL_RE = /data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/gi;

/** Cap stored text: dataURLs → references, then hard length cap with marker. */
export function pruneText(text: string): string {
  const refed = text.replace(DATA_URL_RE, (m) => dataUrlRef(m));
  if (refed.length <= TEXT_MAX) return refed;
  return `${refed.slice(0, TEXT_MAX)}\n…（已截断，共 ${refed.length} 字）`;
}

/** Truncate one archived activity timeline (the turn's tool trace mirror). */
function pruneActivity(a: ActivityState): ActivityState {
  const steps = a.steps.slice(0, MAX_STEPS).map((s) => ({
    ...s,
    ...(s.detail && s.detail.length > STEP_DETAIL_MAX
      ? { detail: `${s.detail.slice(0, STEP_DETAIL_MAX)}…（已截断）` }
      : {}),
  }));
  return { ...a, steps };
}

/** Pruned copy of a turn's messages — the exact shape stored in `sessions`. */
export function pruneMessages(messages: ChatLogMessage[]): ChatLogMessage[] {
  return messages.map((m) => ({
    ...m,
    text: pruneText(m.text),
    ...(m.activity ? { activity: pruneActivity(m.activity) } : {}),
  }));
}

/** First user message, whitespace-trimmed, ≤80 chars (roadmap §7). */
export function sessionTitle(messages: ChatLogMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = pruneText(first?.text ?? "").trim();
  return text.length > TITLE_MAX ? text.slice(0, TITLE_MAX) : text || "（无文本）";
}

// ---- subscription wiring (started explicitly by app wiring) ----

let turnProjectId: string | null = null;
/** Message-list index where the in-flight turn's window begins. */
let turnWindowStart = 0;

/** Store one finished turn (messages since `start`) as a session record. */
async function persistTurn(projectId: string, start: number): Promise<void> {
  const turnMessages = useAiStore.getState().messages.slice(start);
  if (turnMessages.length === 0 || !turnMessages.some((m) => m.role === "user")) return;
  const now = new Date().toISOString();
  try {
    await saveSession({
      sessionId: crypto.randomUUID(),
      projectId,
      title: sessionTitle(turnMessages),
      messages: pruneMessages(turnMessages),
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    log("error", "ai", `会话历史落库失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

function onAiStateChange(state: AiStateSnapshot, prev: AiStateSnapshot): void {
  if (state.phase === "streaming" && prev.phase !== "streaming") {
    // Turn start: send() appends the user bubble + placeholder in the SAME
    // set() that flips phase, so the window begins at the pre-send log length.
    // Re-snapshotted every start, so clear() (project switch) self-heals.
    turnProjectId = useEditorStore.getState().projectId;
    turnWindowStart = prev.messages.length;
    return;
  }
  if (prev.phase !== "streaming" || state.phase === "streaming") return;
  // Terminal transition: cancel (idle, no notice) is intentionally not persisted,
  // but the window is consumed either way — the NEXT turn re-snapshots at start.
  const start = turnWindowStart;
  const outcome =
    state.phase === "awaiting-confirm"
      ? "done"
      : state.phase === "error"
        ? "error"
        : state.notice
          ? "notice"
          : "canceled";
  const projectId = turnProjectId;
  if (outcome !== "canceled" && projectId) {
    // Deferred one tick: the terminal set() cascade (activity archive) is
    // synchronous, so a microtask observes the complete final message list.
    queueMicrotask(() => void persistTurn(projectId, start));
  }
}

type AiStateSnapshot = ReturnType<typeof useAiStore.getState>;

let active = false; // idempotency guard: StrictMode mounts start twice

/**
 * Start mirroring terminal AI turns into Dexie; returns a stop function.
 * Idempotent: a second start while already active is a no-op (StrictMode
 * double-invokes effects); the duplicate stop does not tear down the first.
 */
export function startSessionPersistence(): () => void {
  if (active) return () => {};
  active = true;
  turnProjectId = null;
  turnWindowStart = 0;
  const unsubscribe = useAiStore.subscribe(onAiStateChange);
  return () => {
    unsubscribe();
    active = false;
  };
}
