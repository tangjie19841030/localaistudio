import type { StudioDocument, TokenPath, Tokens } from "@studio/schema-core";
import { TOKEN_PRESETS, presetById, setToken } from "@studio/schema-core";

/** Placeholder option value: "nothing picked yet". */
export const NO_PRESET = "";

/** Flatten a token set into the [path, value] pairs setToken() accepts. */
export function tokenPathEntries(tokens: Tokens): [TokenPath, string | number][] {
  const colors = Object.entries(tokens.color) as [keyof Tokens["color"], string][];
  return [
    ...colors.map(([key, value]) => [["color", key], value] as [TokenPath, string]),
    [["radius", "card"], tokens.radius.card],
    [["radius", "control"], tokens.radius.control],
    [["spacing", "unit"], tokens.spacing.unit],
    [["font", "sans"], tokens.font.sans],
  ];
}

/**
 * Apply a whole preset by folding setToken over every path. Meant to run inside
 * one editorStore.applyOp callback so the palette swap is a single undo entry
 * (schema-core has no batch token op and must not be changed from here).
 */
export function applyPresetTokens(doc: StudioDocument, tokens: Tokens): StudioDocument {
  return tokenPathEntries(tokens).reduce((d, [path, value]) => setToken(d, path, value), doc);
}

export interface TokenPresetPickerProps {
  /** Applies a whole preset; the caller decides how it lands in the undo stack. */
  onApply: (tokens: Tokens) => void;
}

/**
 * One-shot palette picker. It is an action, not persistent state: the select is
 * pinned to the placeholder so it always reads "选择预设…" after applying.
 */
export function TokenPresetPicker({ onApply }: TokenPresetPickerProps) {
  return (
    <select
      aria-label="Token 预设"
      value={NO_PRESET}
      onChange={(e) => {
        const preset = presetById(e.target.value);
        if (preset) onApply(preset.tokens);
      }}
      className="studio-transition w-full rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-sm text-ink hover:border-hairline-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
    >
      <option value={NO_PRESET}>选择预设…</option>
      {TOKEN_PRESETS.map((p) => (
        <option key={p.id} value={p.id} title={p.name}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
