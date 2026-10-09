import { describe, expect, it } from "vitest";
import type { Page, StudioDocument } from "../src/document.js";
import { DOCUMENT_VERSION, defaultTokens } from "../src/document.js";
import { generateFiles } from "../src/codegen/generateFiles.js";
import { mainTsxSource } from "../src/codegen/scaffold.js";
import { minimalKit } from "./codegen-fixtures.js";

/**
 * W3-A codegen side of the three-view navigation contract (§2.2/§2.3).
 *
 * MIRROR FIXTURE: the exact same document shape (pages 首页/关于, a Button whose
 * `action` targets page-2) is rendered by apps/workbench/src/preview/preview.test.tsx
 * on the SchemaRenderer side, where the click must produce onNavigate("page-2").
 * One contract, two assertions — codegen emits the hash, the renderer calls the
 * callback; both sides derive the route key from page.name verbatim.
 *
 * Route key rule: `#/` + page.name as-is (no slugify/PascalCase). The emitted
 * component identifier (pageName()) is a separate concern and may differ.
 */

/** W3-A mirror doc: 首页 has a Button navigating to 关于 (page-2). */
function navDoc(): StudioDocument {
  const home: Page = {
    id: "page-1",
    name: "首页",
    rootId: "home-root",
    nodes: [
      { id: "home-root", type: "Container", props: { maxWidth: "lg" }, children: ["go"] },
      { id: "go", type: "Button", props: { label: "去关于页" }, children: [], action: { type: "navigate", pageId: "page-2" } },
    ],
  };
  const about: Page = {
    id: "page-2",
    name: "关于",
    rootId: "about-root",
    nodes: [{ id: "about-root", type: "Container", props: { maxWidth: "lg" }, children: [] }],
  };
  return { documentVersion: DOCUMENT_VERSION, name: "导航演示", tokens: defaultTokens(), pages: [home, about] };
}

function navKit(): Map<string, string> {
  return minimalKit("Container", "Button");
}

/** Frozen pre-W3 single-page main.tsx — the byte-equality regression guard. */
const OLD_SINGLE_MAIN = [
  "// GENERATED FILE — DO NOT EDIT（由 Schema 生成器管理）",
  'import { StrictMode } from "react";',
  'import { createRoot } from "react-dom/client";',
  'import 首页 from "./pages/首页";',
  'import "./styles/tokens.css";',
  "",
  'createRoot(document.getElementById("root")!).render(',
  "  <StrictMode>",
  "    <首页 />",
  "  </StrictMode>,",
  ");",
  "",
].join("\n");

describe("W3-A codegen：main.tsx hash 微路由", () => {
  const main = generateFiles(navDoc(), navKit()).get("src/main.tsx")!;

  it("多页输出含 ROUTES 表，hash key 逐页 = `#/` + page.name 原样", () => {
    expect(main).toContain("const ROUTES");
    expect(main).toContain('"#/首页": 首页,');
    expect(main).toContain('"#/关于": 关于,');
    // No slugify / PascalCase on the route key (only the import identifier is pascal-ish).
    expect(main).not.toContain("#/Shouye");
  });

  it("骨架：hashchange 监听 + 未知 hash 回首页（不崩）", () => {
    expect(main).toContain('window.addEventListener("hashchange"');
    expect(main).toContain("window.removeEventListener");
    expect(main).toContain('const HOME = "#/首页";');
    expect(main).toContain("Object.hasOwn(ROUTES, window.location.hash) ? window.location.hash : HOME");
  });

  it("骨架行数 ≤30 + 每页 2 行（import + ROUTES 条目）", () => {
    const lines = main.split("\n");
    // Per-page lines: 2 imports + 2 route entries.
    const perPage = lines.filter((l) => l.startsWith("import ") && l.includes("./pages/")).length;
    const entries = lines.filter((l) => /^ {2}"#\//.test(l)).length;
    expect(perPage).toBe(2);
    expect(entries).toBe(2);
    expect(lines.length).toBeLessThanOrEqual(30 + 2 * 2 + 1);
  });

  it("页面文件：action 节点 emit onClick 设 hash（目标页名原样）", () => {
    const page = generateFiles(navDoc(), navKit()).get("src/pages/首页.tsx")!;
    expect(page).toContain('onClick={() => { window.location.hash = "#/关于"; }}');
    expect(page).toContain('label="去关于页"');
  });

  it("无 action 的节点不产生 onClick（既有输出不变）", () => {
    const page = generateFiles(navDoc(), navKit()).get("src/pages/关于.tsx")!;
    expect(page).not.toContain("window.location.hash");
    expect(page).toContain('<Container maxWidth="lg" studioId="about-root" />');
  });

  it("action 覆盖 props.onClick（文档级意图优先）", () => {
    const doc = navDoc();
    const home = doc.pages[0]!;
    home.nodes = home.nodes.map((n) => (n.id === "go" ? { ...n, props: { ...n.props, onClick: "旧回调" } } : n));
    const page = generateFiles(doc, navKit()).get("src/pages/首页.tsx")!;
    expect(page).toContain('onClick={() => { window.location.hash = "#/关于"; }}');
    // onClick is not a registry prop, so declaredProps drops the authored value.
    expect(page).not.toContain("旧回调");
  });

  it("悬空 action（绕过校验的旧档）不崩、不 emit onClick", () => {
    const doc = navDoc();
    doc.pages[0]!.nodes = doc.pages[0]!.nodes.map((n) =>
      n.id === "go" ? { ...n, action: { type: "navigate" as const, pageId: "page-missing" } } : n,
    );
    const files = generateFiles(doc, navKit());
    const page = files.get("src/pages/首页.tsx")!;
    expect(page).not.toContain("window.location.hash");
    expect(page).toContain('<Button label="去关于页" studioId="go" />');
  });
});

describe("W3-A codegen：单页文档字节不变（回归护栏）", () => {
  it("mainTsxSource 单页回退旧形（逐字节相等）", () => {
    expect(mainTsxSource([{ name: "首页", component: "首页" }])).toBe(OLD_SINGLE_MAIN);
  });

  it("generateFiles 单页文档的 main.tsx 与旧输出逐字节相等", () => {
    const doc = navDoc();
    doc.pages = [doc.pages[0]!];
    doc.pages[0]!.nodes = doc.pages[0]!.nodes.filter((n) => n.id !== "go");
    const files = generateFiles(doc, navKit());
    expect(files.get("src/main.tsx")).toBe(OLD_SINGLE_MAIN);
    expect(files.get("src/main.tsx")).not.toContain("ROUTES");
  });
});
