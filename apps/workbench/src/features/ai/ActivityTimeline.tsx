import { useEffect, useState, type ReactNode } from "react";
import type { ActivityState, ActivityStep } from "./activity";

/**
 * Turn-level "what the AI is doing" timeline card. Renders live at the end of
 * the message list while a turn streams; the finished card is archived into
 * the messages and collapses to its one-line header (click to expand the full
 * step history).
 */

function useElapsedTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** 0.8s / 12s style; sub-second readings stay compact. */
function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-3 w-3 shrink-0 animate-spin self-center rounded-full border-[1.5px] border-accent/30 border-t-accent ${className}`}
    />
  );
}

function StepIcon({ step }: { step: ActivityStep }) {
  if (step.status === "running") return <Spinner />;
  if (step.status === "failed") {
    return (
      <span aria-hidden className="self-center text-[11px] font-bold leading-none text-danger">
        ✗
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`self-center text-[10px] font-bold leading-none ${
        step.kind === "notice" ? "text-warn" : "text-success"
      }`}
    >
      ✓
    </span>
  );
}

/** Long result summaries / model thoughts: clamp to N chars with inline expand. */
function ExpandableText({ text, className, limit = 140 }: { text: string; className?: string; limit?: number }) {
  const [open, setOpen] = useState(false);
  if (text.length <= limit) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {open ? text : `${text.slice(0, limit)}…`}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-1 shrink-0 text-accent hover:underline"
      >
        {open ? "收起" : "展开"}
      </button>
    </span>
  );
}

function StepRow({ step }: { step: ActivityStep }) {
  const duration =
    step.endedAt && step.status !== "running" ? formatDuration(step.endedAt - step.startedAt) : null;

  if (step.kind === "stage") {
    return (
      <div className="flex items-center gap-1.5 py-0.5 font-medium text-ink">
        <StepIcon step={step} />
        <span className="min-w-0 truncate">{step.label}</span>
        {step.status === "running" && <span className="text-ink-muted">…</span>}
      </div>
    );
  }

  // tool / thought / batch / notice hang under their stage heading.
  let icon: ReactNode = <StepIcon step={step} />;
  let title = step.label;
  let titleClass = "text-ink-soft";
  let detail: ReactNode = null;

  if (step.kind === "thought") {
    return (
      <div className="ml-1.5 flex gap-1.5 border-l border-hairline py-0.5 pl-3 text-ink-muted">
        <span aria-hidden className="shrink-0 text-[10px] leading-5">
          💭
        </span>
        <ExpandableText
          text={step.detail ?? ""}
          className="whitespace-pre-wrap break-words leading-5"
          limit={160}
        />
      </div>
    );
  }

  if (step.kind === "tool") {
    titleClass = step.status === "failed" ? "text-danger" : "text-ink-soft";
    if (step.detail) {
      detail =
        step.status === "failed" ? (
          <ExpandableText text={step.detail} className="text-danger" limit={120} />
        ) : (
          <ExpandableText text={step.detail} className="text-ink-muted" limit={80} />
        );
    }
  } else if (step.kind === "batch") {
    titleClass = "text-success";
    if (step.detail) detail = <ExpandableText text={step.detail} className="text-ink-muted" limit={80} />;
  } else if (step.kind === "notice") {
    titleClass = "text-warn";
    if (step.detail) detail = <ExpandableText text={step.detail} className="text-warn/80" limit={120} />;
  }

  return (
    <div className="ml-1.5 flex items-start gap-1.5 border-l border-hairline py-0.5 pl-3">
      {icon}
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 leading-5">
        <span className={titleClass}>{title}</span>
        {duration && (
          <span className="shrink-0 text-[10px] tabular-nums text-ink-muted">{duration}</span>
        )}
        {detail && <span className="basis-full text-[11px] leading-4">{detail}</span>}
      </div>
    </div>
  );
}

export function ActivityCard({ activity, live = false }: { activity: ActivityState; live?: boolean }) {
  const now = useElapsedTicker(live);
  // Archived cards start collapsed; a live card stays expanded for its whole run.
  const [userOpen, setUserOpen] = useState(false);
  const expanded = live || userOpen;
  const elapsed = (live ? now : activity.endedAt ?? now) - activity.startedAt;

  const tone =
    activity.status === "error"
      ? "border-danger/30 bg-danger-soft/40"
      : live
        ? "border-accent/30 bg-accent-soft/40"
        : "border-hairline bg-surface";

  const headerButton = (
    <button
      type="button"
      onClick={() => setUserOpen((v) => !v)}
      disabled={live}
      className={`flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] ${
        live ? "cursor-default" : "cursor-pointer"
      }`}
      aria-expanded={expanded}
    >
      {live ? (
        <Spinner />
      ) : (
        <span
          aria-hidden
          className={`text-[11px] font-bold leading-none ${
            activity.status === "error"
              ? "text-danger"
              : activity.status === "canceled"
                ? "text-ink-muted"
                : "text-success"
          }`}
        >
          {activity.status === "error" ? "✗" : activity.status === "canceled" ? "○" : "✓"}
        </span>
      )}
      <span
        title={live ? undefined : activity.resultTitle}
        className={`truncate font-medium ${
          activity.status === "error"
            ? "text-danger"
            : live
              ? "text-accent"
              : activity.status === "canceled"
                ? "text-ink-muted"
                : "text-ink"
        }`}
      >
        {live ? "AI 执行中" : activity.resultTitle ?? "已完成"}
      </span>
      <span className="shrink-0 tabular-nums text-ink-muted">
        {live
          ? `· 已用时 ${formatDuration(elapsed)}${
              activity.progress ? ` · ${activity.progress.step}/${activity.progress.total} 步` : ""
            }`
          : ""}
      </span>
      {!live && (
        <span className="ml-auto shrink-0 text-ink-muted">{userOpen ? "收起 ⌃" : "展开 ⌄"}</span>
      )}
    </button>
  );

  return (
    <div
      role="group"
      aria-label={live ? "AI 执行过程（进行中）" : "AI 执行过程"}
      className={`rounded-xl border px-2.5 py-2 ${tone}`}
    >
      <div className="flex items-center gap-1.5">{headerButton}</div>
      {activity.status === "error" && activity.errorMessage && !live && (
        <p className="mt-1 truncate text-[11px] text-danger" title={activity.errorMessage}>
          {activity.errorMessage}
        </p>
      )}
      {expanded && activity.steps.length > 0 && (
        <div className="mt-1.5 flex flex-col text-[11px]">
          {activity.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}
