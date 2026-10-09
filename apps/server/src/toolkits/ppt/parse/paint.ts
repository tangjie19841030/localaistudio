import { defaultTheme, type PptTheme, type ShapeGradient } from "@studio/ppt-toolkit";
import { asObj, children, intAttr, strAttr, type XmlNode } from "./xml-util.js";

/**
 * Paint and theme domain: scheme color resolution, solid/gradient/alpha fill
 * parsing, theme (colors + CJK-first fonts) assembly and the per-slide clrMap
 * overlay chain. The root of the color pipeline every other module consumes.
 */

export type SchemeColorName =
  | "dk1" | "lt1" | "dk2" | "lt2"
  | "accent1" | "accent2" | "accent3" | "accent4" | "accent5" | "accent6"
  | "bg1" | "tx1";

export function colorNodeHex(node: XmlNode | undefined): string | undefined {
  const srgb = asObj(node?.srgbClr);
  if (srgb) {
    const val = strAttr(srgb, "val");
    if (val && /^[0-9a-fA-F]{6}$/.test(val)) return `#${val.toUpperCase()}`;
  }
  const sys = asObj(node?.sysClr);
  if (sys) {
    const lastClr = strAttr(sys, "lastClr");
    if (lastClr && /^[0-9a-fA-F]{6}$/.test(lastClr)) return `#${lastClr.toUpperCase()}`;
  }
  return undefined;
}

/**
 * Alpha modulation on a color node: <a:srgbClr val=".."><a:alpha val="40000"/></a:srgbClr>
 * (100000 = 100%). Templates use full-bleed tinted rectangles with alpha as
 * color washes; without reading it they import as opaque overlays that cover
 * every title/image below them ("page is one solid rectangle, text missing").
 */
export function colorNodeAlpha(node: XmlNode | undefined): number | undefined {
  const carrier: XmlNode | undefined =
    asObj(node?.srgbClr) ?? asObj(node?.schemeClr) ?? asObj(node?.sysClr);
  const alphaNode: XmlNode | undefined = asObj(carrier?.alpha);
  const raw = intAttr(alphaNode, "val");
  if (raw === undefined) return undefined;
  const alpha = raw / 100000;
  if (!Number.isFinite(alpha)) return undefined;
  return Math.min(1, Math.max(0, alpha));
}

export interface FillInfo {
  hex: string;
  /** Omitted when fully opaque. */
  opacity?: number;
}

export interface PaintInfo {
  solid?: FillInfo;
  gradient?: ShapeGradient;
}

export function solidFillInfo(spPr: XmlNode | undefined, scheme: Map<SchemeColorName, string>): FillInfo | null {
  const fill = asObj(spPr?.solidFill);
  let hex = colorNodeHex(fill);
  if (!hex) {
    const name = strAttr(asObj(fill?.schemeClr), "val") as SchemeColorName | undefined;
    hex = name ? scheme.get(name) : undefined;
  }
  if (!hex) return null;
  const alpha = colorNodeAlpha(fill);
  return alpha === undefined || alpha >= 0.999 ? { hex } : { hex, opacity: Math.max(0.05, alpha) };
}

/**
 * Parse a linear <a:gradFill>: gradient angle is stored 60000ths of a degree,
 * clockwise (0 = left-to-right). Colors may be srgb or scheme references;
 * alpha on a stop is ignored (schema keeps stop colors opaque).
 */
export function gradientFillInfo(spPr: XmlNode | undefined, scheme: Map<SchemeColorName, string>): ShapeGradient | null {
  const grad = asObj(spPr?.gradFill);
  const gsLst = asObj(grad?.gsLst);
  const stops = children(gsLst, "gs")
    .map((gs): { offset: number; color: string } | null => {
      const pos = intAttr(gs, "pos");
      const offset = pos === undefined ? 0 : Math.min(1, Math.max(0, pos / 100000));
      let hex = colorNodeHex(gs);
      if (!hex) {
        const name = strAttr(asObj(gs?.schemeClr), "val") as SchemeColorName | undefined;
        hex = name ? scheme.get(name) : undefined;
      }
      return hex ? { offset, color: hex } : null;
    })
    .filter((s): s is { offset: number; color: string } => s !== null);
  if (stops.length < 2) return null;
  // Schema caps gradients at 8 stops; keep the extremes deterministically.
  const bounded = stops.length > 8 ? [stops[0]!, ...stops.slice(-7)] : stops;
  const rawAng = intAttr(asObj(grad?.lin), "ang") ?? 0;
  const angle = ((rawAng / 60000) % 360 + 360) % 360;
  return { angle, stops: bounded };
}

/** Resolve solid or gradient paint for an spPr. */
export function paintInfo(spPr: XmlNode | undefined, scheme: Map<SchemeColorName, string>): PaintInfo {
  const gradient = gradientFillInfo(spPr, scheme);
  if (gradient) return { gradient };
  const solid = solidFillInfo(spPr, scheme);
  return solid ? { solid } : {};
}

export interface ThemeParseResult {
  theme: PptTheme;
  scheme: Map<SchemeColorName, string>;
}

const SCHEME_KEYS: SchemeColorName[] = [
  "dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "bg1", "tx1",
];

export function colorMapOf(node: XmlNode | undefined): Map<SchemeColorName, SchemeColorName> {
  const map = new Map<SchemeColorName, SchemeColorName>();
  for (const key of SCHEME_KEYS) {
    const value = strAttr(node, key) as SchemeColorName | undefined;
    if (value) map.set(key, value);
  }
  return map;
}

export function resolveScheme(
  scheme: Map<SchemeColorName, string>,
  colorMap: Map<SchemeColorName, SchemeColorName>,
): Map<SchemeColorName, string> {
  const resolved = new Map<SchemeColorName, string>();
  for (const key of SCHEME_KEYS) {
    const source = colorMap.get(key) ?? key;
    const hex = scheme.get(source);
    if (hex) resolved.set(key, hex);
  }
  return resolved;
}

export function parseTheme(themeXml: XmlNode | undefined, warn: (msg: string) => void): ThemeParseResult {
  const fallback = defaultTheme();
  if (!themeXml) return { theme: fallback, scheme: buildSchemeMap(fallback) };
  const clrScheme = asObj(asObj(themeXml.themeElements)?.clrScheme);
  const scheme = new Map<SchemeColorName, string>();
  if (clrScheme) {
    for (const key of ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"] as const) {
      const hex = colorNodeHex(asObj(clrScheme[key]));
      if (hex) scheme.set(key, hex);
    }
    if (scheme.has("dk1")) scheme.set("tx1", scheme.get("dk1")!);
    if (scheme.has("lt1")) scheme.set("bg1", scheme.get("lt1")!);
  }
  const fontScheme = asObj(asObj(themeXml.themeElements)?.fontScheme);
  const fontOf = (which: "majorFont" | "minorFont"): string => {
    const group = asObj(fontScheme?.[which]);
    // East Asian face first (templates are usually authored for CJK content
    // here), then latin; strip theme references like "+mj-lt".
    const ea = strAttr(asObj(group?.ea), "typeface");
    const latin = strAttr(asObj(group?.latin), "typeface");
    const face = ea && !ea.startsWith("+") ? ea : latin && !latin.startsWith("+") ? latin : "";
    if (!face) return which === "majorFont" ? fallback.fontTitle : fallback.fontBody;
    const quoted = /[\s,]/.test(face) ? `'${face}'` : face;
    const stack = `${quoted}, 'Microsoft YaHei', sans-serif`;
    return stack.slice(0, 200);
  };
  const theme: PptTheme = {
    primary: scheme.get("accent1") ?? fallback.primary,
    secondary: scheme.get("dk1") ?? fallback.secondary,
    accent: scheme.get("accent2") ?? fallback.accent,
    background: scheme.get("lt1") ?? fallback.background,
    fontTitle: fontOf("majorFont"),
    fontBody: fontOf("minorFont"),
  };
  if (!clrScheme) warn("未能读取主题配色，已使用内置默认主题");
  return { theme, scheme: buildSchemeMap(theme, scheme) };
}

export const PRST_SHAPE_MAP: Record<string, "rect" | "round" | "ellipse" | "triangle" | "arrow"> = {
  rect: "rect",
  roundRect: "round",
  round2SameRect: "round",
  ellipse: "ellipse",
  triangle: "triangle",
  rtTriangle: "triangle",
  rightArrow: "arrow",
  bentRightArrow: "arrow",
};

export function solidFillHex(spPr: XmlNode | undefined, scheme: Map<SchemeColorName, string>): string | undefined {
  const fill = asObj(spPr?.solidFill);
  return colorNodeHex(fill) ?? (() => {
    const name = strAttr(asObj(fill?.schemeClr), "val") as SchemeColorName | undefined;
    return name ? scheme.get(name) : undefined;
  })();
}

export function buildSchemeMap(theme: PptTheme, source?: Map<SchemeColorName, string>): Map<SchemeColorName, string> {
  const map = new Map<SchemeColorName, string>(source ?? []);
  map.set("accent1", map.get("accent1") ?? theme.primary);
  map.set("accent2", map.get("accent2") ?? theme.accent);
  map.set("dk1", map.get("dk1") ?? theme.secondary);
  map.set("dk2", map.get("dk2") ?? theme.secondary);
  map.set("tx1", map.get("tx1") ?? map.get("dk1") ?? theme.secondary);
  map.set("lt1", map.get("lt1") ?? theme.background);
  map.set("bg1", map.get("bg1") ?? map.get("lt1") ?? theme.background);
  map.set("lt2", map.get("lt2") ?? map.get("lt1") ?? theme.background);
  map.set("dk2", map.get("dk2") ?? map.get("dk1") ?? theme.secondary);
  for (const key of ["accent3", "accent4", "accent5", "accent6"] as const) {
    map.set(key, map.get(key) ?? map.get("accent1") ?? theme.primary);
  }
  return map;
}
