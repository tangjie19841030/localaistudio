import type { ProjectMeta } from "@studio/schema-core";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { ThemeToggle } from "../../components/layout/ThemeToggle";
import { SettingsDialog } from "../ai/SettingsDialog";
import { NewProjectForm } from "./NewProjectForm";

interface ProjectListScreenProps {
  onOpen: (id: string) => void;
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Neutral type badge label derived from projectType. */
const PROJECT_TYPE_LABEL: Record<ProjectMeta["projectType"], string> = {
  ui: "UI 页面",
  ppt: "PPT 演示",
  word: "Word 文档",
};

/** Legacy meta files may lack projectType at runtime → fall back to ui. */
function projectTypeLabel(meta: ProjectMeta): string {
  return PROJECT_TYPE_LABEL[meta.projectType] ?? PROJECT_TYPE_LABEL.ui;
}

export function ProjectListScreen({ onOpen }: ProjectListScreenProps) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Escape collapses the new-project form (same close contract as the
  // settings dialog and command palette).
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setShowForm(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showForm]);

  useEffect(() => {
    api
      .listProjects()
      .then((p) => {
        setProjects(p);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  // When the list is empty the empty state below owns the single primary CTA;
  // the header toggle hides to avoid two stacked "新建项目" buttons.
  const listEmpty = !loading && projects.length === 0 && !error;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 border-b border-hairline bg-canvas/90 backdrop-blur-sm">
        <div className="mx-auto flex h-12 max-w-4xl items-center gap-3 px-6">
          <span className="text-sm font-semibold tracking-tight text-ink">Local AI UI Studio</span>
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="studio-transition inline-flex h-8 items-center rounded-md border border-hairline px-3 text-xs font-medium text-ink-soft hover:bg-rail hover:text-ink"
              onClick={() => setSettingsOpen(true)}
            >
              模型设置
            </button>
            <ThemeToggle />
          </span>
        </div>
      </header>

      <main aria-label="项目列表" className="mx-auto max-w-4xl px-6 pb-16 pt-10">
        <div className="reveal">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">工作区</p>
              <h1 className="mt-1 text-[1.75rem] font-semibold leading-tight tracking-tight text-ink">
                项目
              </h1>
              <p className="mt-1 max-w-lg text-sm leading-relaxed text-ink-soft">
                从一句需求生成网页、演示文稿与文档，或继续编辑已有项目。
              </p>
            </div>
            {!listEmpty && (
              <button
                type="button"
                className="studio-transition inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover active:bg-accent-pressed"
                onClick={() => setShowForm((v) => !v)}
              >
                {showForm ? "关闭" : "新建项目"}
              </button>
            )}
          </div>
        </div>

        {showForm && (
          <div className="reveal mt-6" style={{ animationDelay: "60ms" }}>
            <NewProjectForm onCreated={onOpen} />
          </div>
        )}

        {error && (
          <p role="alert" className="reveal mt-6 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            加载失败：{error}
          </p>
        )}

        <section className="reveal mt-10" style={{ animationDelay: "120ms" }}>
          <div className="flex items-baseline justify-between border-b border-hairline pb-2">
            <h2 className="text-xs font-medium uppercase tracking-wider text-ink-muted">
              最近项目
            </h2>
            <span className="text-xs tabular-nums text-ink-muted">{projects.length}</span>
          </div>
          {loading ? (
            <ul className="mt-3 grid gap-2" aria-hidden>
              {[0, 1, 2].map((i) => (
                <li
                  key={i}
                  className="h-16 animate-pulse rounded-xl border border-hairline bg-surface/60"
                />
              ))}
            </ul>
          ) : projects.length === 0 && !error ? (
            <div className="mt-6 flex flex-col items-start gap-3 rounded-xl border border-dashed border-hairline-strong bg-surface px-6 py-10">
              <p className="text-sm font-medium text-ink">暂无项目</p>
              <p className="max-w-md text-xs leading-relaxed text-ink-soft">
                新建一个项目，用一句话描述目标，即可开始网页、演示文稿或文档创作。
              </p>
              <button
                type="button"
                className="studio-transition mt-1 inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover"
                onClick={() => setShowForm((v) => !v)}
              >
                {showForm ? "关闭" : "新建项目"}
              </button>
            </div>
          ) : projects.length === 0 ? null : (
            <ul className="mt-3 grid gap-2">
              {projects.map((p, i) => {
                const desc = p.goal || p.productType || "无描述";
                const when = formatWhen(p.updatedAt);
                return (
                  <li
                    key={p.id}
                    className={i < 8 ? "reveal" : undefined}
                    style={i < 8 ? { animationDelay: `${40 + i * 30}ms` } : undefined}
                  >
                    {/* Whole row is the single click target (keyboard reachable
                        via the native button); the visible 打开 is a passive hint. */}
                    <button
                      type="button"
                      aria-label={`打开 ${p.name}`}
                      onClick={() => onOpen(p.id)}
                      className="studio-transition group flex w-full items-center gap-3 rounded-xl border border-hairline bg-surface px-4 py-3 text-left hover:border-accent/40 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                    >
                      <span className="shrink-0 rounded border border-hairline px-1.5 py-0.5 text-[11px] font-medium leading-none text-ink-muted">
                        {projectTypeLabel(p)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-sm font-medium text-ink group-hover:text-accent"
                          title={p.name}
                        >
                          {p.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-muted" title={desc}>
                          {desc}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className="text-xs tabular-nums text-ink-muted">{when}</span>
                        <span
                          aria-hidden
                          className="studio-transition inline-flex items-center gap-0.5 text-xs text-ink-faint group-hover:text-accent"
                        >
                          打开
                          <svg
                            aria-hidden
                            viewBox="0 0 16 16"
                            className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M5 4l4 4-4 4" />
                          </svg>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
