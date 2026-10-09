import { useState } from "react";
import { useEditorStore } from "../../state/editorStore";
import { saveBeforeExport } from "../../state/saveBeforeExport";

/** Primary toolkit format (pptx/docx); pdf/png depend on local Office. */
export type PrimaryExportFormat = "pptx" | "docx";

interface LogEntry {
  time: string;
  label: string;
  detail: string;
}

/** Trigger a browser download for an exported blob. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Prefer the server's Content-Disposition filename; fall back to id.ext. */
function filenameFromDisposition(res: Response, fallback: string): string {
  const disposition = res.headers.get("content-disposition") ?? "";
  const encoded = /filename="([^"]+)"/.exec(disposition)?.[1];
  if (!encoded) return fallback;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return fallback;
  }
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export interface ToolkitExportPanelProps {
  /** Primary always-available format and its button label (PPTX / DOCX). */
  primaryFormat: PrimaryExportFormat;
  primaryLabel: string;
}

/**
 * Shared toolkit export panel (ppt + word unified lifecycle): save-first, then
 * POST /api/projects/:id/export/<format>, stream the download, keep an
 * in-memory log. A 503 office_unavailable disables the Office-dependent
 * buttons with a hint instead of pretending success. The PPT/Word panels are
 * thin re-exports that only pin the primary format.
 */
export function ToolkitExportPanel({ primaryFormat, primaryLabel }: ToolkitExportPanelProps) {
  const projectId = useEditorStore((s) => s.projectId);
  const [busy, setBusy] = useState<PrimaryExportFormat | "pdf" | "png" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [officeMissing, setOfficeMissing] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);

  const exportAs = async (format: PrimaryExportFormat | "pdf" | "png") => {
    if (!projectId || busy) return;
    setBusy(format);
    setMessage(null);
    try {
      const saved = await saveBeforeExport(projectId);
      if (!saved.ok) {
        setMessage(saved.message ?? "保存失败，已阻止导出");
        return;
      }
      const res = await fetch(`/api/projects/${projectId}/export/${format}`, { method: "POST" });
      if (res.status === 503) {
        setOfficeMissing(true);
        const body = (await res.json()) as { message?: string };
        setMessage(body.message ?? "本机未检测到 PowerPoint/LibreOffice，无法导出 PDF/图片");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setMessage(body.message ?? `导出失败（${res.status}）`);
        return;
      }
      const blob = await res.blob();
      const filename = filenameFromDisposition(res, `${projectId}.${format}`);
      downloadBlob(blob, filename);
      setLog((prev) => [
        { time: new Date().toLocaleTimeString(), label: format.toUpperCase(), detail: `${filename} · ${formatSize(blob.size)}` },
        ...prev.slice(0, 9),
      ]);
    } catch {
      setMessage("导出请求失败，请确认服务已启动");
    } finally {
      setBusy(null);
    }
  };

  const buttonClass = (enabled: boolean) =>
    `rounded-lg border px-2.5 py-1 text-xs transition-colors ${
      enabled
        ? "border-hairline-strong bg-surface text-ink hover:border-accent hover:text-accent"
        : "cursor-not-allowed border-hairline bg-canvas text-ink-faint"
    }`;

  const renderButton = (format: PrimaryExportFormat | "pdf" | "png", label: string) => {
    const officeBlocked = officeMissing && format !== primaryFormat;
    const enabled = projectId !== null && busy === null && !officeBlocked;
    return (
      <button
        type="button"
        aria-label={`导出 ${label}`}
        disabled={!enabled}
        className={buttonClass(enabled)}
        onClick={() => void exportAs(format)}
      >
        {busy === format ? "导出中…" : label}
      </button>
    );
  };

  return (
    <section aria-label="导出面板" className="flex flex-col gap-2 border-t border-hairline bg-rail px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-muted">导出</span>
        {renderButton(primaryFormat, primaryLabel)}
        {renderButton("pdf", "PDF")}
        {renderButton("png", "PNG（首页）")}
      </div>
      {message && (
        <p role="alert" aria-label="导出提示" className="text-xs text-warn">
          {message}
        </p>
      )}
      {log.length > 0 && (
        <ul aria-label="导出日志" className="flex max-h-24 flex-col gap-0.5 overflow-y-auto">
          {log.map((entry) => (
            <li key={`${entry.time}-${entry.label}-${entry.detail}`} className="text-xs text-ink-muted">
              [{entry.time}] {entry.label} · {entry.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
