import { listComponentDefs } from "@studio/schema-core";
import type { ComponentCategory } from "@studio/schema-core";
import { useState } from "react";
import { Collapse } from "../motion";

export interface InsertMenuProps {
  onInsert: (type: string) => void;
  /** Initial expanded state. Standalone usage defaults to open (catalog visible). */
  defaultOpen?: boolean;
}

/** Chinese heading per category, fixed display order. */
const CATEGORY_TITLE: Record<ComponentCategory, string> = {
  navigation: "导航",
  layout: "布局",
  content: "内容",
  form: "表单",
  data: "数据",
  chart: "图表",
  feedback: "反馈",
  marketing: "营销",
};

const CATEGORY_ORDER: ComponentCategory[] = [
  "navigation",
  "layout",
  "content",
  "form",
  "data",
  "chart",
  "feedback",
  "marketing",
];

/** Catalog body only: all registered components grouped by category. */
export function InsertMenuBody({ onInsert }: { onInsert: (type: string) => void }) {
  const defs = listComponentDefs();
  return (
    <div className="space-y-4 text-sm">
      {CATEGORY_ORDER.map((category) => {
        const items = defs.filter((d) => d.category === category);
        if (items.length === 0) return null;
        return (
          <section key={category}>
            <h4 className="mb-2 text-xs font-medium text-ink-muted">
              {CATEGORY_TITLE[category]}
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {items.map((d) => (
                <button
                  key={d.type}
                  type="button"
                  aria-label={`插入 ${d.title}`}
                  title={d.type}
                  onClick={() => onInsert(d.type)}
                  className="studio-transition rounded-md border border-hairline bg-canvas px-2.5 py-1 text-xs text-ink-soft hover:border-accent hover:bg-accent-soft hover:text-accent"
                >
                  {d.title}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Collapsible wrapper: heading button (aria-expanded) toggles the catalog body. */
export function InsertMenu({ onInsert, defaultOpen = true }: InsertMenuProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="studio-transition flex w-full items-center justify-between rounded-md px-1 py-0.5 text-xs font-medium uppercase tracking-wider text-ink-muted hover:text-ink"
      >
        插入组件
        <span aria-hidden="true" className="text-[10px]">
          {open ? "▾" : "▸"}
        </span>
      </button>
      <Collapse open={open}>
        <InsertMenuBody onInsert={onInsert} />
      </Collapse>
    </div>
  );
}
