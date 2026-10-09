/**
 * Agent-write-path props normalization (generate-mode tolerance).
 *
 * Live-model repro: the model passes a pixel number where the registry expects
 * an enum token (Container maxWidth: 1200 -> "Expected string, received
 * number"), which fails the whole tool call. Only this recurring shape is
 * repaired, and only on the agent tool write path (insert_node / update_props).
 * The registry zod schema and the patch/API write paths keep strict validation.
 */

/** Tailwind-aligned breakpoint ladder for Container.maxWidth. */
const MAX_WIDTH_STEPS: ReadonlyArray<readonly [number, string]> = [
  [640, "sm"],
  [768, "md"],
  [1024, "lg"],
  [1280, "xl"],
];

/** Strings that already are legal Container.maxWidth tokens. */
const MAX_WIDTH_TOKENS = new Set(["sm", "md", "lg", "xl", "full"]);

/** Plain unsigned number strings only ("1200", "640.5") — no hex/exponent junk. */
const NUMERIC_STRING_RE = /^\d+(?:\.\d+)?$/;

/** Number -> enum token; undefined when the number is not a sane width. */
function widthTokenOf(value: number): string | undefined {
  // 0 / negative / NaN / Infinity stay strict: mapping them would invent a
  // dimension the model never meant (the original zod error is more useful).
  if (!Number.isFinite(value) || value <= 0) return undefined;
  for (const [limit, token] of MAX_WIDTH_STEPS) {
    if (value <= limit) return token;
  }
  return "full";
}

/** number | numeric string | "100%" -> token; anything else returns the input. */
function normalizeMaxWidth(value: unknown): unknown {
  if (typeof value === "number") return widthTokenOf(value) ?? value;
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (text === "100%") return "full";
  if (MAX_WIDTH_TOKENS.has(text)) return text;
  if (!NUMERIC_STRING_RE.test(text)) return value;
  return widthTokenOf(Number(text)) ?? value;
}

/**
 * Repair Container.maxWidth on tool args before zod validation. Returns the
 * SAME props reference when nothing needs repair, so untouched calls keep
 * byte-identical validation input (and error semantics).
 */
export function normalizeAgentProps(
  type: string,
  props: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (type !== "Container" || props === undefined || !Object.hasOwn(props, "maxWidth")) return props;
  const normalized = normalizeMaxWidth(props.maxWidth);
  return normalized === props.maxWidth ? props : { ...props, maxWidth: normalized };
}
