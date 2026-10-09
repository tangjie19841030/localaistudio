import { useState } from "react";
import type { Tokens } from "@studio/schema-core";
import { importTokens } from "../../features/tokens/importTokens";

export interface TokenImportButtonProps {
  /** Lands through TokenEditor's applyPreset channel (single undo entry). */
  onApply: (tokens: Tokens) => void;
  /** Reserved: open a dedicated error list; v1 renders errors inline. */
  onError?: () => void;
}

const TEXTAREA =
  "studio-transition w-full rounded-md border border-hairline bg-canvas px-2.5 py-1.5 font-mono text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
const BUTTON =
  "studio-transition rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-sm text-ink hover:border-hairline-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

/**
 * Paste-a-token-JSON entry (v1: no file dialog — the user pastes the file's
 * content). Import failures show line-level errors inline and never touch the
 * document; success clears the textarea, reports the ignored-keys summary and
 * hands the parsed tokens upward through onApply.
 */
export function TokenImportButton({ onApply, onError }: TokenImportButtonProps) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [summary, setSummary] = useState<string | null>(null);

  const apply = () => {
    const result = importTokens(text);
    if (result.ok && result.tokens) {
      onApply(result.tokens);
      setErrors([]);
      setWarnings(result.warnings);
      setSummary(
        result.warnings.length > 0
          ? `已导入 ${result.mapped.length} 项，忽略 ${result.warnings.length} 项`
          : `已导入 ${result.mapped.length} 项`,
      );
      setText("");
    } else {
      setErrors(result.errors);
      setWarnings(result.warnings);
      setSummary(null);
      onError?.();
    }
  };

  return (
    <details className="rounded-md border border-hairline bg-canvas px-2.5 py-1.5">
      <summary className="cursor-pointer text-sm text-ink">导入 Token JSON</summary>
      <div className="mt-2 space-y-2">
        <textarea
          aria-label="Token JSON"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={'粘贴设计工具导出的 token JSON，例如 {"primary": "#0D9488"}'}
          className={TEXTAREA}
        />
        <button type="button" onClick={apply} className={BUTTON}>
          应用
        </button>
        {summary && <p className="text-xs text-ink-muted">{summary}</p>}
        {errors.map((e) => (
          <p key={e} role="alert" className="text-xs text-danger">
            {e}
          </p>
        ))}
        {warnings.map((w) => (
          <p key={w} className="text-xs text-ink-muted">
            {w}
          </p>
        ))}
      </div>
    </details>
  );
}
