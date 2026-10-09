import { useState } from "react";
import { isUiDoc, useEditorStore } from "../../state/editorStore";
import { buildInspectData } from "./inspectData";
import type { InspectRow, InspectSection } from "./inspectData";

/** Per-row copy button; environments without a clipboard silently no-op. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <button
      type="button"
      aria-label={`复制 ${label}`}
      onClick={copy}
      className="studio-transition shrink-0 rounded-md border border-hairline px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-canvas hover:text-ink"
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}

/** One key/value line of an inspect table, value copyable. */
function RowLine({ row }: { row: InspectRow }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="w-16 shrink-0 text-[11px] text-ink-muted">{row.label}</span>
      <span className="min-w-0 flex-1 break-all text-[12px] leading-relaxed text-ink">
        {row.value}
      </span>
      <CopyButton text={row.value} label={row.label} />
    </div>
  );
}

/** Titled key/value table; renders nothing when the section has no rows. */
function SectionBlock({ section }: { section: InspectSection }) {
  if (section.rows.length === 0) return null;
  return (
    <section>
      <p className="mb-1 text-[11px] font-medium text-ink-muted">{section.title}</p>
      <div className="rounded-lg border border-hairline bg-rail px-3">
        {section.rows.map((row) => (
          <div key={row.label} className="border-b border-hairline last:border-b-0">
            <RowLine row={row} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Codegen-same-source inline style object with a whole-value copy button. */
function CssPreviewBlock({ source }: { source: string }) {
  return (
    <section>
      <p className="mb-1 text-[11px] font-medium text-ink-muted">CSS 预览（codegen 同源）</p>
      <div className="flex items-start gap-2 rounded-lg border border-hairline bg-rail px-3 py-2">
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all text-[11px] leading-relaxed text-ink">
          {source}
        </pre>
        <CopyButton text={source} label="CSS" />
      </div>
    </section>
  );
}

/** Empty states mirror RightPanel's props tab copy so switching feels coherent. */
function InspectEmptyState({ hasDoc }: { hasDoc: boolean }) {
  if (!hasDoc) {
    return <p className="text-xs text-ink-muted">尚未打开项目。</p>;
  }
  return (
    <p className="text-xs leading-relaxed text-ink-muted">
      请选择一个组件节点（点击预览或图层树）。
    </p>
  );
}

/**
 * T51 read-only inspect tab: codegen-same-source layout/CSS/props for the
 * primary selected node. Reads editorStore directly — zero props down,
 * zero callbacks up (RightPanel only mounts it under its tab).
 */
export function InspectPanel() {
  const doc = useEditorStore((s) => s.document);
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  if (!isUiDoc(doc)) return <InspectEmptyState hasDoc={false} />;
  // Same active-page convention as RightPanel (single-page doc today).
  const page = doc.pages[0]!;
  const node = selectedId ? page.nodes.find((n) => n.id === selectedId) : undefined;
  if (!node) return <InspectEmptyState hasDoc={true} />;
  const data = buildInspectData(node, page);
  return (
    <div className="space-y-5">
      {selectedIds.length > 1 && (
        <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-ink">
          <p className="font-medium text-accent">已选 {selectedIds.length} 个对象</p>
          <p className="mt-1 text-ink-muted">只读检查按主选中节点展示：{data.title}</p>
        </div>
      )}
      <div>
        <p className="text-[13px] font-medium leading-tight text-ink">{data.title}</p>
        <p className="mt-0.5 text-[11px] text-ink-muted">
          {data.subtitle} · id {node.id}
        </p>
      </div>
      {data.flowNote && (
        <p className="rounded-lg border border-hairline bg-rail px-3 py-2 text-xs text-ink-muted">
          {data.flowNote}
        </p>
      )}
      <SectionBlock section={data.frameSection} />
      {data.cssPreview && <CssPreviewBlock source={data.cssPreview} />}
      <SectionBlock section={data.propsSection} />
    </div>
  );
}
