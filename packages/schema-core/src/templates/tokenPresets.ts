import type { Tokens } from "../document.js";
import { defaultTokens } from "../document.js";

/** A named palette users can apply in one shot from the token editor. */
export interface TokenPreset {
  id: string;
  name: string;
  tokens: Tokens;
}

/** Builds a preset's tokens from defaults with color overrides only. */
function withColors(overrides: Partial<Tokens["color"]>): Tokens {
  const base = defaultTokens();
  return { ...base, color: { ...base.color, ...overrides } };
}

/** Fixed declaration order — the preset dropdown renders this sequence. */
export const TOKEN_PRESETS: TokenPreset[] = [
  {
    id: "default",
    name: "默认青",
    tokens: defaultTokens(),
  },
  {
    id: "teal",
    name: "深海蓝绿",
    tokens: withColors({
      brand: "#0D9488",
      surface: "#F8FAFC",
      text: "#0F172A",
      muted: "#5B7083",
      border: "#CBD5E1",
      accent: "#0891B2",
    }),
  },
  {
    id: "slate",
    name: "石墨灰",
    tokens: withColors({
      brand: "#334155",
      surface: "#FFFFFF",
      text: "#0B1120",
      muted: "#6B7280",
      border: "#D8DEE7",
      accent: "#4F46E5",
    }),
  },
  {
    id: "warm",
    name: "暖橙",
    tokens: withColors({
      brand: "#C2410C",
      surface: "#FFFBF5",
      text: "#2B1A10",
      muted: "#8A6A55",
      border: "#EEDCC8",
      accent: "#D97706",
    }),
  },
];

export function presetById(id: string): TokenPreset | undefined {
  return TOKEN_PRESETS.find((p) => p.id === id);
}

/** All preset ids in declaration order. */
export function listTokenPresetIds(): string[] {
  return TOKEN_PRESETS.map((p) => p.id);
}
