import { useState } from "react";
import { planScope, type Frame, type StudioDocument, type PatchOp } from "@studio/schema-core";
import { useEditorStore, isUiDoc } from "../../state/editorStore";
import { useAiStore } from "../../state/aiStore";
import type { PendingPlan, ToolTraceStep } from "./types";
import type { ToolkitCommand, ToolkitScope } from "./types";

/** Human-readable geometry of one frame; rotation hidden when 0. */
function frameText(f: Frame): string {
  const base = `位置 (${f.x}, ${f.y}) · 尺寸 ${f.w}×${f.h}`;
  return f.rotation === 0 ? base : `${base} · 旋转 ${f.rotation}°`;
}

/** setFrame diff line: arrow form only when the node already had a frame. */
function frameDiffLine(op: Extract<PatchOp, { op: "setFrame" }>, doc: StudioDocument | null): string {
  const before = doc?.pages[0]!.nodes.find((n) => n.id === op.nodeId)?.frame;
  if (!before) return frameText(op.frame);
  const moved = before.x !== op.frame.x || before.y !== op.frame.y;
  const resized = before.w !== op.frame.w || before.h !== op.frame.h;
  const parts: string[] = [];
  if (moved) parts.push(`位置 (${before.x}, ${before.y}) → (${op.frame.x}, ${op.frame.y})`);
  if (resized) parts.push(`尺寸 ${before.w}×${before.h} → ${op.frame.w}×${op.frame.h}`);
  if (before.rotation !== op.frame.rotation) {
    parts.push(`旋转 ${before.rotation}° → ${op.frame.rotation}°`);
  }
  return parts.length > 0 ? parts.join(" · ") : frameText(op.frame);
}

/** Human-readable lines for every spatial (setFrame) op in the plan. */
function frameDiffLines(plan: PendingPlan, doc: StudioDocument | null): string[] {
  if (!plan.ops) return [];
  return plan.ops
    .filter((op): op is Extract<PatchOp, { op: "setFrame" }> => op.op === "setFrame")
    .map((op) => frameDiffLine(op, doc));
}

/** ② involved nodes: ops are audited with planScope; whole-document plans name the doc. */
function involvedNodes(plan: PendingPlan, activeDoc?: StudioDocument): string {
  if (plan.commands) return toolkitScopeText(plan.scope);
  if (plan.ops) {
    const scope = planScope(plan.ops as PatchOp[]);
    return scope.nodeIds.join("、") || "(无节点改动)";
  }
  return (activeDoc ?? plan.document)?.name ?? "(未知文档)";
}

/** ③ impact summary: op count for patches, "整页生成" for full documents. */
function impactSummary(plan: PendingPlan): string {
  if (plan.commands) return `${plan.commands.length} 条命令`;
  if (plan.ops) return `${plan.ops.length} 个操作`;
  return "整页生成";
}

/** T61 W3-B: document behind the active candidate tab (0 = first-round plan.document). */
function activeDocument(plan: PendingPlan, tab: number): StudioDocument | undefined {
  if (tab > 0 && plan.alternatives?.length) {
    return plan.alternatives[tab - 1] ?? plan.document;
  }
  return plan.document;
}

/**
 * Agent-loop trace in one line (P6): step count + ok/fail tally; failures note
 * that their results were fed back to the model (it retried on its own).
 */
function toolTraceSummary(trace: ToolTraceStep[]): string {
  const ok = trace.filter((t) => t.ok).length;
  const failed = trace.length - ok;
  const parts = [`经 ${trace.length} 步：成功 ${ok} · 失败 ${failed}`];
  if (failed > 0) parts.push("失败项已回传模型");
  return parts.join(" · ");
}

/**
 * Confirm gate (spec §8): all three elements must be present — purpose (non-empty
 * plan), involved scope, impact summary — before 应用变更 is clickable.
 */
export function planElementsReady(plan: PendingPlan): boolean {
  return plan.plan.trim().length > 0 && involvedNodes(plan) !== "" && impactSummary(plan) !== "";
}

/** Per-command risk badge (P7.3): color encodes the risk level, never raw ids. */
const RISK_BADGE: Record<ToolkitCommand["riskLevel"], { label: string; className: string }> = {
  low: { label: "低风险", className: "bg-canvas text-ink-soft" },
  medium: { label: "中风险", className: "bg-warn-soft text-warn" },
  high: { label: "高风险", className: "bg-danger-soft text-danger" },
};

/** Human-readable plan scope for toolkit commands (范围 line). */
export function toolkitScopeText(scope: ToolkitScope | undefined): string {
  if (!scope) return "(未知范围)";
  const kindText =
    scope.kind === "file" ? "整个文件" : scope.kind === "container" ? "选中容器" : "选中对象";
  return scope.targetIds.length > 0 ? `${kindText} · ${scope.targetIds.length} 个目标` : kindText;
}

export interface ChangePlanCardProps {
  pendingPlan: PendingPlan | null;
  onConfirm: () => void;
  onDismiss: () => void;
  /** Toolkit plans: replay one pre-executed command locally (aiStore.acceptCommand). */
  onAcceptCommand?: (command: ToolkitCommand) => Promise<void> | void;
  /** Toolkit plans: drop one command without executing it (aiStore.skipCommand). */
  onSkipCommand?: (command: ToolkitCommand) => void;
  /** T61 W3-B: candidate tab picked; the card mirrors the index into aiStore itself. */
  onSelectAlternative?: (index: number) => void;
}

/** One command row: title/summary/risk badge + per-item accept/skip buttons. */
function CommandItem({
  command,
  busy,
  onAccept,
  onSkip,
}: {
  command: ToolkitCommand;
  busy: boolean;
  onAccept: (command: ToolkitCommand) => void;
  onSkip: (command: ToolkitCommand) => void;
}) {
  const badge = RISK_BADGE[command.riskLevel];
  return (
    <li className="rounded-lg border border-hairline bg-surface px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
          {badge.label}
        </span>
        <span className="min-w-0 truncate font-medium text-ink" title={command.title}>
          {command.title}
        </span>
      </div>
      {command.summary && (
        <p className="mt-0.5 text-[11px] leading-snug text-ink-soft">{command.summary}</p>
      )}
      <div className="mt-1.5 flex gap-2">
        <button
          type="button"
          aria-label={`接受此条：${command.title}`}
          className="studio-transition inline-flex h-6 items-center rounded-md bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:hover:bg-accent"
          disabled={busy}
          onClick={() => onAccept(command)}
        >
          接受此条
        </button>
        <button
          type="button"
          aria-label={`跳过：${command.title}`}
          className="studio-transition inline-flex h-6 items-center rounded-md border border-hairline-strong px-2.5 text-[11px] font-medium text-ink-soft hover:bg-canvas hover:text-ink disabled:opacity-40"
          disabled={busy}
          onClick={() => onSkip(command)}
        >
          跳过
        </button>
      </div>
    </li>
  );
}

/** Toolkit confirm card (P7.3): apply/reject as the primary actions; the
 *  per-command list collapses behind a toggle — an 18-command deck plan must
 *  not wallpaper the panel with accept buttons. */
function CommandPlanCard({
  plan,
  onConfirm,
  onDismiss,
  onAcceptCommand,
  onSkipCommand,
}: {
  plan: PendingPlan & { commands: ToolkitCommand[] };
  onConfirm: () => void;
  onDismiss: () => void;
  onAcceptCommand?: (command: ToolkitCommand) => Promise<void> | void;
  onSkipCommand?: (command: ToolkitCommand) => void;
}) {
  // One in-flight accept at a time: a double-click must not replay a command twice.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const accept = (command: ToolkitCommand): void => {
    if (busyId) return;
    setBusyId(command.invocationId);
    void Promise.resolve(onAcceptCommand?.(command)).finally(() => setBusyId(null));
  };
  const busy = busyId !== null;
  const remaining = plan.commands.length;
  return (
    <section
      aria-label="变更计划确认卡"
      className="studio-transition shrink-0 overflow-hidden rounded-xl border border-accent/35 bg-accent-soft shadow-card"
    >
      <div className="flex items-center gap-2 border-b border-accent/20 px-3 py-2">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-accent">变更计划</h3>
        <span className="ml-auto text-[11px] tabular-nums text-ink-muted">{impactSummary(plan)}</span>
      </div>
      <div className="space-y-2 px-3 py-2.5 text-xs">
        <p className="leading-relaxed text-ink">{plan.plan || "（缺失改动目的）"}</p>
        <p className="text-[11px] text-ink-muted">
          范围 · <span className="text-ink-soft">{toolkitScopeText(plan.scope)}</span>
        </p>
        {remaining > 0 && (
          <button
            type="button"
            aria-expanded={detailOpen}
            className="studio-transition rounded px-1 text-[11px] text-ink-muted underline-offset-2 hover:text-ink-soft hover:underline"
            onClick={() => setDetailOpen((open) => !open)}
          >
            {detailOpen ? "收起明细" : `展开 ${remaining} 条命令明细（可逐条接受）`}
          </button>
        )}
        {detailOpen && (
          <ul className="space-y-1.5">
            {plan.commands.map((command) => (
              <CommandItem
                key={command.invocationId}
                command={command}
                busy={busy}
                onAccept={accept}
                onSkip={(c) => onSkipCommand?.(c)}
              />
            ))}
          </ul>
        )}
        {plan.toolTrace && plan.toolTrace.length > 0 && (
          <p aria-label="工具轨迹摘要" className="text-[11px] text-ink-muted">
            {toolTraceSummary(plan.toolTrace)}
          </p>
        )}
      </div>
      <div className="flex gap-2 border-t border-accent/20 px-3 py-2">
        <button
          type="button"
          className="studio-transition inline-flex h-7 flex-1 items-center justify-center rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:hover:bg-accent"
          disabled={busy || plan.commands.length === 0}
          onClick={onConfirm}
        >
          全部应用（{remaining}）
        </button>
        <button
          type="button"
          className="studio-transition inline-flex h-7 items-center rounded-md border border-hairline-strong px-3 text-xs font-medium text-ink-soft hover:bg-canvas hover:text-ink"
          onClick={onDismiss}
        >
          全部拒绝
        </button>
      </div>
    </section>
  );
}

/** Candidate tab strip (T61 W3-B): 方案 1..N shown only when alternatives exist. */
function VariantTabRow({
  count,
  active,
  onSelect,
}: {
  count: number;
  active: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div role="tablist" aria-label="候选方案" className="flex flex-wrap gap-1">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          data-testid={`variant-tab-${i}`}
          aria-selected={active === i}
          onClick={() => onSelect(i)}
          className={`studio-transition rounded-md px-2 py-0.5 text-[11px] font-medium ${
            active === i ? "bg-rail text-ink" : "text-ink-muted hover:text-ink-soft"
          }`}
        >
          方案 {i + 1}
        </button>
      ))}
    </div>
  );
}

export function ChangePlanCard({
  pendingPlan,
  onConfirm,
  onDismiss,
  onAcceptCommand,
  onSkipCommand,
  onSelectAlternative,
}: ChangePlanCardProps) {
  // "Before" geometry comes from the live document; the card never mutates it.
  const doc = useEditorStore((s) => s.document);
  // T61 W3-B: aiStore owns the candidate tab (confirm reads it); the optional
  // prop mirrors the choice to the parent for external observers.
  const variantTab = useAiStore((s) => s.selectedAlternative);
  if (!pendingPlan) return null;
  const { commands } = pendingPlan;
  // P7.3 toolkit plans render the per-command accept list (own card branch).
  if (commands) {
    return (
      <CommandPlanCard
        plan={{ ...pendingPlan, commands }}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
        onAcceptCommand={onAcceptCommand}
        onSkipCommand={onSkipCommand}
      />
    );
  }
  const ready = planElementsReady(pendingPlan);
  // T61 W3-B: candidate tabs render only for full-document generate plans.
  const variants = pendingPlan.alternatives ?? [];
  const hasVariants = Boolean(pendingPlan.document) && variants.length > 0;
  const activeDoc = activeDocument(pendingPlan, variantTab);
  // P7.3: 变更卡只服务 UI 文档管线；非 ui 文档按 null 处理（LeftPanel 已不挂该卡）
  const frames = frameDiffLines(pendingPlan, isUiDoc(doc) ? doc : null);
  return (
    <section
      aria-label="变更计划确认卡"
      className="studio-transition shrink-0 overflow-hidden rounded-xl border border-accent/35 bg-accent-soft shadow-card"
    >
      <div className="flex items-center gap-2 border-b border-accent/20 px-3 py-2">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-accent">变更计划</h3>
        <span className="ml-auto text-[11px] tabular-nums text-ink-muted">
          {hasVariants && variantTab > 0 ? `整页生成 · 方案 ${variantTab + 1}` : impactSummary(pendingPlan)}
        </span>
      </div>
      <div className="space-y-2 px-3 py-2.5 text-xs">
        {hasVariants && (
          <VariantTabRow
            count={variants.length + 1}
            active={variantTab}
            onSelect={(i) => {
              useAiStore.setState({ selectedAlternative: i });
              onSelectAlternative?.(i);
            }}
          />
        )}
        <p className="leading-relaxed text-ink">{pendingPlan.plan || "（缺失改动目的）"}</p>
        <p className="text-[11px] text-ink-muted">
          范围 · <span className="text-ink-soft">{involvedNodes(pendingPlan, activeDoc)}</span>
        </p>
        {frames.length > 0 && (
          <dl>
            <dt className="text-[11px] uppercase tracking-wide text-ink-muted">位置与尺寸</dt>
            <dd className="mt-0.5">
              <ul className="list-disc space-y-0.5 pl-4 text-ink-soft">
                {frames.map((line, i) => (
                  <li key={`${line}-${i}`}>{line}</li>
                ))}
              </ul>
            </dd>
          </dl>
        )}
        {pendingPlan.toolTrace && pendingPlan.toolTrace.length > 0 && (
          <p aria-label="工具轨迹摘要" className="text-[11px] text-ink-muted">
            {toolTraceSummary(pendingPlan.toolTrace)}
          </p>
        )}
      </div>
      <div className="flex gap-2 border-t border-accent/20 px-3 py-2">
        <button
          type="button"
          className="studio-transition inline-flex h-7 flex-1 items-center justify-center rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:hover:bg-accent"
          disabled={!ready}
          onClick={onConfirm}
        >
          应用变更
        </button>
        <button
          type="button"
          className="studio-transition inline-flex h-7 items-center rounded-md border border-hairline-strong px-3 text-xs font-medium text-ink-soft hover:bg-canvas hover:text-ink"
          onClick={onDismiss}
        >
          取消
        </button>
      </div>
    </section>
  );
}
