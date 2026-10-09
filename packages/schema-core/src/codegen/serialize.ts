/**
 * Props -> JSX attribute string serialization (pure, no DOM/React knowledge).
 *
 * Value rules (doc props are zod-validated registry shapes):
 * - string  -> double-quoted JSX attribute literal with XML entities for
 *   syntax-sensitive characters. Backslashes stay literal because JSX text is
 *   not a JavaScript string. Enum-valued
 *   strings (tone/variant/size/...) are still strings in the doc model, so
 *   they serialize as literals — exactly what the kit's TS props expect.
 * - boolean -> `true` bare attribute name, `false` `={false}`.
 * - number  -> `={n}`.
 * - array   -> `={JSON.stringify(arr)}` (Nav.items etc.).
 * - undefined/null -> skipped.
 *
 * W5: escapeJsxString is exported for emitters.svgInlineJsx — the SvgBox
 * inline-SVG payload needs the exact same JSX-string escaping as attributes.
 */

/** W5: also consumed by emitters.svgInlineJsx for the SvgBox inline payload. */
export function escapeJsxString(value: string): string {
  // JSX quoted attributes use XML-style text, not JavaScript string syntax:
  // a backslash cannot escape a quote there. Escape ampersands first so input
  // such as the literal text "&quot;" is not decoded as an entity at runtime.
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;")
    .replace(/\t/g, "&#9;");
}

/** Attribute value piece including the `=`; "" means a bare boolean attribute. */
function attrValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return `="${escapeJsxString(value)}"`;
  if (typeof value === "boolean") return value ? "" : "={false}";
  if (typeof value === "number") return `={${value}}`;
  if (Array.isArray(value)) return `={${JSON.stringify(value)}}`;
  // Unknown shapes (schema forbids them today) still produce a JS literal.
  return `={${JSON.stringify(value)}}`;
}

/** Serialize props to a JSX attribute list: `label="x" columns={3} sidebar`. */
export function serializeProps(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    const rendered = attrValue(value);
    if (rendered === undefined) continue;
    // boolean true renders as the bare attribute name; else name=<value piece>
    parts.push(`${key}${rendered}`);
  }
  return parts.join(" ");
}
