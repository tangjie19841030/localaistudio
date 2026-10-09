import type { StudioDocument, PatchOp } from "@studio/schema-core";
import type { CommandInvocation } from "@studio/studio-core";
import type { ActivityState } from "./activity";

/**
 * Frozen P7.3 toolkit AI contract (shared by aiStore, payload, registry and the
 * toolkit editor stores): the ppt/word request scope shape, the done-frame
 * command shape and the local replay applier. The chat-log/plan/phase types
 * moved here from aiStore so feature modules share one AI type surface.
 */

/** UI model of the AI turn lifecycle (drives composer/card/chip rendering). */
export type AiPhase = "idle" | "streaming" | "awaiting-confirm" | "error";

/** One chat log entry (user/assistant bubble or an archived activity timeline). */
export interface ChatLogMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming: boolean;
  /**
   * "activity" entries are archived turn timelines (no bubble chrome; rendered
   * as ActivityCard). Default "bubble" is the normal chat message.
   */
  kind?: "bubble" | "activity";
  /** Present iff kind === "activity". */
  activity?: ActivityState;
}

/** One executed tool step from the agent loop (tool-result SSE frame, P6). */
export interface ToolTraceStep {
  name: string;
  ok: boolean;
  message: string;
}

/** Change-plan payload shown in the confirm card (spec §5.2 three-element rule). */
export interface PendingPlan {
  plan: string;
  ops?: PatchOp[];
  document?: StudioDocument;
  /** P7.3 toolkit done-frame commands (server pre-executed); replayed locally. */
  commands?: ToolkitCommand[];
  /** Request scope the commands were pre-executed under; replay reuses it. */
  scope?: ToolkitScope;
  /** Agent-loop execution trace; feeds the confirm-card summary (P6). */
  toolTrace?: ToolTraceStep[];
  /** T61 W3-B: extra generate candidates; confirm-card tab i applies alternatives[i-1]. */
  alternatives?: StudioDocument[];
}

export interface SendRequest {
  projectId: string;
  text: string;
  mode: "plan" | "generate" | "patch";
  /** UI projects: {nodeIds,allowAllTokens}; toolkit projects: {kind,targetIds} (P7.3). */
  scope?: { nodeIds?: string[]; allowAllTokens?: boolean } | ToolkitScope;
  /** Toolkit domain for Chinese command labels on the activity timeline. */
  toolkit?: "ppt" | "word";
  /**
   * Multimodal attachments (base64 data URLs) for THIS turn only; they ride on
   * the outbound user message and are never stored in the chat log.
   */
  images?: string[];
  /** T61 OP-3: total generate candidates 2|3 (server T60 contract); other modes ignore (OP-6). */
  variants?: 2 | 3;
}

/** Toolkit request scope (ppt/word) — UI projects keep {nodeIds,allowAllTokens}. */
export interface ToolkitScope {
  kind: "file" | "container" | "selection";
  targetIds: string[];
}

/**
 * One done-frame command. The server already pre-executed it successfully on
 * its scratch envelope; the frontend replays it locally (executeTransaction)
 * after user confirmation.
 */
export interface ToolkitCommand {
  invocationId: string;
  commandId: string;
  title: string;
  riskLevel: "low" | "medium" | "high";
  args: unknown;
  summary?: string;
}

/**
 * Registered by the toolkit editor stores (App wiring) to replay commands
 * locally. `scope` overrides the pending-plan scope for progressive (partial)
 * batches, which land before the final done frame creates the pending plan.
 */
export type ToolkitCommandApplier = (
  commands: readonly ToolkitCommand[],
  scope?: ToolkitScope,
) => Promise<boolean>;

/** Structural guard for the SendRequest scope union (toolkit-shaped branch). */
export function isToolkitScope(value: unknown): value is ToolkitScope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<ToolkitScope>;
  return (
    (v.kind === "file" || v.kind === "container" || v.kind === "selection") &&
    Array.isArray(v.targetIds) &&
    v.targetIds.every((id) => typeof id === "string")
  );
}

/** Map a done-frame command to a local ai-source invocation for replay. */
export function toolkitInvocation(command: ToolkitCommand, scope: ToolkitScope): CommandInvocation {
  return {
    invocationId: command.invocationId,
    id: command.commandId,
    args: command.args,
    source: "ai",
    scope,
  };
}
