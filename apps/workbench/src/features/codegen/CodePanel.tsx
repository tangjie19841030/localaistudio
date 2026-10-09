import Editor from "@monaco-editor/react";
import { useEffect, useState } from "react";
import { codegenApi, exportUiPdf, exportUiPng, type ProjectFileContent } from "../../api/client";
import { log } from "../../state/logStore";
import { saveBeforeExport } from "../../state/saveBeforeExport";
import { useCodegenStore } from "../../state/codegenStore";
import { useEditorStore } from "../../state/editorStore";
import { useMonacoTheme } from "../../utils/monacoTheme";
import { DocDiff } from "./DocDiff";

export interface CodePanelProps {
  projectId: string;
}

/** Map a generated file path to a Monaco language id (scaffold is TS/JSON/CSS). */
function languageOf(path: string): string {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".md")) return "markdown";
  return "plaintext";
}

/**
 * Bottom dock "Diff" tab body: generated-file browser + doc diff side by side.
 * Top row hosts generate/export; the export gate (checks → confirm) lives in
 * the store (spec §6.3).
 */
export function CodePanel({ projectId }: CodePanelProps) {
  const generateState = useCodegenStore((s) => s.generateState);
  const generatedFiles = useCodegenStore((s) => s.generatedFiles);
  const exportState = useCodegenStore((s) => s.exportState);
  const checks = useCodegenStore((s) => s.checks);
  const storeError = useCodegenStore((s) => s.error);
  const handEditedFiles = useCodegenStore((s) => s.handEditedFiles);
  const monacoTheme = useMonacoTheme();
  const [file, setFile] = useState<ProjectFileContent | null>(null);

  const onGenerate = () => {
    const doc = useEditorStore.getState().document;
    void useCodegenStore
      .getState()
      .generate(projectId, doc ? JSON.stringify(doc) : undefined);
    setFile(null);
  };
  const onExport = () => void useCodegenStore.getState().runExport(projectId);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 text-left">
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onGenerate}
          disabled={generateState === "generating"}
          className="studio-transition inline-flex h-7 items-center rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:hover:bg-accent"
        >
          {generateState === "generating" ? "生成中…" : "生成代码"}
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={exportState === "checking" || exportState === "downloading"}
          className="studio-transition inline-flex h-7 items-center rounded-md border border-hairline-strong px-3 text-xs font-medium text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-40"
        >
          {exportState === "checking"
            ? "检查中…"
            : exportState === "downloading"
              ? "导出中…"
              : "导出 zip"}
        </button>
        <ExportPngButton projectId={projectId} />
        <ExportPdfButton projectId={projectId} />
        {storeError && (
          <p role="alert" className="min-w-0 flex-1 text-xs leading-relaxed break-all text-danger">
            {storeError}
          </p>
        )}
      </div>
      {handEditedFiles.length > 0 && (
        <div
          role="status"
          className="shrink-0 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn"
        >
          <p className="font-medium">
            上次生成覆盖了 {handEditedFiles.length} 个手改文件（内容已按 Schema 重写）
          </p>
          <ul className="mt-1 list-disc pl-4">
            {handEditedFiles.map((p) => (
              <li key={p} className="truncate">{p}</li>
            ))}
          </ul>
        </div>
      )}
      {checks && !checks.ok && (
        <div className="shrink-0 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-xs">
          <p className="font-medium text-warn">导出前检查未通过：</p>
          <ul className="mt-1 list-disc pl-4 text-warn">
            {checks.errors.map((e, i) => (
              <li key={i} className="truncate">{e}</li>
            ))}
          </ul>
          {exportState === "confirm" && (
            <button
              type="button"
              onClick={() =>
                void useCodegenStore.getState().runExport(projectId, { force: true })
              }
              className="studio-transition mt-2 inline-flex h-7 items-center rounded-md bg-warn px-3 text-xs font-medium text-white hover:bg-warn/90"
            >
              仍然导出
            </button>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-2">
        <FileList projectId={projectId} files={generatedFiles} onOpen={(f) => setFile(f)} />
        <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-hairline">
          {file ? (
            <Editor
              key={file.path}
              value={file.content}
              language={languageOf(file.path)}
              theme={monacoTheme}
              options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12 }}
              height="100%"
            />
          ) : (
            <DocDiffBody />
          )}
        </div>
      </div>
    </div>
  );
}

interface FileListProps {
  projectId: string;
  files: string[];
  onOpen: (file: ProjectFileContent) => void;
}

/** Left column: generated file list; clicking loads content via getProjectFile. */
function FileList({ projectId, files, onOpen }: FileListProps) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Files regenerate as a whole; stale selection would point at old content.
    setError(null);
  }, [files]);

  const open = async (path: string) => {
    useCodegenStore.getState().selectFile(path);
    setError(null);
    try {
      onOpen(await codegenApi.getProjectFile(projectId, path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (files.length === 0) {
    return <p className="w-56 shrink-0 text-xs text-ink-muted">尚未生成文件。</p>;
  }
  return (
    <div className="w-56 shrink-0 overflow-auto">
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <ul aria-label="生成文件列表" className="flex flex-col gap-0.5">
        {files.map((f) => (
          <li key={f} aria-label={f}>
            <button
              type="button"
              onClick={() => void open(f)}
              className="studio-transition w-full truncate rounded-md px-1.5 py-0.5 text-left font-mono text-xs text-ink-soft hover:bg-rail hover:text-ink"
            >
              {f}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Default right pane: document JSON diff (snapshot vs current). */
function DocDiffBody() {
  return <DocDiff />;
}

/** Trigger a browser download for a fetched blob via a temporary anchor. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * W1-D "导出 PNG（三视口）": saves the current document first (the server
 * regenerates code from the STORED copy), then downloads the three-viewport
 * screenshot zip. Export state stays local — the codegen store owns the zip
 * export gate and is not touched.
 */
function ExportPngButton({ projectId }: { projectId: string }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onExportPng = async () => {
    if (exporting) return;
    setExporting(true);
    setError(null);
    const saved = await saveBeforeExport(projectId);
    if (!saved.ok) {
      setError(saved.message ?? "保存失败，已阻止导出");
      setExporting(false);
      return;
    }
    try {
      const blob = await exportUiPng(projectId);
      downloadBlob(blob, `project-${projectId.slice(0, 8)}-ui-png.zip`);
      log("success", "export", "已导出三视口 PNG 压缩包（desktop/tablet/mobile）");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      log("error", "export", `PNG 导出失败：${message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void onExportPng()}
        disabled={exporting}
        className="studio-transition inline-flex h-7 items-center rounded-md border border-hairline-strong px-3 text-xs font-medium text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-40"
      >
        {exporting ? "截图中…" : "导出 PNG（三视口）"}
      </button>
      {error && (
        <p role="alert" className="min-w-0 flex-1 text-xs leading-relaxed break-all text-danger">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * W3 debt OP-5 "导出 PDF": mirrors ExportPngButton — saves the current
 * document first (the server renders from the STORED copy), then downloads
 * the single-page PDF (mode=single renders pages[0]). Export state stays
 * local — the codegen store owns the zip export gate and is not touched.
 */
function ExportPdfButton({ projectId }: { projectId: string }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onExportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    setError(null);
    const saved = await saveBeforeExport(projectId);
    if (!saved.ok) {
      setError(saved.message ?? "保存失败，已阻止导出");
      setExporting(false);
      return;
    }
    try {
      const blob = await exportUiPdf(projectId);
      downloadBlob(blob, `project-${projectId.slice(0, 8)}.pdf`);
      log("success", "export", "已导出单页 PDF（mode=single，渲染首页）");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      log("error", "export", `PDF 导出失败：${message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void onExportPdf()}
        disabled={exporting}
        className="studio-transition inline-flex h-7 items-center rounded-md border border-hairline-strong px-3 text-xs font-medium text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-40"
      >
        {exporting ? "导出中…" : "导出 PDF"}
      </button>
      {error && (
        <p role="alert" className="min-w-0 flex-1 text-xs leading-relaxed break-all text-danger">
          {error}
        </p>
      )}
    </>
  );
}
