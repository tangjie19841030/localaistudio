import type { NodeRecord, Page, StudioDocument, Tokens } from "../document.js";
import { hasComponent, listComponentDefs } from "../registry/componentDefs.js";
import { getNode } from "../registry/treeUtils.js";
import {
  indentBlock,
  ABSOLUTE_CONTEXT,
  FLOW_CONTEXT,
  type CodegenLayout,
  type EmitContext,
  type FrameEmitContext,
} from "./emitters.js";
import {
  assembleComponentFile,
  emitScopedNode,
  emitSectionComponentJsx,
  hasAnyFrame,
  hasAnyPinnedFrame,
  newFileScope,
  relativeRootWrap,
  resolveSectionNames,
} from "./pages.js";
import {
  indexHtmlSource,
  mainTsxSource,
  packageJsonSource,
  pageName,
  pnpmWorkspaceSource,
  readmeSource,
  tokensToCssSource,
  tokensToTsSource,
  tokensCssWithBreakpoints,
  tsconfigSource,
  viteConfigSource,
  type PageRouteEntry,
} from "./scaffold.js";
import { breakpointCssSource } from "./breakpointCss.js";

/**
 * Code generation orchestrator — pure function, zero IO.
 *
 * `generateFiles(doc, kitSources, opts?) -> Map<relativePath, content>`. kitSources
 * maps ui-kit component name -> component source (the CALLER reads the disk);
 * the generator decides which files the export project needs and copies them
 * verbatim (shadcn/ui copy-paste model). Output is fully deterministic:
 * fixed insertion order, sorted imports, no timestamps, no randomness.
 *
 * Layout: `opts.layout` defaults to "flow" — frames are canvas drag geometry
 * and never reach the output. `{ layout: "absolute" }` opts into the P5
 * free-canvas compatibility path (frame wrapper divs, relative page root).
 *
 * Self-containment of the copied kit (export project has no workspace deps):
 * - `@studio/schema-core` imports rewrite to the generated local type stub
 *   `src/studio/schema-core.ts` (Tokens interface only).
 * - A `../tokens` import (ui-kit's shared tokens helper) forces a copy of
 *   kitSources["tokens"] to `src/components/tokens.ts`; a missing entry is a
 *   caller contract error (thrown with the offending name).
 * - Any other `../` import or any other `@studio/*` package cannot resolve in
 *   the export project -> thrown as a contract error (fail fast, no broken builds).
 */

/** Local stand-in for @studio/schema-core's Tokens type (type-only usage). */
const SCHEMA_CORE_STUB = [
  "// GENERATED FILE — DO NOT EDIT（由 Schema 生成器管理）",
  "// Local stand-in for the @studio/schema-core Tokens type (type-only import).",
  "export interface Tokens {",
  "  color: Record<",
  "    | 'brand'",
  "    | 'surface'",
  "    | 'text'",
  "    | 'muted'",
  "    | 'border'",
  "    | 'accent'",
  "    | 'success'",
  "    | 'warning'",
  "    | 'danger',",
  "    string",
  "  >;",
  "  radius: { card: number; control: number };",
  "  spacing: { unit: number };",
  "  font: { sans: string };",
  "}",
  "",
].join("\n");

/**
 * Kit declaration order — copied barrels/imports keep this canonical sequence.
 * Derived from the REGISTRY (declaration order) instead of a hardcoded P1-era
 * list: the P7 expansion (23→58) left the old list stale, so docs using any
 * new component (SearchInput, Tabs, charts…) generated references WITHOUT the
 * source file — the export project crashed with "X is not defined".
 */
const KIT_ORDER: string[] = listComponentDefs().map((d) => d.type);

/** W5: inline-rendered registry types with NO kit component — never kit copies (processKitCopies would throw). */
const NON_KIT_TYPES = new Set(["SvgBox"]);

/** Pre-order node walk from the root; cycle-safe, detached nodes skipped. */
function reachableNodes(page: Page): NodeRecord[] {
  const out: NodeRecord[] = [];
  const visited = new Set<string>([page.rootId]);
  const walk = (id: string): void => {
    const node = getNode(page, id);
    if (!node) return;
    out.push(node);
    for (const childId of node.children) {
      if (!visited.has(childId)) {
        visited.add(childId);
        walk(childId);
      }
    }
  };
  walk(page.rootId);
  return out;
}

/** Kit component types ONE PAGE uses, in canonical declaration order. */
export function usedKitTypesOfPage(page: Page): string[] {
  const used = new Set<string>();
  for (const node of reachableNodes(page)) {
    if (hasComponent(node.type) && !NON_KIT_TYPES.has(node.type)) used.add(node.type);
  }
  return KIT_ORDER.filter((t) => used.has(t));
}

/** Union of usedKitTypes over every page (kit copies stay single, T19 §3.5). */
function uniqueKitTypesOfPages(doc: StudioDocument): string[] {
  const used = new Set<string>();
  for (const page of doc.pages) {
    for (const type of usedKitTypesOfPage(page)) used.add(type);
  }
  return KIT_ORDER.filter((t) => used.has(t));
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

/** true when the specifier points at ui-kit's shared tokens helper (../tokens or ./tokens). */
function isTokensHelperImport(specifier: string): boolean {
  return specifier === "../tokens" || specifier === "./tokens";
}

/** true when the component source references ui-kit's shared tokens helper. */
function referencesTokensHelper(source: string): boolean {
  return /["'](\.\.?\/)?tokens["']/.test(source);
}

/** Check/rewrite one import specifier; returns rewritten match or the original.
 *  schemaCorePath is the correct relative path from the copied file's depth. */
function rewriteSpecifier(match: string, specifier: string, schemaCorePath: string): string {
  if (
    specifier === "react" ||
    specifier === "react-dom" ||
    specifier === "react/jsx-runtime" ||
    specifier.startsWith("node:")
  ) {
    return match;
  }
  if (specifier === "@studio/schema-core") {
    return match.replace(specifier, schemaCorePath);
  }
  if (isTokensHelperImport(specifier)) {
    return match; // ../tokens stays valid from src/components/ui-studio/
  }
  throw new Error(`kit 源码引用了导出项目无法解析的 import "${specifier}"`);
}

/** Verify the kit source's imports are resolvable; rewrite schema-core refs. */
function processKitSource(source: string, schemaCorePath: string): string {
  return source.replace(IMPORT_RE, (match, specifier: string) =>
    rewriteSpecifier(match, specifier, schemaCorePath),
  );
}

function kitBarrelSource(copiedTypes: string[]): string {
  return [
    "// GENERATED FILE — DO NOT EDIT（由 Schema 生成器管理）",
    ...copiedTypes.map((t) => `export { default as ${t} } from "./${t}";`),
    "",
  ].join("\n");
}

function importStatement(names: string[], from: string): string {
  return `import { ${[...names].join(", ")} } from "${from}";`;
}

/** Collect + verify + rewrite the kit sources the doc needs. */
function processKitCopies(
  copiedTypes: string[],
  kitSources: Map<string, string>,
): { processed: Map<string, string>; tokensSource: string; needsTokens: boolean } {
  const processed = new Map<string, string>();
  let needsTokens = false;
  for (const type of copiedTypes) {
    if (!kitSources.has(type)) {
      throw new Error(`kitSources 缺少用到的组件源码："${type}"`);
    }
    const source = kitSources.get(type)!;
    processed.set(type, processKitSource(source, "../../studio/schema-core"));
    if (referencesTokensHelper(source)) needsTokens = true;
  }
  if (needsTokens && !kitSources.has("tokens")) {
    throw new Error('kit 组件引用了 "../tokens" 但 kitSources 缺少 "tokens" 源码');
  }
  // Shared tokens helper: schema-core type rewrites to the local stub
  // (from src/components/tokens.ts -> ../studio/schema-core); any other
  // @studio package or ../ path cannot resolve in the export project.
  const tokensSource = needsTokens ? processKitSource(kitSources.get("tokens")!, "../studio/schema-core") : "";
  if (needsTokens && tokensSource.includes("@studio/")) {
    throw new Error('ui-kit "tokens" 源码引用了 @studio 工作区包，无法在导出项目内解析');
  }
  return { processed, tokensSource, needsTokens };
}

/** Emit the page file: Sections become <Name /> refs; kit nodes inline.
 *  The page root gains a `position: relative` wrapper when any node can emit
 *  an absolute wrapper in this mode — absolute compat mode: any frame-bearing
 *  node (P5 rule); flow default: only pinned+frame nodes (Plan C exemption).
 *  Frames without a pin (legacy canvas metadata) never trigger the wrapper,
 *  so pre-Plan-C flow output stays byte-identical. */
function emitPageFile(
  page: Page,
  tokens: Tokens,
  sectionNames: Map<string, string>,
  pageComponent: string,
  ctx: FrameEmitContext,
  navCtx: EmitContext,
): string {
  const scope = newFileScope(page, tokens, sectionNames, ctx, navCtx);
  const jsx = emitScopedNode(scope, page.rootId, ctx);
  const needsRelativeRoot =
    ctx.layout === "absolute" ? hasAnyFrame(page) : hasAnyPinnedFrame(page);
  const wrapped = needsRelativeRoot ? `${relativeRootWrap()}\n${indentBlock(jsx)}\n</div>` : jsx;
  const imports: string[] = [];
  const pageKit = KIT_ORDER.filter((t) => scope.kitTypes.has(t));
  if (pageKit.length > 0) imports.push(importStatement(pageKit, "../components/ui-studio"));
  if (scope.appShellUsed) imports.push('import { TOKENS } from "../styles/tokens";');
  for (const name of [...scope.sectionRefs.values()].sort()) {
    imports.push(importStatement([name], `../components/generated/${name}`));
  }
  return assembleComponentFile(pageComponent, wrapped, imports, { defaultExport: true });
}

/** Emit one extracted Section component file (Section itself inlined). */
function emitSectionFile(
  page: Page,
  tokens: Tokens,
  sectionNames: Map<string, string>,
  nodeId: string,
  name: string,
  ctx: FrameEmitContext,
  navCtx: EmitContext,
): string {
  const scope = newFileScope(page, tokens, sectionNames, ctx, navCtx);
  const jsx = emitSectionComponentJsx(scope, nodeId, ctx);
  const imports: string[] = [];
  const kit = KIT_ORDER.filter((t) => scope.kitTypes.has(t));
  if (kit.length > 0) imports.push(importStatement(kit, "../ui-studio"));
  if (scope.appShellUsed) imports.push('import { TOKENS } from "../../styles/tokens";');
  for (const childName of [...scope.sectionRefs.values()].sort()) {
    imports.push(importStatement([childName], `./${childName}`));
  }
  return assembleComponentFile(name, jsx, imports);
}

/** Styles + build scaffold (package.json, vite, tsconfig, html, main, readme). */
function emitScaffold(files: Map<string, string>, doc: StudioDocument, routes: PageRouteEntry[]): void {
  // W4-A: breakpoints.css exists ONLY for documents declaring overrides — a
  // no-override doc keeps the pre-W4 tokens.css bytes exactly (regression guard).
  const breakpoints = breakpointCssSource(doc);
  if (breakpoints !== "") {
    files.set("src/styles/breakpoints.css", breakpoints);
  }
  files.set("src/styles/tokens.css", tokensCssWithBreakpoints(tokensToCssSource(doc.tokens), breakpoints));
  files.set("src/styles/tokens.ts", tokensToTsSource(doc.tokens));
  files.set("package.json", packageJsonSource(doc.name));
  files.set("pnpm-workspace.yaml", pnpmWorkspaceSource());
  files.set("vite.config.ts", viteConfigSource());
  files.set("tsconfig.json", tsconfigSource());
  files.set("index.html", indexHtmlSource(doc.name));
  files.set("src/main.tsx", mainTsxSource(routes));
  files.set("README.md", readmeSource(doc.name));
}

/**
 * Layout option for generateFiles. "flow" (default) treats frames as canvas
 * metadata EXCEPT on `pinned` nodes — the explicit free-positioning exemption
 * (Plan C hybrid positioning): a pinned+frame node wraps in one absolute
 * geometric div at page coordinates, and the page root gains a
 * `position: relative` container. "absolute" keeps the P5 free-canvas output
 * (every frame-bearing node wraps + relative page root, coordinates re-based
 * per wrapper); `pinned` has no extra effect there.
 */
export interface GenerateOptions {
  layout?: CodegenLayout;
}

function frameContext(opts: GenerateOptions): FrameEmitContext {
  return opts.layout === "absolute" ? ABSOLUTE_CONTEXT : FLOW_CONTEXT;
}

/** Unique page component names across ALL pages (doc name no longer the key):
 *  pageName(page.name) with Name2/Name3 suffixes on collision (pages.ts
 *  uniquify convention). Reservations land in the SHARED `taken` set (kit
 *  catalog + page names + section component names, W3 §3.5) so Section
 *  components cross-page stay shadow-free too. */
function uniquePageNames(doc: StudioDocument, taken: Set<string>): Map<string, string> {
  const byPageId = new Map<string, string>();
  for (const page of doc.pages) {
    const base = pageName(page.name);
    let name = base;
    if (taken.has(name)) {
      let n = 2;
      while (taken.has(`${base}${n}`)) n += 1;
      name = `${base}${n}`;
    }
    taken.add(name);
    byPageId.set(page.id, name);
  }
  return byPageId;
}

/** W3-A routes: page NAME verbatim (hash key) + emitted component identifier. */
function pageRoutes(doc: StudioDocument, byPageId: Map<string, string>): PageRouteEntry[] {
  return doc.pages.map((page) => ({ name: page.name, component: byPageId.get(page.id)! }));
}

/** W3-A interaction context: action pageId -> page NAME (the hash route key).
 *  An unknown pageId yields "" so emitters drop the onClick (dangling action
 *  from a pre-validation document must not crash codegen — §2.6). */
function navigationContext(doc: StudioDocument): EmitContext {
  const nameById = new Map(doc.pages.map((page) => [page.id, page.name]));
  return { pageNameOf: (pageId) => nameById.get(pageId) ?? "" };
}

export function generateFiles(
  doc: StudioDocument,
  kitSources: Map<string, string>,
  opts: GenerateOptions = {},
): Map<string, string> {
  const files = new Map<string, string>();
  const ctx = frameContext(opts);
  const tokens = doc.tokens;

  // 1. Which kit components do ALL pages use (union scan, one copy)?
  const copiedTypes = uniqueKitTypesOfPages(doc);

  // 2. Verify + copy kit sources (import rewrites happen here).
  const { processed, tokensSource, needsTokens } = processKitCopies(copiedTypes, kitSources);

  // 3. Unique page component names (cross-page dedup; kit catalog reserved).
  // W3 §3.5: ONE shared reservation set for kit names + page names + section
  // component names, so same-titled sections across pages dedup with a suffix.
  const taken = new Set<string>(KIT_ORDER);
  const byPageId = uniquePageNames(doc, taken);

  // 3b. W3-A: hash routes (page name verbatim) + action pageId -> name resolver.
  const routes = pageRoutes(doc, byPageId);
  const navCtx = navigationContext(doc);

  // 4. One page file per document page + per-page Section extraction.
  for (const page of doc.pages) {
    const pageComponent = byPageId.get(page.id)!;
    // W3 §3.5: sectionNames resolve against the SHARED `taken` set (kit names
    // + page names + prior pages' sections), so a same-titled section on a
    // later page gets Name2 and never overwrites an earlier page's file.
    const sectionNames = resolveSectionNames(page, taken);
    files.set(
      `src/pages/${pageComponent}.tsx`,
      emitPageFile(page, tokens, sectionNames, pageComponent, ctx, navCtx),
    );
    for (const [nodeId, name] of sectionNames) {
      files.set(
        `src/components/generated/${name}.tsx`,
        emitSectionFile(page, tokens, sectionNames, nodeId, name, ctx, navCtx),
      );
    }
  }

  // 5. Kit copies + barrel (+ shared tokens helper when referenced).
  for (const type of copiedTypes) {
    files.set(`src/components/ui-studio/${type}.tsx`, processed.get(type)!);
  }
  files.set("src/components/ui-studio/index.ts", kitBarrelSource(copiedTypes));
  if (needsTokens) {
    files.set("src/components/tokens.ts", tokensSource);
  }
  files.set("src/studio/schema-core.ts", SCHEMA_CORE_STUB);

  // 6. Styles + scaffold (tokens from the document root; main renders the route
  // table — a single-page doc keeps the pre-W3 direct-render bytes).
  emitScaffold(files, doc, routes);

  return files;
}
