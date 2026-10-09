/**
 * Single source of truth for the three spec viewports (spec §7.4).
 * Both the server screenshot runner and the workbench preview derive sizes from here.
 */
export const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
] as const;

export type ViewportName = (typeof VIEWPORTS)[number]["name"];

export interface ViewportSpec {
  name: ViewportName;
  width: number;
  height: number;
}

/** All viewport names in declaration order. */
export const VIEWPORT_NAMES: readonly ViewportName[] = VIEWPORTS.map((v) => v.name);

/**
 * Looks up a viewport spec by name.
 * The name type makes a miss impossible for typed callers; untyped callers get a throw.
 */
export function viewportByName(name: ViewportName): ViewportSpec {
  const found = VIEWPORTS.find((v) => v.name === name);
  if (!found) {
    throw new Error(`未知视口：${String(name)}`);
  }
  return { name: found.name, width: found.width, height: found.height };
}
