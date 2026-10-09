import type { ProjectMeta } from "@studio/schema-core";
import { useState } from "react";
import { AiChatPanel } from "../../features/ai/AiChatPanel";
import { ChangePlanCard } from "../../features/ai/ChangePlanCard";
import { useAiStore } from "../../state/aiStore";
import { Collapse } from "../motion";

export interface LeftPanelProps {
  meta: ProjectMeta | null;
  projectId: string | null;
  selectedId: string | null;
  /** Canvas multi-select: every selected node joins the AI scope. */
  selectedIds?: string[];
  onConfirmPlan: () => void;
}

/** Left rail body (WorkbenchLayout owns the <aside> chrome). */
export function LeftPanel({ meta, projectId, selectedId, selectedIds, onConfirmPlan }: LeftPanelProps) {
  const pendingPlan = useAiStore((s) => s.pendingPlan);
  const dismiss = (): void => useAiStore.setState({ pendingPlan: null, phase: "idle" });
  const [metaOpen, setMetaOpen] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 py-2">
        <button
          type="button"
          aria-expanded={metaOpen}
          onClick={() => setMetaOpen((v) => !v)}
          className="studio-transition flex w-full items-center justify-between rounded-md px-1.5 py-1 text-xs font-medium uppercase tracking-wider text-ink-muted hover:text-ink"
        >
          需求
          <span aria-hidden className={`inline-block transition-transform ${metaOpen ? "rotate-90" : ""}`}>
            ▸
          </span>
        </button>
        <Collapse open={metaOpen} className="pt-1">
          <div>
            {meta ? (
              <dl className="space-y-2 text-[13px] leading-snug text-ink-soft">
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">产品类型</dt>
                  <dd className="text-ink">{meta.productType || "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">目标用户</dt>
                  <dd className="text-ink">{meta.targetUsers || "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">页面目标</dt>
                  <dd className="text-ink">{meta.goal || "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">品牌规则</dt>
                  <dd className="text-ink">{meta.brandRules || "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">参考链接</dt>
                  {meta.referenceLinks.length ? (
                    <dd className="mt-0.5 flex flex-col gap-1">
                      {meta.referenceLinks.map((link) => (
                        <a
                          key={link}
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-accent hover:underline"
                          title={link}
                        >
                          {link.replace(/^https?:\/\//i, "")}
                        </a>
                      ))}
                    </dd>
                  ) : (
                    <dd>—</dd>
                  )}
                </div>
              </dl>
            ) : (
              <p className="text-ink-muted">尚未打开项目</p>
            )}
          </div>
        </Collapse>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border-t border-hairline px-3 py-3">
        <h2 className="shrink-0 text-xs font-medium uppercase tracking-wider text-ink-muted">
          AI 对话
        </h2>
        {projectId ? (
          <>
            <AiChatPanel
              projectId={projectId}
              projectType={meta?.projectType ?? "ui"}
              selectedId={selectedId}
              selectedIds={selectedIds}
            />
            <ChangePlanCard
              pendingPlan={pendingPlan}
              onConfirm={onConfirmPlan}
              onDismiss={dismiss}
              onAcceptCommand={(command) => useAiStore.getState().acceptCommand(projectId, command)}
              onSkipCommand={(command) => useAiStore.getState().skipCommand(command)}
            />
          </>
        ) : (
          <p className="text-xs text-ink-muted">AI 对话将在打开项目后启用。</p>
        )}
      </div>
    </div>
  );
}
