import { studioDocumentSchema, type StudioDocument } from "@studio/schema-core";
import { AnimatePresence } from "motion/react";
import { useRef, useState } from "react";
import { VersionDiff } from "../../features/versions/VersionDiff";
import type { VersionListItem } from "../../state/versionStore";
import { RevealItem } from "../motion";

export interface VersionPanelProps {
  projectId: string;
  versions: VersionListItem[];
  /** Save the current document as a named version (App supplies document). */
  onSaveVersion?: (projectId: string, name: string) => Promise<unknown>;
  onDeleteVersion?: (projectId: string, versionId: string) => Promise<unknown>;
  onReloadVersions?: () => Promise<unknown> | void;
  onRestore: (document: StudioDocument) => void;
  onImport: (document: StudioDocument) => void;
  /** Current document for export; omitted/null disables the export button. */
  document?: StudioDocument | null;
}

/** Serialize a document for download; kept pure for testing. */
export function exportDocumentJson(doc: StudioDocument): string {
  return JSON.stringify(doc, null, 2);
}

function triggerDownload(text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "document.json";
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

/** Read a File's text via FileReader (jsdom-compatible; File.text() missing there). */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Parse a document from raw JSON; issues are normalized to "path: message". */
function parseDocumentJson(text: string): { ok: true; document: StudioDocument } | { ok: false; issues: string[] } {
  const parsed = studioDocumentSchema.safeParse(JSON.parse(text));
  if (parsed.success) return { ok: true, document: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

function formatTime(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

export function VersionPanel(props: VersionPanelProps) {
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const doc = props.document;

  const handleSave = async () => {
    if (!props.onSaveVersion || !name.trim()) return;
    try {
      await props.onSaveVersion(props.projectId, name.trim());
      setName("");
      await props.onReloadVersions?.();
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    }
  };

  const handleDelete = async (versionId: string, label: string) => {
    if (!props.onDeleteVersion) return;
    try {
      await props.onDeleteVersion(props.projectId, versionId);
      await props.onReloadVersions?.();
    } catch (err) {
      setErrors([`删除 "${label}" 失败: ${err instanceof Error ? err.message : String(err)}`]);
    }
  };

  const handleImportFile = async (file: File) => {
    let result: ReturnType<typeof parseDocumentJson>;
    try {
      result = parseDocumentJson(await readFileText(file));
    } catch (err) {
      console.error("[VersionPanel] 导入解析失败:", err);
      setErrors(["文件不是合法的 JSON 文档"]);
      return;
    }
    if (!result.ok) {
      setErrors(result.issues);
      return;
    }
    setErrors([]);
    props.onImport(result.document);
  };

  return (
    <div className="flex h-full flex-col gap-3 text-sm">
      <section aria-label="存为版本" className="flex items-center gap-2">
        <label htmlFor="version-name" className="sr-only">
          版本名称
        </label>
        <input
          id="version-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="版本名称"
          className="studio-transition w-48 rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-muted hover:border-hairline-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!name.trim() || !props.onSaveVersion}
          className="studio-transition inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:hover:bg-accent"
        >
          存为版本
        </button>
      </section>

      {errors.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft p-2 text-xs text-danger"
        >
          <ul aria-label="导入错误清单" className="list-disc pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <section aria-label="版本列表" className="min-h-0 flex-1 overflow-y-auto">
        {props.versions.length === 0 && (
          <p className="text-xs text-ink-muted">暂无版本。</p>
        )}
        <ul className="space-y-1">
          <AnimatePresence initial={false}>
            {props.versions.map((v, i) => (
              <RevealItem
                key={v.versionId}
                index={i}
                variant="rise"
                className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors duration-150 hover:bg-rail"
              >
                <span className="min-w-0 flex-1 truncate text-ink">
                  {v.name}
                  <span className="ml-2 text-xs text-ink-muted">{formatTime(v.createdAt)}</span>
                </span>
                <button
                  type="button"
                  aria-label={`恢复 ${v.name}`}
                  disabled={!v.document}
                  onClick={() => v.document && props.onRestore(v.document)}
                  className="studio-transition rounded-md border border-hairline-strong px-2 h-6 text-xs font-medium text-ink-soft hover:bg-canvas hover:text-ink disabled:opacity-40"
                >
                  恢复
                </button>
                <button
                  type="button"
                  aria-label={`删除 ${v.name}`}
                  onClick={() => void handleDelete(v.versionId, v.name)}
                  className="studio-transition rounded-md border border-hairline-strong px-2 h-6 text-xs font-medium text-ink-soft hover:border-danger hover:text-danger"
                >
                  删除
                </button>
              </RevealItem>
            ))}
          </AnimatePresence>
        </ul>
      </section>

      <section
        aria-label="版本对比"
        className="flex h-40 shrink-0 flex-col border-t border-hairline pt-3"
      >
        <VersionDiff projectId={props.projectId} versions={props.versions} document={doc} />
      </section>

      <section
        aria-label="JSON 导入导出"
        className="flex shrink-0 items-center gap-2 border-t border-hairline pt-3"
      >
        <button
          type="button"
          disabled={!doc}
          onClick={() => doc && triggerDownload(exportDocumentJson(doc))}
          className="studio-transition rounded-md border border-hairline-strong px-2 h-7 text-xs font-medium text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-40"
        >
          导出 JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          aria-label="导入 JSON"
          className="text-xs text-ink-muted file:mr-2 file:rounded-md file:border-0 file:bg-canvas file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-ink file:ring-1 file:ring-hairline-strong hover:file:bg-surface"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImportFile(f);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />
      </section>
    </div>
  );
}
