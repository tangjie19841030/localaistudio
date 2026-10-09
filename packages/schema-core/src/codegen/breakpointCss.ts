import type { StudioDocument } from "../document.js";
import { BREAKPOINT_PROPS } from "../registry/breakpoints.js";
import { getComponentDef } from "../registry/componentDefs.js";

/**
 * W4-A breakpoints.css builder: per-node responsive overrides emitted as
 * VIEWPORT media queries. The generated project has no preview-frame
 * container, so the workbench's container-query form cannot apply here — same
 * SEMANTICS, its own mechanism (OP-7). Windows mirror previewDevice.css:
 * tablet [768,1279], mobile < 768. Selectors hit `[data-studio-id]`, which the
 * copied kit already renders, so emitters/pages need no change; `!important`
 * beats the kit's inline grid-template-columns (previewDevice.css precedent).
 *
 * Split out of scaffold.ts when that file crossed the 400-line cap (design §6
 * split clause): a pure move, zero behavior change.
 */

/** Per-viewport media query; desktop is the identity viewport (no override). */
const BREAKPOINT_MEDIA: Readonly<Record<string, string>> = {
  tablet: "(min-width:768px) and (max-width:1279px)",
  mobile: "(max-width:767px)",
};

/**
 * Whitelisted, schema-valid declarations of one overlay: columns use repeat(),
 * gap is spacing units x4 px (kit semantics). A non-whitelist key or a value
 * the component field schema refuses is dropped silently (same tolerance as
 * resolveBreakpointProps — codegen must never crash on a legacy document).
 */
function breakpointDeclarations(type: string, overlay: unknown): string[] {
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return [];
  const shape = (getComponentDef(type)?.propsSchema as { shape?: Record<string, unknown> } | undefined)?.shape;
  const record = overlay as Record<string, unknown>;
  const out: string[] = [];
  for (const key of BREAKPOINT_PROPS[type] ?? []) {
    if (!Object.hasOwn(record, key)) continue;
    const field = shape?.[key] as { safeParse?: (v: unknown) => { success: boolean; data?: unknown } } | undefined;
    const result = field?.safeParse?.(record[key]);
    if (!result?.success || typeof result.data !== "number") continue;
    out.push(
      key === "columns"
        ? `grid-template-columns:repeat(${result.data},minmax(0,1fr)) !important;`
        : `gap:${result.data * 4}px !important;`,
    );
  }
  return out;
}

/**
 * breakpoints.css source for the whole document: one `@media` block per
 * (node, viewport) carrying a whitelisted, schema-valid override. Returns ""
 * when the document declares none — generateFiles then writes no file and the
 * exported project stays byte-identical to the pre-W4 baseline. Pinned nodes
 * are skipped: validation rejects the combination, and codegen stays inert
 * rather than emitting flow rules for a node whose layout is absolute.
 */
export function breakpointCssSource(doc: StudioDocument): string {
  const blocks: string[] = [];
  for (const page of doc.pages) {
    for (const node of page.nodes) {
      const overlays = (node as { breakpoints?: Record<string, unknown> }).breakpoints;
      if (node.pinned || !overlays || typeof overlays !== "object") continue;
      for (const viewport of Object.keys(overlays)) {
        const media = BREAKPOINT_MEDIA[viewport];
        const declarations = breakpointDeclarations(node.type, overlays[viewport]);
        if (!media || declarations.length === 0) continue;
        blocks.push(`@media ${media} {\n  [data-studio-id="${node.id}"] { ${declarations.join(" ")} }\n}`);
      }
    }
  }
  if (blocks.length === 0) return "";
  return ["/* GENERATED FILE — DO NOT EDIT（由 Schema 生成器管理） */", "", ...blocks, ""].join("\n");
}
