export interface UploadProps {
  hint?: string;
  studioId?: string;
}

export const componentType = "Upload";

/** Dashed-border dropzone with an upload icon and a muted hint. */
export default function Upload({ hint = "点击或拖拽文件到此处上传", studioId }: UploadProps) {
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="flex h-24 w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed"
      style={{
        borderColor: "var(--studio-color-border)",
        backgroundColor: "var(--studio-color-surface)",
      }}
    >
      <span aria-hidden className="flex items-center" style={{ color: "var(--studio-color-muted)" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 15V4m0 0 3.5 3.5M12 4 8.5 7.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" strokeLinecap="round" />
        </svg>
      </span>
      <span className="text-[12px]" style={{ color: "var(--studio-color-muted)" }}>
        {hint}
      </span>
    </div>
  );
}
