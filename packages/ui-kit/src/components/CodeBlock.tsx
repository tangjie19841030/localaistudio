export interface CodeBlockProps {
  code?: string;
  language?: string;
  studioId?: string;
}

export const componentType = "CodeBlock";

/* Fixed dark palette is intentional: code surfaces stay dark in both themes. */
const BLOCK_BG = "#0F172A";
const BLOCK_FG = "#E5E7EB";
const BLOCK_MUTED = "#94A3B8";

/** Copy-icon placeholder (no clipboard wiring yet). */
function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={BLOCK_MUTED} strokeWidth="2" aria-hidden>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function normalizeCode(code: unknown): string {
  if (typeof code === "string") return code;
  if (code == null) return "";
  return String(code);
}

function normalizeLanguage(language: unknown): string {
  return typeof language === "string" && language.trim() !== "" ? language.trim() : "ts";
}

/** Dark code surface: language label + copy placeholder above the source. */
export default function CodeBlock({ code = "const x = 1;", language = "ts", studioId }: CodeBlockProps) {
  const source = normalizeCode(code);
  const label = normalizeLanguage(language);
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="rounded-lg p-3 font-mono"
      style={{ backgroundColor: BLOCK_BG, color: BLOCK_FG }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: BLOCK_MUTED }}>
          {label}
        </span>
        <button type="button" aria-label="复制代码" title="复制" className="cursor-pointer bg-transparent p-0 leading-none">
          <CopyIcon />
        </button>
      </div>
      <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-5" style={{ color: BLOCK_FG }}>
        {source}
      </pre>
    </div>
  );
}
