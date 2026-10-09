import type { Tokens } from "../document.js";

// W4-A: breakpointCssSource lives in ./breakpointCss.js (split out when this
// file crossed the 400-line cap — design §6 split clause, pure move). Re-exported
// here so the documented scaffold-side API surface stays unchanged.
export { breakpointCssSource } from "./breakpointCss.js";

/**
 * Project scaffold emitters (pure string builders, no IO): tokens.css
 * (CSS vars + Tailwind v4 @theme), styles/tokens.ts (typed TS side consumed
 * by AppShell), package.json / vite.config.ts / tsconfig.json / index.html /
 * src/main.tsx / README.md. Dependency versions mirror the repo root so the
 * offline pnpm store already holds them (P3 preview/install requirement).
 */

const GENERATED_HEADER = "// GENERATED FILE — DO NOT EDIT（由 Schema 生成器管理）";

function stripNonLettersKeepSpace(name: string): string {
  return name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim();
}

/**
 * Page/component identifier from the doc name. The result must be a valid JS
 * identifier AND a valid JSX component name, so: ASCII words are PascalCased
 * (a lowercase first letter would make JSX emit an HTML tag instead of the
 * component), a leading digit gets a `Page` prefix (identifiers can't start
 * with a number — tsc TS1003 / esbuild parse error), and CJK passes through
 * verbatim (valid identifier chars, and not /^[a-z]/ so JSX keeps it a
 * component). Empty input falls back to `Page`.
 */
export function pageName(docName: string): string {
  const cleaned = stripNonLettersKeepSpace(docName).replace(/[ _-]+/g, " ").trim();
  const words = cleaned.split(" ").filter(Boolean);
  const cjkTail = words.filter((w) => !/^[A-Za-z0-9]+$/.test(w)).join("");
  const pascal = words
    .filter((w) => /^[A-Za-z0-9]+$/.test(w))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  const ident = `${pascal}${cjkTail}`;
  if (ident === "") return "Page";
  return /^\p{N}/u.test(ident) ? `Page${ident}` : ident;
}

/** package.json name: ASCII words kebab-case, CJK kept as-is. */
export function slugify(name: string): string {
  const cleaned = stripNonLettersKeepSpace(name).replace(/[ _-]+/g, " ").trim();
  if (cleaned === "") return "studio-app";
  const words = cleaned.split(" ").filter(Boolean);
  const asciiWords = words.filter((w) => /^[A-Za-z0-9_-]+$/.test(w)).map((w) => w.toLowerCase());
  const cjk = words.filter((w) => !/^[A-Za-z0-9_-]+$/.test(w)).join("");
  const slug = [...asciiWords, cjk].filter(Boolean).join("-");
  return slug === "" ? "studio-app" : slug;
}

function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Isolated pnpm workspace root. Without this file, `pnpm install` inside a
 * generated project walks up and adopts the studio repo's workspace — the
 * project's own node_modules is never created. `packages: []` plus the esbuild
 * build approval keeps the generated project fully self-contained. NOTE the
 * allowBuilds map format (not onlyBuiltDependencies — pnpm v11 rewrites the
 * latter into a broken placeholder and fails the install with exit 1).
 */
export function pnpmWorkspaceSource(): string {
  return ["packages: []", "", "allowBuilds:", "  esbuild: true", ""].join("\n");
}

/** Tailwind entry for generated tokens.css: @import + explicit @source
 *  hints. Extracted to module scope so tokensToCssSource stays within the
 *  50-line budget; emitted verbatim (drift note kept in the comment). */
const TOKENS_CSS_HEADER = [
  '@import "tailwindcss";',
  "/* Three-view drift fix (project iframe parity): codegen-copied kit files",
  " * are not on Tailwind's auto-scan path. Paths relative to the generated",
  " * file (data/projects/<id>/src/styles/tokens.css). */",
  '@source "../components/ui-studio/**/*.tsx";',
  '@source "../components/generated/**/*.tsx";',
  '@source "../pages/**/*.tsx";',
];

/** `@theme` bridge mapping the CSS vars onto Tailwind utilities. Extracted
 *  for the same 50-line budget reason; emitted verbatim. */
const TOKENS_CSS_THEME = [
    "@theme {",
    "  --color-studio-brand: var(--studio-color-brand);",
    "  --color-studio-surface: var(--studio-color-surface);",
    "  --color-studio-text: var(--studio-color-text);",
    "  --color-studio-muted: var(--studio-color-muted);",
    "  --color-studio-border: var(--studio-color-border);",
    "  --color-studio-accent: var(--studio-color-accent);",
    "  --color-studio-success: var(--studio-color-success);",
    "  --color-studio-warning: var(--studio-color-warning);",
    "  --color-studio-danger: var(--studio-color-danger);",
    "  --radius-studio-card: var(--studio-radius-card);",
    "  --radius-studio-control: var(--studio-radius-control);",
    "  --spacing-studio-unit: var(--studio-spacing-unit);",
    "  --font-studio-sans: var(--studio-font-sans);",
    "}",
];

/** `:root { --studio-color-brand: #...; ... }` — mirrors ui-kit tokensToCssVars. */
export function tokensToCssSource(tokens: Tokens): string {
  const lines = [
    "/* GENERATED FILE — DO NOT EDIT（由 Schema 生成器管理） */",
    ...TOKENS_CSS_HEADER,
    "",
    ":root {",
    `  --studio-color-brand: ${tokens.color.brand};`,
    `  --studio-color-surface: ${tokens.color.surface};`,
    `  --studio-color-text: ${tokens.color.text};`,
    `  --studio-color-muted: ${tokens.color.muted};`,
    `  --studio-color-border: ${tokens.color.border};`,
    `  --studio-color-accent: ${tokens.color.accent};`,
    `  --studio-color-success: ${tokens.color.success};`,
    `  --studio-color-warning: ${tokens.color.warning};`,
    `  --studio-color-danger: ${tokens.color.danger};`,
    `  --studio-color-brand-soft: color-mix(in srgb, ${tokens.color.brand} 12%, transparent);`,
    `  --studio-color-success-soft: color-mix(in srgb, ${tokens.color.success} 12%, transparent);`,
    `  --studio-color-warning-soft: color-mix(in srgb, ${tokens.color.warning} 12%, transparent);`,
    `  --studio-color-danger-soft: color-mix(in srgb, ${tokens.color.danger} 12%, transparent);`,
    `  --studio-color-muted-soft: color-mix(in srgb, ${tokens.color.muted} 10%, transparent);`,
    `  --studio-radius-card: ${tokens.radius.card}px;`,
    `  --studio-radius-control: ${tokens.radius.control}px;`,
    `  --studio-spacing-unit: ${tokens.spacing.unit}px;`,
    `  --studio-font-sans: ${cssString(tokens.font.sans)};`,
    "}",
    "",
    "html, body, #root {",
    "  min-height: 100%;",
    "}",
    "",
    "body {",
    "  margin: 0;",
    "  background: var(--studio-color-surface);",
    "  color: var(--studio-color-text);",
    "  font-family: var(--studio-font-sans);",
    "}",
    "",
    ...TOKENS_CSS_THEME,
    "",
  ];
  return lines.join("\n");
}

/** Object literal source for TOKENS; values are JSON-safe (string/number only). */
function tokenObjectLiteral(tokens: Tokens): string {
  const group = (name: string, entries: [string, unknown][], render: (v: unknown) => string, last: boolean): string[] => {
    const body = entries.map(([k, v], i) => `    ${k}: ${render(v)}${i < entries.length - 1 ? "," : ""}`);
    return [`  ${name}: {`, ...body, last ? "  }" : "  },"];
  };
  const groups: string[][] = [
    group("color", Object.entries(tokens.color), (v) => JSON.stringify(v), false),
    group("radius", Object.entries(tokens.radius), (v) => String(v), false),
    group("spacing", Object.entries(tokens.spacing), (v) => String(v), false),
    group("font", Object.entries(tokens.font), (v) => JSON.stringify(v), true),
  ];
  return groups.flat().join("\n");
}

export function tokensToTsSource(tokens: Tokens): string {
  return [
    GENERATED_HEADER,
    'import type { Tokens } from "../studio/schema-core";',
    "",
    "/** Document tokens as a typed constant (consumed by AppShell's tokens prop). */",
    "export const TOKENS = {",
    tokenObjectLiteral(tokens),
    "} as const satisfies Tokens;",
    "",
  ].join("\n");
}

export function packageJsonSource(docName: string): string {
  const pkg = {
    name: slugify(docName),
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: {
      dev: "vite",
      build: "tsc --noEmit && vite build",
      preview: "vite preview",
    },
    dependencies: {
      react: "^19.1.0",
      "react-dom": "^19.1.0",
    },
    devDependencies: {
      "@types/react": "^19.1.0",
      "@types/react-dom": "^19.1.0",
      "@tailwindcss/vite": "^4.1.8",
      "@vitejs/plugin-react": "^4.5.0",
      tailwindcss: "^4.1.8",
      typescript: "^5.9.0",
      vite: "^7.0.0",
    },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export function viteConfigSource(): string {
  return [
    GENERATED_HEADER,
    'import tailwindcss from "@tailwindcss/vite";',
    'import react from "@vitejs/plugin-react";',
    'import { defineConfig } from "vite";',
    "",
    "export default defineConfig({",
    "  plugins: [react(), tailwindcss()],",
    "});",
    "",
  ].join("\n");
}

export function tsconfigSource(): string {
  const ts = {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
      isolatedModules: true,
      forceConsistentCasingInFileNames: true,
    },
    include: ["src", "vite.config.ts"],
  };
  return `${JSON.stringify(ts, null, 2)}\n`;
}

export function indexHtmlSource(docName: string): string {
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${docName}</title>`,
    "  </head>",
    "  <body>",
    '    <div id="root"></div>',
    '    <script type="module" src="/src/main.tsx"></script>',
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

/** One page's route entry: hash key source (`name`, used verbatim) + component. */
export interface PageRouteEntry {
  name: string;
  component: string;
}

/** Old single-page main.tsx — frozen bytes, the W3-A regression guard. */
function singlePageMainSource(pageComponent: string): string {
  return [
    GENERATED_HEADER,
    'import { StrictMode } from "react";',
    'import { createRoot } from "react-dom/client";',
    `import ${pageComponent} from "./pages/${pageComponent}";`,
    'import "./styles/tokens.css";',
    "",
    "createRoot(document.getElementById(\"root\")!).render(",
    "  <StrictMode>",
    `    <${pageComponent} />`,
    "  </StrictMode>,",
    ");",
    "",
  ].join("\n");
}

/** Hash micro-router body: 24-line skeleton + 2 lines per page (import + ROUTES entry). */
function routedMainSource(pages: PageRouteEntry[], first: PageRouteEntry): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const page of pages) {
    // Duplicate page names cannot be told apart by a hash key; first one wins
    // (a duplicate key would also be a TS1117 error in the generated file).
    if (seen.has(page.name)) continue;
    seen.add(page.name);
    entries.push(`  ${JSON.stringify(`#/${page.name}`)}: ${page.component},`);
  }
  return [
    GENERATED_HEADER,
    'import { StrictMode, useEffect, useState } from "react";',
    'import { createRoot } from "react-dom/client";',
    ...pages.map((page) => `import ${page.component} from "./pages/${page.component}";`),
    'import "./styles/tokens.css";',
    "",
    '// W3-A hash micro-router: route key = "#/" + page.name (verbatim, no slugify).',
    `const ROUTES: Record<string, typeof ${first.component}> = {`,
    ...entries,
    "};",
    `const HOME = ${JSON.stringify(`#/${first.name}`)};`,
    "const currentRoute = () => (Object.hasOwn(ROUTES, window.location.hash) ? window.location.hash : HOME);",
    "",
    "function App() {",
    "  const [route, setRoute] = useState(currentRoute);",
    "  useEffect(() => {",
    "    const onHashChange = () => setRoute(currentRoute());",
    '    window.addEventListener("hashchange", onHashChange);',
    '    return () => window.removeEventListener("hashchange", onHashChange);',
    "  }, []);",
    "  const Page = ROUTES[route] ?? ROUTES[HOME];",
    "  return <Page />;",
    "}",
    "",
    'createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);',
    "",
  ].join("\n");
}

/**
 * main.tsx source. Single page keeps the old direct-render form byte-for-byte;
 * multi-page documents get the W3-A hash micro-router (`#/` + page.name).
 * Unknown hash — including a dangling action target — falls back to page 1.
 */
export function mainTsxSource(pages: PageRouteEntry[]): string {
  const first = pages[0];
  if (!first) return singlePageMainSource("Page");
  if (pages.length === 1) return singlePageMainSource(first.component);
  return routedMainSource(pages, first);
}

export function readmeSource(docName: string): string {
  return [
    `# ${docName}`,
    "",
    "由 Local AI UI Studio 生成（`src/` 下含 GENERATED 标记的文件会被重生成覆盖）。",
    "",
    "```bash",
    "pnpm install",
    "pnpm dev",
    "pnpm build",
    "```",
    "",
  ].join("\n");
}

/**
 * tokens.css with the breakpoints stylesheet imported. CSS requires `@import`
 * to precede every rule (a trailing @import is ignored by browsers), so the
 * line goes directly after the Tailwind entry rather than at the file end —
 * tokens.css stays the single entry point as designed. Empty breakpoint source
 * returns the input untouched, which is the no-override baseline bytes.
 */
export function tokensCssWithBreakpoints(tokensCss: string, breakpointCss: string): string {
  if (breakpointCss === "") return tokensCss;
  const anchor = '@import "tailwindcss";';
  return tokensCss.replace(anchor, `${anchor}\n@import "./breakpoints.css";`);
}
