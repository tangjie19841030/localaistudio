import { DiffEditor } from "@monaco-editor/react";
import type { StudioDocument } from "@studio/schema-core";
import { useState } from "react";
import type { VersionListItem } from "../../state/versionStore";
import { CURRENT_DOC, useVersionDocs } from "./useVersionDocs";
import { SchemaRenderer } from "../../preview/SchemaRenderer";
import { useMonacoTheme } from "../../utils/monacoTheme";

export { CURRENT_DOC };

export interface VersionDiffProps {
  projectId: string;
  versions: VersionListItem[];
  /** Live editor document; null when no project document is loaded. */
  document?: StudioDocument | null;
}

/** Newest version id by createdAt; null for an empty list. */
export function newestVersionId(versions: VersionListItem[]): string | null {
  let best: VersionListItem | null = null;
  for (const v of versions) {
    if (!best || v.createdAt > best.createdAt) best = v;
  }
  return best?.versionId ?? null;
}

type ViewMode = "json" | "preview";

export function VersionDiff(props: VersionDiffProps) {
  // null selection = "follow the default", so defaults stay correct when the
  // version list arrives after the first render.
  const [leftPick, setLeftPick] = useState<string | null>(null);
  const [rightPick, setRightPick] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("json");
  const { versions } = props;
  const leftId = leftPick ?? newestVersionId(versions) ?? CURRENT_DOC;
  const rightId = rightPick ?? CURRENT_DOC;
  const { docs, loading, error } = useVersionDocs(props.projectId, versions, [leftId, rightId]);

  if (versions.length < 1) {
    return (
      <p className="text-xs text-ink-muted">
        暂无版本可对比，先「存为版本」再回来查看差异。
      </p>
    );
  }

  const docFor = (id: string): StudioDocument | null => {
    if (id === CURRENT_DOC) return props.document ?? null;
    return versions.find((v) => v.versionId === id)?.document ?? docs[id] ?? null;
  };
  const leftDoc = docFor(leftId);
  const rightDoc = docFor(rightId);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-ink-soft">
        <span>基准</span>
        <VersionSelect label="对比基准版本" value={leftId} versions={versions} onChange={setLeftPick} />
        <span aria-hidden="true" className="text-ink-muted">→</span>
        <span>目标</span>
        <VersionSelect label="对比目标版本" value={rightId} versions={versions} onChange={setRightPick} />
        <div role="group" aria-label="对比视图" className="ml-auto inline-flex rounded-md border border-hairline p-0.5">
          <button
            type="button"
            aria-pressed={view === "json"}
            onClick={() => setView("json")}
            className={`studio-transition h-6 rounded px-2 text-[11px] font-medium ${
              view === "json" ? "bg-accent-soft text-accent" : "text-ink-muted hover:text-ink"
            }`}
          >
            代码 Diff
          </button>
          <button
            type="button"
            aria-pressed={view === "preview"}
            onClick={() => setView("preview")}
            className={`studio-transition h-6 rounded px-2 text-[11px] font-medium ${
              view === "preview" ? "bg-accent-soft text-accent" : "text-ink-muted hover:text-ink"
            }`}
          >
            并排预览
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="shrink-0 text-xs text-danger">
          版本文档加载失败：{error}
        </p>
      )}
      {loading && <p className="shrink-0 text-xs text-ink-muted">加载版本文档…</p>}
      {view === "json" ? (
        <DiffBody loading={loading} error={error} left={leftDoc} right={rightDoc} />
      ) : (
        <PreviewCompare loading={loading} error={error} left={leftDoc} right={rightDoc} />
      )}
    </div>
  );
}

/** Diff surface (or the reason there is none). Monaco needs a sized container. */
function DiffBody(p: {
  loading: boolean;
  error: string | null;
  left: StudioDocument | null;
  right: StudioDocument | null;
}) {
  const monacoTheme = useMonacoTheme();
  if (p.loading) return null;
  if (!p.left || !p.right) {
    if (p.error) return null;
    return <p className="shrink-0 text-xs text-ink-muted">所选一侧没有可用文档。</p>;
  }
  return (
    <div className="min-h-24 flex-1 overflow-hidden rounded-md border border-hairline">
      <DiffEditor
        original={JSON.stringify(p.left, null, 2)}
        modified={JSON.stringify(p.right, null, 2)}
        language="json"
        theme={monacoTheme}
        options={{ readOnly: true, renderSideBySide: true, fontSize: 12 }}
        height="100%"
      />
    </div>
  );
}

/** Side-by-side schema preview of both documents (read-only, no selection). */
function PreviewCompare(p: {
  loading: boolean;
  error: string | null;
  left: StudioDocument | null;
  right: StudioDocument | null;
}) {
  if (p.loading) return null;
  if (!p.left || !p.right) {
    if (p.error) return null;
    return <p className="shrink-0 text-xs text-ink-muted">所选一侧没有可用文档。</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 gap-2">
      <PreviewPane label="基准" doc={p.left} />
      <PreviewPane label="目标 / 当前" doc={p.right} />
    </div>
  );
}

function PreviewPane({ label, doc }: { label: string; doc: StudioDocument }) {
  const noop = (): void => {};
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-hairline bg-surface">
      <p className="shrink-0 border-b border-hairline px-2 py-1 text-[11px] text-ink-muted">
        {label} · {doc.name}
      </p>
      <div className="min-h-0 flex-1 overflow-auto bg-white p-2">
        <SchemaRenderer doc={doc.pages[0]!} tokens={doc.tokens} selectedId={null} onSelect={noop} />
      </div>
    </div>
  );
}

/** One side of the comparison: the live document plus every saved version. */
function VersionSelect(p: {
  label: string;
  value: string;
  versions: VersionListItem[];
  onChange: (id: string) => void;
}) {
  return (
    <select
      aria-label={p.label}
      value={p.value}
      onChange={(e) => p.onChange(e.target.value)}
      className="studio-transition rounded-md border border-hairline bg-canvas px-1.5 py-0.5 text-xs text-ink hover:border-hairline-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
    >
      <option value={CURRENT_DOC}>当前文档</option>
      {p.versions.map((v) => (
        <option key={v.versionId} value={v.versionId}>
          {v.name}
        </option>
      ))}
    </select>
  );
}
