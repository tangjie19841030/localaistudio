import { useRef } from "react";
import { FormSection } from "./FormSection";

interface PptxTemplateSectionProps {
  /** Chosen .pptx; null = no upload, create a blank deck. */
  file: File | null;
  /** Kept in the parent: name prefill / blank-state cleanup side effects. */
  onFileChange: (file: File | null) => void;
  /** Degradation warnings from the latest landing attempt. */
  warnings: string[];
}

/**
 * PPT: optional .pptx template upload (replaces the blank deck). Pure
 * presentation; the file input ref lives here because only this JSX uses it.
 */
export function PptxTemplateSection({ file, onFileChange, warnings }: PptxTemplateSectionProps) {
  const pptxInputRef = useRef<HTMLInputElement>(null);

  return (
    <FormSection title="PPT 模板（可选）">
      <input
        ref={pptxInputRef}
        type="file"
        aria-label="导入 PPTX 模板文件"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="hidden"
        onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => pptxInputRef.current?.click()}
          className="studio-transition inline-flex h-8 items-center rounded-md border border-hairline bg-surface px-3 text-sm text-ink hover:bg-canvas"
        >
          {file ? "重新选择 .pptx" : "选择 .pptx 模板"}
        </button>
        {file && (
          <>
            <span className="max-w-[360px] truncate text-sm text-ink-soft">{file.name}</span>
            <button
              type="button"
              onClick={() => onFileChange(null)}
              className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              移除
            </button>
          </>
        )}
        <span className="text-xs text-ink-faint">不上传则创建空白演示文稿</span>
      </div>
      {warnings.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-warn" title={warnings.join("\n")}>
          {warnings.slice(0, 3).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
          {warnings.length > 3 && <li>…共 {warnings.length} 条降级提示</li>}
        </ul>
      )}
    </FormSection>
  );
}
