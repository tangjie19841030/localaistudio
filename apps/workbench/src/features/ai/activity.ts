import type { ChatEvent } from "../../api/client";
import { commandLabel, type CommandDomain } from "./commandLabels";
import type { ToolkitCommand } from "./types";

/**
 * Live "what the AI is doing" timeline for one chat turn. Pure reducers —
 * aiStore owns the zustand state and just threads its current `activity`
 * through these, keeping every transition unit-testable (same pattern as
 * events.ts's visibilityPatch).
 *
 * Frame mapping:
 *   stage / verify-round → stage step (model rounds are numbered locally)
 *   tool-call            → tool step (running), label is the Chinese command title
 *   tool-result          → closes the matching running tool step (ok/failed + summary)
 *   delta (toolkit only) → thought step, streamed text accumulates in place
 *   partial done batch   → batch step ("已应用一批变更（N 条）")
 *   violation            → notice step (warning, the run keeps going)
 *   terminal frame       → finishActivity(): converge running steps, stamp the title
 */

export type ActivityStepKind = "stage" | "tool" | "thought" | "batch" | "notice";
export type ActivityStepStatus = "running" | "done" | "failed";
export type ActivityStatus = "live" | "done" | "error" | "canceled";

export interface ActivityStep {
  id: string;
  kind: ActivityStepKind;
  /** Primary line: stage label / command Chinese title / "模型思考" / batch line. */
  label: string;
  status: ActivityStepStatus;
  startedAt: number;
  endedAt?: number;
  /** Secondary line: tool-result summary, failure reason, thought text, issue list. */
  detail?: string;
  /** Model round / verify round (display only). */
  round?: number;
  /** Raw tool name for result matching; stage id for stage-step dedupe. */
  name?: string;
}

export interface ActivityState {
  id: string;
  startedAt: number;
  endedAt?: number;
  status: ActivityStatus;
  steps: ActivityStep[];
  /** UI pipeline only: server progress frame (N/total tool calls). */
  progress?: { step: number; total: number };
  /** One-line conclusion used by the collapsed card header. */
  resultTitle?: string;
  errorMessage?: string;
}

let activitySeq = 0;
const nextStepId = (): string => {
  activitySeq += 1;
  return `act-step-${activitySeq}`;
};

export function startActivity(id: string, now: number): ActivityState {
  return { id, startedAt: now, status: "live", steps: [] };
}

function withSteps(a: ActivityState, steps: ActivityStep[]): ActivityState {
  return { ...a, steps };
}

/** Mark the last running step of a kind (or any running stage/thought) done. */
function closeRunning(
  steps: ActivityStep[],
  now: number,
  predicate: (s: ActivityStep) => boolean,
): ActivityStep[] {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.status !== "running") continue;
    if (!predicate(s)) continue;
    const copy = steps.slice();
    copy[i] = { ...s, status: "done", endedAt: now };
    return copy;
  }
  return steps;
}

const isThought = (s: ActivityStep): boolean => s.kind === "thought";
const isStageOrThought = (s: ActivityStep): boolean => s.kind === "stage" || s.kind === "thought";

/** Server stage labels already end with "…"; the card owns the running ellipsis. */
function stripEllipsis(label: string): string {
  return label.replace(/\s*[…⋯.]+\s*$/u, "").trim();
}

/**
 * stage frame: group heading. A repeated stage id while the previous one is
 * still the last step updates it in place; a new id closes it and appends.
 * Model rounds are numbered ("模型思考中（第 N 轮）" from N=2 on).
 */
export function activityOnStage(
  a: ActivityState,
  ev: Extract<ChatEvent, { type: "stage" }>,
  now: number,
): ActivityState {
  const modelRounds = a.steps.filter((s) => s.kind === "stage" && s.name === "model").length + 1;
  const round = ev.round ?? (ev.id === "model" ? modelRounds : undefined);
  const baseLabel = stripEllipsis(ev.label);
  const label = ev.id === "model" && modelRounds > 1 ? `${baseLabel}（第 ${modelRounds} 轮）` : baseLabel;
  let steps = closeRunning(a.steps, now, isStageOrThought);
  const last = steps[steps.length - 1];
  if (last && last.kind === "stage" && last.status === "running" && last.name === ev.id) {
    steps = steps.slice();
    steps[steps.length - 1] = { ...last, label, round };
  } else {
    steps = [...steps, { id: nextStepId(), kind: "stage", name: ev.id, label, status: "running", startedAt: now, round }];
  }
  return withSteps(a, steps);
}

/** verify-round frame: warning stage step carrying the unresolved issues. */
export function activityOnVerifyRound(
  a: ActivityState,
  ev: Extract<ChatEvent, { type: "verify-round" }>,
  label: string,
  now: number,
): ActivityState {
  const steps = closeRunning(a.steps, now, isStageOrThought);
  return withSteps(a, [
    ...steps,
    {
      id: nextStepId(),
      kind: "stage",
      name: "verify",
      label: `${stripEllipsis(label)}（第 ${ev.round} 轮）`,
      status: "running",
      startedAt: now,
      round: ev.round,
      detail: ev.issues.join("；"),
    },
  ]);
}

/** progress frame: UI pipeline's N/total counter, shown in the card header. */
export function activityOnProgress(
  a: ActivityState,
  ev: Extract<ChatEvent, { type: "progress" }>,
): ActivityState {
  return { ...a, progress: { step: ev.step, total: ev.total } };
}

/** tool-call frame: freeze the current thought and append a running tool step. */
export function activityOnToolCall(
  a: ActivityState,
  name: string,
  domain: CommandDomain,
  now: number,
): ActivityState {
  const steps = closeRunning(a.steps, now, isThought);
  return withSteps(a, [
    ...steps,
    {
      id: nextStepId(),
      kind: "tool",
      name,
      label: commandLabel(domain, name),
      status: "running",
      startedAt: now,
    },
  ]);
}

/** tool-result frame: close the LAST running tool step with the same raw name. */
export function activityOnToolResult(
  a: ActivityState,
  name: string,
  ok: boolean,
  message: string,
  now: number,
): ActivityState {
  const steps = a.steps.slice();
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.kind === "tool" && s.status === "running" && s.name === name) {
      steps[i] = { ...s, status: ok ? "done" : "failed", endedAt: now, detail: message };
      break;
    }
  }
  return withSteps(a, steps);
}

/**
 * Streamed model text (toolkit turns). Consecutive deltas accumulate into one
 * live thought step; any other step type freezes it (see closeRunning calls).
 */
export function activityAppendThought(a: ActivityState, text: string, now: number): ActivityState {
  if (!text) return a;
  const last = a.steps[a.steps.length - 1];
  if (last && last.kind === "thought" && last.status === "running") {
    const steps = a.steps.slice();
    steps[steps.length - 1] = { ...last, detail: `${last.detail ?? ""}${text}` };
    return withSteps(a, steps);
  }
  return withSteps(a, [
    ...a.steps,
    { id: nextStepId(), kind: "thought", label: "模型思考", status: "running", startedAt: now, detail: text },
  ]);
}

/** partial:true done frame: one batch of commands was auto-applied locally. */
export function activityOnBatch(
  a: ActivityState,
  commands: readonly ToolkitCommand[],
  now: number,
): ActivityState {
  if (commands.length === 0) return a;
  const titles = commands.map((c) => c.title).join("；");
  const steps = closeRunning(a.steps, now, isThought);
  return withSteps(a, [
    ...steps,
    {
      id: nextStepId(),
      kind: "batch",
      label: `已应用一批变更（${commands.length} 条）`,
      status: "done",
      startedAt: now,
      endedAt: now,
      detail: titles,
    },
  ]);
}

/** violation frame: scope gate rejected a call; the server auto-retries. */
export function activityOnViolation(a: ActivityState, items: string[], now: number): ActivityState {
  return withSteps(a, [
    ...a.steps,
    {
      id: nextStepId(),
      kind: "notice",
      label: "操作超出允许范围，已自动重试",
      status: "done",
      startedAt: now,
      endedAt: now,
      detail: items.join("；"),
    },
  ]);
}

/** Count of successfully executed tool operations in a (possibly live) activity. */
export function activityDoneOpCount(a: ActivityState): number {
  return a.steps.filter((s) => s.kind === "tool" && s.status === "done").length;
}

function defaultTitle(a: ActivityState): string {
  const ops = activityDoneOpCount(a);
  const seconds = (((a.endedAt ?? 0) - a.startedAt) / 1000).toFixed(0);
  if (a.status === "error") return "执行中断";
  if (a.status === "canceled") return `已取消 · 已完成 ${ops} 个操作 · 耗时 ${seconds}s`;
  if (ops > 0) return `已完成 · ${ops} 个操作 · 耗时 ${seconds}s`;
  return `已完成 · 耗时 ${seconds}s`;
}

/**
 * Terminal convergence: settle every running step (failed on error, done
 * otherwise — a canceled turn must not paint in-flight steps red), stamp the
 * end time and the collapsed-card title.
 */
export function finishActivity(
  a: ActivityState,
  status: Exclude<ActivityStatus, "live">,
  now: number,
  opts?: { title?: string; errorMessage?: string },
): ActivityState {
  const settled = a.steps.map((s) => {
    if (s.status !== "running") return s;
    // Only in-flight TOOL steps paint red on error; interrupted stages and
    // thoughts are neutral (they did not fail — the turn did).
    const stepStatus: ActivityStepStatus = status === "error" && s.kind === "tool" ? "failed" : "done";
    return { ...s, status: stepStatus, endedAt: now };
  });
  const ended: ActivityState = {
    ...a,
    status,
    endedAt: now,
    steps: settled,
    ...(opts?.errorMessage ? { errorMessage: opts.errorMessage } : {}),
  };
  return { ...ended, resultTitle: opts?.title ?? defaultTitle(ended) };
}
