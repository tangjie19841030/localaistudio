import type { TemplateGalleryItem } from "../../api/client";
import { FormSection } from "./FormSection";
import { TemplateGallery } from "./TemplateGallery";

interface TemplatePickerSectionProps {
  loading: boolean;
  templates: TemplateGalleryItem[];
  category: string;
  onCategory: (category: string) => void;
  /** Chosen template doc; null = none / 空白. */
  selected: TemplateGalleryItem | null;
  onSelect: (t: TemplateGalleryItem | null) => void;
  /** Id currently going through the import flow (for the disabled state). */
  importingId: string | null;
  onImport: (id: string) => void;
  /** Reset the selection back to blank. */
  onClear: () => void;
}

/**
 * "起始模板" section, rendered for UI projects only. Sits outside the create
 * <form> element because template cards embed a live document preview that may
 * contain its own native form/controls.
 */
export function TemplatePickerSection({
  loading,
  templates,
  category,
  onCategory,
  selected,
  onSelect,
  importingId,
  onImport,
  onClear,
}: TemplatePickerSectionProps) {
  // Split into ready (has a document) and pending (source only, needs import).
  const ready = templates.filter((t) => t.document !== undefined && t.document !== null);
  const pending = templates.filter((t) => t.document === undefined || t.document === null);

  return (
    <FormSection title="起始模板">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">选一个模板直接开局，或留空从空白开始。</p>
        <button
          type="button"
          aria-pressed={selected === null}
          onClick={onClear}
          className={`studio-transition shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
            selected === null ? "bg-accent text-white" : "text-ink-muted hover:text-ink"
          }`}
        >
          空白
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-ink-muted">加载模板…</p>
      ) : (
        <>
          <TemplateGallery
            items={ready}
            category={category}
            onCategory={onCategory}
            selected={selected}
            onSelect={onSelect}
          />
          {pending.length > 0 && (
            <div className="rounded-lg border border-dashed border-hairline-strong p-2">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                待导入模板
              </p>
              <ul className="space-y-1">
                {pending.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-ink-soft">{t.name}</span>
                    <button
                      type="button"
                      disabled={importingId === t.id}
                      onClick={() => onImport(t.id)}
                      className="studio-transition shrink-0 rounded-md border border-hairline px-2 py-0.5 text-[11px] font-medium text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-40"
                    >
                      {importingId === t.id ? "导入中…" : "导入"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </FormSection>
  );
}
