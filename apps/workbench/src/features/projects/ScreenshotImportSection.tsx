import type { StudioDocument } from "@studio/schema-core";
import { useRef, useState } from "react";
import { importImageApi, type ImportImageMode } from "../../api/import-image";
import { FormSection } from "./FormSection";

interface ScreenshotImportSectionProps {
  /** Fired after the server converted the images into a StudioDocument. The
   * parent owns project create/save error UI; this callback never throws. */
  onImported: (document: StudioDocument, warnings: string[]) => void;
}

/** One picked screenshot waiting for import; the dataURL feeds both the
 * preview <img> and the request payload. */
interface PendingImage {
  name: string;
  dataUrl: string;
}

const MAX_IMAGES = 4;

const MODE_OPTIONS: { value: ImportImageMode; label: string }[] = [
  { value: "screenshot", label: "成品截图" },
  { value: "wireframe", label: "手绘 / 线框" },
];

// Local copy of NewProjectForm's private FIELD constant — sibling sections do
// not import each other's module-private constants (T49 design note).
const FIELD =
  "mt-1 w-full rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint studio-transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

/** Read one image file as a data URL (preview and payload share it). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`无法读取文件：${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** Convert picked files into preview entries; only the first MAX_IMAGES kept. */
async function toPendingImages(files: File[]): Promise<PendingImage[]> {
  const picked = files.slice(0, MAX_IMAGES);
  const images: PendingImage[] = [];
  for (const file of picked) {
    images.push({ name: file.name, dataUrl: await fileToDataUrl(file) });
  }
  return images;
}

/** Thumbnail grid of pending screenshots, each row with a remove button. */
function ImagePreviewGrid({
  images,
  onRemove,
}: {
  images: PendingImage[];
  onRemove: (index: number) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {images.map((img, index) => (
        <li key={`${img.name}-${index}`} className="rounded-md border border-hairline bg-surface p-1.5">
          <img src={img.dataUrl} alt={`截图预览 ${index + 1}`} className="h-20 w-full rounded object-cover" />
          <div className="mt-1 flex items-center justify-between gap-1">
            <span className="truncate text-xs text-ink-soft" title={img.name}>
              {img.name}
            </span>
            <button
              type="button"
              aria-label={`移除截图 ${img.name}`}
              onClick={() => onRemove(index)}
              className="shrink-0 text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              移除
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * "从截图导入" section (T49), rendered for UI projects only next to the
 * template picker and outside the create <form>. Owns file picking → dataURL
 * conversion → preview → POST /api/ai/import-image; project creation and
 * saveProject stay in NewProjectForm via onImported.
 */
export function ScreenshotImportSection({ onImported }: ScreenshotImportSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [mode, setMode] = useState<ImportImageMode>("screenshot");
  const [styleHint, setStyleHint] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  /** Replace the pending set with newly picked files (first MAX_IMAGES kept). */
  async function addFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    setError(null);
    setTruncated(files.length > MAX_IMAGES);
    try {
      setImages(await toPendingImages(files));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  /** Convert the images, then hand the document to the parent for landing. */
  async function runImport() {
    if (images.length === 0 || importing) return;
    setImporting(true);
    setError(null);
    try {
      const result = await importImageApi.importImage({
        images: images.map((img) => img.dataUrl),
        mode,
        styleHint: styleHint.trim() || undefined,
      });
      onImported(result.document, result.warnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <FormSection title="从截图导入（可选）">
      <input
        ref={inputRef}
        type="file"
        aria-label="导入截图"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={importing}
          className="studio-transition inline-flex h-8 items-center rounded-md border border-hairline bg-surface px-3 text-sm text-ink hover:bg-canvas disabled:opacity-40"
        >
          {images.length > 0 ? "重新选择截图" : "选择截图"}
        </button>
        <span className="text-xs text-ink-faint">最多 {MAX_IMAGES} 张，重新选择会替换已选图片</span>
      </div>
      {truncated && <p className="text-xs text-warn">一次最多导入 {MAX_IMAGES} 张，已仅保留前 {MAX_IMAGES} 张</p>}
      {images.length > 0 && <ImagePreviewGrid images={images} onRemove={removeImage} />}
      <div>
        <p className="text-xs font-medium text-ink-soft">图片类型</p>
        <div role="radiogroup" aria-label="图片类型" className="mt-1 flex flex-wrap gap-2">
          {MODE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`studio-transition flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${
                mode === option.value
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-hairline text-ink-soft hover:bg-surface"
              }`}
            >
              <input
                type="radio"
                name="import-image-mode"
                value={option.value}
                checked={mode === option.value}
                disabled={importing}
                onChange={() => setMode(option.value)}
                className="accent-accent"
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
      <label className="block text-xs font-medium text-ink-soft">
        风格补充（可选）
        <textarea
          rows={2}
          maxLength={500}
          className={FIELD}
          placeholder="例如：深色科技风、圆角卡片、中文界面"
          value={styleHint}
          onChange={(e) => setStyleHint(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runImport()}
          disabled={importing || images.length === 0}
          className="studio-transition inline-flex h-8 items-center rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:hover:bg-accent"
        >
          {importing ? "识别中…" : "导入截图生成页面"}
        </button>
        {importing && (
          <span role="status" className="text-xs text-ink-soft">
            正在识别 {images.length} 张截图，本地模型可能需要 30–90 秒…
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </FormSection>
  );
}
