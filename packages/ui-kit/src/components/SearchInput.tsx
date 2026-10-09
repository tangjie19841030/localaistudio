import { useState } from "react";

export interface SearchInputProps {
  placeholder?: string;
  value?: string;
  studioId?: string;
}

export const componentType = "SearchInput";

function toStr(v: unknown, fallback: string): string {
  if (v == null) return fallback;
  return typeof v === "string" ? v : String(v);
}

/** Rounded-full search field with a magnifier icon and a clear button. */
export default function SearchInput({ placeholder = "搜索…", value, studioId }: SearchInputProps) {
  const [text, setText] = useState(() => toStr(value, ""));
  return (
    <div
      data-component={componentType}
      data-studio-id={studioId}
      className="relative flex w-full items-center"
    >
      <span
        aria-hidden
        className="absolute left-3 flex items-center"
        style={{ color: "var(--studio-color-muted)" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
      </span>
      <input
        type="text"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-full border py-1.5 pl-8 pr-8 text-sm outline-none"
        style={{
          borderColor: "var(--studio-color-border)",
          backgroundColor: "var(--studio-color-surface)",
          color: "var(--studio-color-text)",
        }}
      />
      {text !== "" && (
        <button
          type="button"
          aria-label="清空"
          onClick={() => setText("")}
          className="absolute right-2 flex size-5 cursor-pointer items-center justify-center rounded-full text-xs leading-none"
          style={{ color: "var(--studio-color-muted)" }}
        >
          ×
        </button>
      )}
    </div>
  );
}
