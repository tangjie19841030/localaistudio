import type { StudioDocument } from "@studio/schema-core";
import type { TemplateGalleryItem } from "../../api/client";
import { SchemaRenderer } from "../../preview/SchemaRenderer";

export interface TemplateGalleryProps {
  items: TemplateGalleryItem[];
  category: string;
  onCategory: (category: string) => void;
  /** Chosen template doc; null = none / 空白. */
  selected: TemplateGalleryItem | null;
  onSelect: (t: TemplateGalleryItem | null) => void;
}

/** Fixed category order; "全部" is the default bucket. */
const ALL = "全部";

/**
 * Template gallery: category tabs + card grid with a live Schema preview.
 * Pure presentational — the parent owns fetching/selection state.
 */
export function TemplateGallery({ items, category, onCategory, selected, onSelect }: TemplateGalleryProps) {
  const categories = [ALL, ...Array.from(new Set(items.map((t) => t.category)))];
  const shown = category === ALL ? items : items.filter((t) => t.category === category);
  const isSelected = (id: string) => selected?.id === id;

  return (
    <div className="space-y-3">
      <div role="group" aria-label="模板分类" className="flex flex-wrap gap-1">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            aria-pressed={cat === category}
            onClick={() => onCategory(cat)}
            className={`studio-transition h-7 rounded-full px-3 text-xs font-medium ${
              cat === category
                ? "bg-accent text-white"
                : "bg-surface text-ink-soft hover:bg-rail hover:text-ink"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-muted">
          暂无模板，请先运行导入（或在设置中连接模型后重试）。
        </p>
      ) : (
        <div className="grid max-h-96 grid-cols-3 gap-2 overflow-y-auto pr-1">
          {shown.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected(t.id)}
              onClick={() => onSelect(isSelected(t.id) ? null : t)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(isSelected(t.id) ? null : t);
                }
              }}
              className={`studio-transition group relative overflow-hidden rounded-xl border text-left ${
                isSelected(t.id)
                  ? "border-accent ring-2 ring-accent/30"
                  : "border-hairline hover:border-accent/50"
              }`}
            >
              <div className="pointer-events-none aspect-[4/3] overflow-hidden bg-white">
                <TemplateThumb doc={t.document} />
              </div>
              <div className="border-t border-hairline bg-surface px-2 py-1.5">
                <p className="truncate text-sm font-medium text-ink" title={t.name}>
                  {t.name}
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">
                  {t.description || t.category}
                </p>
              </div>
              {isSelected(t.id) && (
                <span
                  aria-hidden
                  className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white shadow-pop"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3.5 8.5l3 3 6-6" />
                  </svg>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Live scaled Schema render as a thumbnail (the gallery preview is real UI). */
function TemplateThumb({ doc }: { doc: StudioDocument }) {
  return (
    <div
      aria-hidden="true"
      ref={(element) => {
        if (element) element.inert = true;
      }}
      className="h-full w-full overflow-hidden"
    >
      <div
        className="origin-top-left"
        style={{ transform: "scale(0.28)", width: `${100 / 0.28}%`, pointerEvents: "none" }}
      >
        <SchemaRenderer doc={doc.pages[0]!} tokens={doc.tokens} selectedId={null} onSelect={() => {}} />
      </div>
    </div>
  );
}
