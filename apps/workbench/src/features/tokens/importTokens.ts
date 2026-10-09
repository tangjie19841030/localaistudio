import { defaultTokens, tokensSchema, type Tokens } from "@studio/schema-core";

/**
 * Lenient token-JSON import result (U5 §3.1). ok === (errors.length === 0):
 * failures NEVER throw, they come back as line-level error strings the UI
 * renders one by one. tokens is present only when ok, already passed through
 * tokensSchema.parse.
 */
export interface ImportTokensResult {
  ok: boolean;
  tokens?: Tokens; // Present iff ok=true
  errors: string[]; // Line-level errors, "<canonical path>: <reason>（来自 "<source key>"）"
  warnings: string[]; // Ignored keys / alias conflicts — non-blocking
  mapped: string[]; // Canonical paths that took effect (preview rendering)
}

/** The 13 canonical leaf paths, mirroring tokensSchema declaration order. */
const LEAF_PATHS = [
  "color.brand",
  "color.surface",
  "color.text",
  "color.muted",
  "color.border",
  "color.accent",
  "color.success",
  "color.warning",
  "color.danger",
  "radius.card",
  "radius.control",
  "spacing.unit",
  "font.sans",
] as const;
type LeafPath = (typeof LEAF_PATHS)[number];

/** Structural stand-in for a zod schema so this module needs no zod import. */
interface SafeParseFail {
  success: false;
  error: { issues: { message: string }[] };
}
interface MiniSchema {
  safeParse(v: unknown): { success: true; data: unknown } | SafeParseFail;
}

const colorShape = tokensSchema.shape.color.shape;
const radiusShape = tokensSchema.shape.radius.shape;
/** Per-leaf sub-schemas of tokensSchema — single-key validation surface. */
const LEAF_SCHEMAS: Record<LeafPath, MiniSchema> = {
  "color.brand": colorShape.brand,
  "color.surface": colorShape.surface,
  "color.text": colorShape.text,
  "color.muted": colorShape.muted,
  "color.border": colorShape.border,
  "color.accent": colorShape.accent,
  "color.success": colorShape.success,
  "color.warning": colorShape.warning,
  "color.danger": colorShape.danger,
  "radius.card": radiusShape.card,
  "radius.control": radiusShape.control,
  "spacing.unit": tokensSchema.shape.spacing.shape.unit,
  "font.sans": tokensSchema.shape.font.shape.sans,
};

/** Direct leaf-name → canonical path (flat "brand" / dotted "color.brand" shapes). */
const LEAF_TABLE: Record<string, LeafPath> = {
  brand: "color.brand",
  surface: "color.surface",
  text: "color.text",
  muted: "color.muted",
  border: "color.border",
  accent: "color.accent",
  success: "color.success",
  warning: "color.warning",
  danger: "color.danger",
  card: "radius.card",
  control: "radius.control",
  unit: "spacing.unit",
  sans: "font.sans",
};

/**
 * Common design-tool alias names (v1 FIXED table per design §3.1 — future
 * shadcn/npm/.fig importers extend mapping HERE, the schema never changes).
 * Each alias may fill several leaves; the scalar "radius" alias gives
 * radius.control the value and lets radius.card share it.
 */
const ALIAS_TABLE: Record<string, readonly LeafPath[]> = {
  primary: ["color.brand"],
  background: ["color.surface"],
  bg: ["color.surface"],
  foreground: ["color.text"],
  fg: ["color.text"],
  "text-primary": ["color.text"],
  secondary: ["color.muted"],
  "border-color": ["color.border"],
  destructive: ["color.danger"],
  radius: ["radius.control", "radius.card"],
};

const GROUP_NAMES = new Set(["color", "radius", "spacing", "font"]);

const UNKNOWN_HINT = "未知键；.fig / shadcn / npm 包导入为预留接口（未来在此扩展映射表）";

interface Candidate {
  raw: string; // Source key as written — for messages
  paths: readonly LeafPath[];
  value: unknown;
}

interface Collected {
  candidates: Candidate[];
  warnings: string[];
  errors: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** "brand" → leaf table, "primary" → alias table; null when unresolvable. */
function resolveName(name: string): readonly LeafPath[] | null {
  const leaf = LEAF_TABLE[name];
  if (leaf) return [leaf];
  return ALIAS_TABLE[name] ?? null;
}

/** "color.brand" / "color.primary" → paths inside that group; null otherwise. */
function resolveDotted(key: string): readonly LeafPath[] | null {
  const parts = key.split(".");
  if (parts.length !== 2) return null;
  const group = parts[0]!;
  if (!GROUP_NAMES.has(group)) return null;
  const inner = (resolveName(parts[1]!) ?? []).filter((p) => p.startsWith(`${group}.`));
  return inner.length > 0 ? inner : null;
}

/** One pass over the parsed root, preserving key order (first hit wins later). */
function collectCandidates(root: Record<string, unknown>): Collected {
  const out: Collected = { candidates: [], warnings: [], errors: [] };
  for (const [key, value] of Object.entries(root)) {
    if (key.includes(".")) {
      const paths = resolveDotted(key);
      if (paths) out.candidates.push({ raw: key, paths, value });
      else out.warnings.push(`"${key}" 已忽略（${UNKNOWN_HINT}）`);
    } else if (GROUP_NAMES.has(key)) {
      if (isPlainObject(value)) {
        collectGroup(out, key, value);
      } else {
        // Group name with a scalar value: only "radius" doubles as an alias
        // (scalar → control+card). Other groups have no scalar meaning.
        const aliasPaths = resolveName(key);
        if (aliasPaths) out.candidates.push({ raw: key, paths: aliasPaths, value });
        else out.errors.push(`"${key}": 应为对象（{ "${key}": { … } } 形状）`);
      }
    } else {
      const paths = resolveName(key);
      if (paths) out.candidates.push({ raw: key, paths, value });
      else out.warnings.push(`"${key}" 已忽略（${UNKNOWN_HINT}）`);
    }
  }
  return out;
}

/** A group value must be a nested object (caller guarantees it); subkeys go
 *  through the same tables. */
function collectGroup(out: Collected, group: string, value: Record<string, unknown>): void {
  for (const [sub, subValue] of Object.entries(value)) {
    const paths = (resolveName(sub) ?? []).filter((p) => p.startsWith(`${group}.`));
    if (paths.length > 0) out.candidates.push({ raw: `${group}.${sub}`, paths, value: subValue });
    else out.warnings.push(`"${group}.${sub}" 已忽略（${UNKNOWN_HINT}）`);
  }
}

/** First hit per canonical path wins; later sources degrade into warnings. */
function assignFirstHit(candidates: Candidate[]): {
  assigned: Map<LeafPath, { raw: string; value: unknown }>;
  warnings: string[];
} {
  const assigned = new Map<LeafPath, { raw: string; value: unknown }>();
  const warnings: string[] = [];
  for (const c of candidates) {
    for (const p of c.paths) {
      const prev = assigned.get(p);
      if (prev) warnings.push(`"${c.raw}" 已忽略（${p} 已由 "${prev.raw}" 提供）`);
      else assigned.set(p, { raw: c.raw, value: c.value });
    }
  }
  return { assigned, warnings };
}

/** Every assigned value passes its single-leaf tokensSchema sub-schema. */
function validateAssigned(assigned: Map<LeafPath, { raw: string; value: unknown }>): {
  values: Map<LeafPath, unknown>;
  errors: string[];
} {
  const values = new Map<LeafPath, unknown>();
  const errors: string[] = [];
  for (const [path, src] of assigned) {
    const parsed = LEAF_SCHEMAS[path].safeParse(src.value);
    if (parsed.success) values.set(path, parsed.data);
    else {
      const reason = parsed.error.issues[0]?.message ?? "值不合法";
      errors.push(`${path}: ${reason}（来自 "${src.raw}"）`);
    }
  }
  return { values, errors };
}

function setLeaf(tokens: Tokens, path: LeafPath, value: unknown): void {
  const dot = path.indexOf(".");
  const group = path.slice(0, dot) as keyof Tokens;
  const leaf = path.slice(dot + 1);
  (tokens[group] as Record<string, unknown>)[leaf] = value;
}

/** Defaults first (tokenPresets withColors semantics), then the mapped leaves. */
function assembleTokens(values: Map<LeafPath, unknown>): Tokens {
  const tokens: Tokens = defaultTokens();
  for (const [path, value] of values) setLeaf(tokens, path, value);
  return tokens;
}

/**
 * Lenient token-JSON import: accepts flat / nested / dotted-path shapes plus
 * common design-tool aliases, fills unmapped leaf keys from defaults, and
 * reports everything it ignored (unknown keys → warnings, never blockers).
 */
export function importTokens(input: string): ImportTokensResult {
  let root: unknown;
  try {
    root = JSON.parse(input);
  } catch (e) {
    return { ok: false, errors: [`不是合法 JSON: ${(e as Error).message}`], warnings: [], mapped: [] };
  }
  if (!isPlainObject(root)) {
    return { ok: false, errors: ["导入内容必须是 JSON 对象（{ … } 形状）"], warnings: [], mapped: [] };
  }
  const { candidates, warnings: collectWarnings, errors } = collectCandidates(root);
  const { assigned, warnings: conflictWarnings } = assignFirstHit(candidates);
  const { values, errors: valueErrors } = validateAssigned(assigned);
  const warnings = [...collectWarnings, ...conflictWarnings];
  const allErrors = [...errors, ...valueErrors];
  if (allErrors.length > 0) {
    return { ok: false, errors: allErrors, warnings, mapped: [] };
  }
  // Unreachable while LEAF_SCHEMAS mirrors tokensSchema; guards table drift.
  const parsed = tokensSchema.safeParse(assembleTokens(values));
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      warnings,
      mapped: [],
    };
  }
  return { ok: true, tokens: parsed.data, errors: [], warnings, mapped: [...values.keys()] };
}
