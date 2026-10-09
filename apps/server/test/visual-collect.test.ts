import { describe, expect, it } from "vitest";
import type { A11yElementMetric, PageSeoMetrics } from "@studio/schema-core";
import { COLLECT_SCRIPT, type CollectedPage } from "../src/visual/collect.js";

/**
 * The collector ships as a STRING because esbuild's keepNames rewrite injects a
 * `__name` helper that does not exist in the page (real Playwright run fails with
 * "ReferenceError: __name is not defined"). These tests run the exact string
 * against a tiny fake DOM, so a regression in the script body is caught here
 * instead of only in the browser.
 */

interface FakeEl {
  tagName: string;
  parentElement: FakeEl | null;
  children: FakeEl[];
  textContent: string;
  scrollWidth: number;
  clientWidth: number;
  studioId?: string;
  id?: string;
  interactive?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  attrs?: Record<string, string>;
  matches(sel: string): boolean;
  closest(sel: string): FakeEl | null;
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
  getAttribute(name: string): string | null;
}

/**
 * css-attr matcher for selectors like `meta[name="viewport"]`, `a[href]`,
 * `input:not([type="hidden"])`. Returns true for elements whose attrs satisfy
 * every `[k="v"]` / `[k]` clause (T24c §4.4 collector needs these to filter
 * images / controls / links / headings).
 */
function selectorMatches(el: FakeEl, sel: string): boolean {
  if (sel === "*") return true;
  if (sel.includes(":")) {
    const colonIdx = sel.indexOf(":");
    const head = sel.slice(0, colonIdx);
    const tail = sel.slice(colonIdx + 1);
    if (head && head !== "*") {
      const headOk = head.includes("[") ? matchAttrSelector(el, head) : el.tagName.toLowerCase() === head;
      if (!headOk) return false;
    }
    const notMatch = tail.match(/^not\(\[([\w-]+)(?:="([^"]*)")?\]\)$/);
    if (notMatch) {
      const name = notMatch[1] as string;
      const value = notMatch[2];
      const actual = name === "data-studio-id" ? el.studioId ?? null : el.attrs?.[name] ?? null;
      if (value === undefined) return actual === null || actual === undefined;
      return actual !== value;
    }
    return false;
  }
  if (sel.includes("[") && sel.endsWith("]")) {
    return matchAttrSelector(el, sel);
  }
  return el.tagName.toLowerCase() === sel;
}

function matchAttrSelector(el: FakeEl, sel: string): boolean {
  const match = sel.match(/^(\w+)?(?:\[([^\]]+)\])?$/);
  if (!match) return false;
  const tag = match[1];
  const attrExpr = match[2];
  if (tag && el.tagName.toLowerCase() !== tag) return false;
  if (!attrExpr) return true;
  const m = attrExpr.match(/^([\w-]+)(?:="([^"]*)")?$/);
  if (!m) return false;
  const name = m[1] as string;
  const value = m[2];
  const actual = name === "data-studio-id" ? el.studioId ?? null : el.attrs?.[name] ?? null;
  if (value === undefined) return actual !== null && actual !== undefined;
  return actual === value;
}

function el(tag: string, over: Partial<FakeEl> = {}): FakeEl {
  const node: FakeEl = {
    tagName: tag.toUpperCase(),
    parentElement: null,
    children: [],
    textContent: "",
    scrollWidth: 100,
    clientWidth: 100,
    matches: () => Boolean(node.interactive),
    querySelector: (sel: string) => querySelector(node, sel),
    querySelectorAll: (sel: string) => querySelectorAll(node, sel),
    closest: () => {
      let cur: FakeEl | null = node;
      while (cur) {
        if (cur.studioId) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    getBoundingClientRect: () => node.rect ?? { x: 0, y: 0, width: 100, height: 20 },
    getAttribute: (name) => {
      if (name === "data-studio-id") return node.studioId ?? null;
      return node.attrs?.[name] ?? null;
    },
    ...over,
  };
  return node;
}

function link(parent: FakeEl, children: FakeEl[]): FakeEl {
  parent.children = children;
  for (const child of children) child.parentElement = parent;
  return parent;
}

/** Walk a tree and return every descendant (depth-first, document order). */
function flatten(root: FakeEl): FakeEl[] {
  const out: FakeEl[] = [];
  const walk = (node: FakeEl): void => {
    for (const child of node.children) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

/**
 * Naive selector list parser. Handles comma-separated tag selectors that mix
 * plain tags with attr / `:not(...)` filters — the only kind COLLECT_SCRIPT
 * uses. Anything richer falls back to per-segment match via selectorMatches.
 */
function querySelectorAll(scope: FakeEl, sel: string): FakeEl[] {
  const parts = sel.split(",").map((s) => s.trim());
  const all = flatten(scope);
  const out: FakeEl[] = [];
  for (const el of all) {
    for (const part of parts) {
      if (selectorMatches(el, part)) {
        out.push(el);
        break;
      }
    }
  }
  return out;
}

function querySelector(scope: FakeEl, sel: string): FakeEl | null {
  const matches = querySelectorAll(scope, sel);
  return matches[0] ?? null;
}

function getElementById(scope: FakeEl, id: string): FakeEl | null {
  const all = flatten(scope);
  return all.find((el) => el.id === id) ?? null;
}

/** Runs COLLECT_SCRIPT with `document` bound to a fake tree. */
function collect(
  body: FakeEl,
  docSizes: { scroll: number; client: number },
  extra?: { title?: string; lang?: string; meta?: Record<string, string> },
): CollectedPage {
  const htmlEl = {
    scrollWidth: docSizes.scroll,
    clientWidth: docSizes.client,
    getAttribute: (name: string) => (name === "lang" ? extra?.lang ?? null : null),
  };
  // Stub `document.querySelector('meta[name="..."]')` via a synthetic <head>
  // tree: the COLLECT_SCRIPT only queries by `meta[name="description|viewport"]`.
  const headChildren: FakeEl[] = [];
  if (extra?.meta) {
    for (const [name, content] of Object.entries(extra.meta)) {
      headChildren.push(
        el("meta", {
          attrs: { name, content },
        }),
      );
    }
  }
  const head = el("head", { children: headChildren });
  for (const c of headChildren) c.parentElement = head;
  const document = {
    title: extra?.title ?? "",
    documentElement: htmlEl,
    head,
    body,
    getElementById: (id: string) => getElementById(body, id),
    querySelector: (sel: string) => querySelector(head, sel) ?? querySelector(body, sel),
    querySelectorAll: (sel: string) => [...querySelectorAll(head, sel), ...querySelectorAll(body, sel)],
  };
  const run = new Function("document", `return ${COLLECT_SCRIPT};`) as (
    doc: unknown,
  ) => CollectedPage;
  return run(document);
}

describe("COLLECT_SCRIPT", () => {
  it("采集文档宽度；只保留有文本或可交互的元素", () => {
    const html = el("html");
    const body = el("body", { parentElement: html });
    const wrapper = el("div");
    const empty = el("div"); // no text, not interactive → dropped
    const heading = el("h3", { textContent: "  标题  ", scrollWidth: 320, clientWidth: 200 });
    const button = el("button", { interactive: true, textContent: "" }); // kept: interactive
    link(body, [link(wrapper, [empty, heading, button])]);

    const out = collect(body, { scroll: 1600, client: 1440 });
    expect(out.docScrollWidth).toBe(1600);
    expect(out.docClientWidth).toBe(1440);
    expect(out.elements.map((e) => e.selector)).toEqual([
      "body > div > h3",
      "body > div > button",
    ]);
    expect(out.elements[0]!.text).toBe("标题"); // trimmed
    expect(out.elements[0]!.scrollWidth).toBe(320);
    expect(out.elements[1]!.interactive).toBe(true);
  });

  it("同标签兄弟走 nth-of-type；ancestorSelectors 自下而上", () => {
    const body = el("body");
    const a = el("section");
    const b = el("section");
    const text = el("p", { textContent: "x" });
    link(body, [a, b]);
    link(b, [text]);

    const out = collect(body, { scroll: 1440, client: 1440 });
    const metric = out.elements.find((e) => e.selector.endsWith("p"))!;
    expect(metric.selector).toBe("body > section:nth-of-type(2) > p");
    expect(metric.ancestorSelectors).toEqual(["body > section:nth-of-type(2)", "body"]);
  });

  it("studioId 取最近的 data-studio-id 祖先；没有则字段缺省而非空串", () => {
    const body = el("body");
    const section = el("div", { studioId: "node-42" });
    const inner = el("h3", { textContent: "标题" });
    const loose = el("span", { textContent: "游离" });
    link(body, [section, loose]);
    link(section, [inner]);

    const out = collect(body, { scroll: 1440, client: 1440 });
    const nested = out.elements.find((e) => e.selector.endsWith("h3"))!;
    const orphan = out.elements.find((e) => e.selector.endsWith("span"))!;
    expect(nested.studioId).toBe("node-42");
    expect("studioId" in orphan).toBe(false);
  });

  it("选择器深度截断在 4 段", () => {
    const body = el("body");
    let cur = body;
    for (const tag of ["main", "section", "div", "ul", "li"]) {
      const next = el(tag, { textContent: "深" });
      link(cur, [next]);
      cur = next;
    }
    const out = collect(body, { scroll: 1440, client: 1440 });
    const deepest = out.elements.at(-1)!;
    expect(deepest.selector.split(" > ")).toHaveLength(4);
    expect(deepest.selector).toBe("section > div > ul > li");
  });

  it("空 body 返回空清单而不抛", () => {
    const out = collect(el("body"), { scroll: 390, client: 390 });
    expect(out.elements).toEqual([]);
  });
});

function byKind(items: A11yElementMetric[]): Record<string, A11yElementMetric[]> {
  const out: Record<string, A11yElementMetric[]> = {};
  for (const it of items) {
    (out[it.kind] ??= []).push(it);
  }
  return out;
}

function expectSeo(out: CollectedPage): PageSeoMetrics {
  expect(out.seo).toBeDefined();
  return out.seo;
}

describe("COLLECT_SCRIPT：a11y 采集", () => {
  it("图片：alt 即 accessibleName；缺 alt 即空串", () => {
    const body = el("body");
    const ok = el("img", { attrs: { alt: "logo" } });
    const bad = el("img", { attrs: { alt: "" } });
    const missing = el("img");
    link(body, [ok, bad, missing]);
    const out = collect(body, { scroll: 1440, client: 1440 });
    const images = byKind(out.a11y).image ?? [];
    expect(images).toHaveLength(3);
    expect(images[0]!.accessibleName).toBe("logo");
    expect(images[1]!.accessibleName).toBe("");
    expect(images[2]!.accessibleName).toBe("");
  });

  it("标题：h1-h6 都进入 a11y，带 level；text / accessibleName 都用 trimmed 文本", () => {
    const body = el("body");
    link(body, [
      el("h1", { textContent: "  标题  " }),
      el("h3", { textContent: "子节", studioId: "n1" }),
    ]);
    const out = collect(body, { scroll: 1440, client: 1440 });
 const headings = byKind(out.a11y).heading ?? [];
    expect(headings.map((h) => h.level)).toEqual([1, 3]);
    expect(headings[0]!.text).toBe("标题");
    expect(headings[0]!.accessibleName).toBe("标题");
    expect(headings[1]!.studioId).toBe("n1");
  });

  it("控件：button 用 textContent；input 优先 aria-label / label / placeholder", () => {
    const body = el("body");
    const labelA = el("label", { textContent: "邮箱", attrs: { for: "email" } });
    const inputA = el("input", { id: "email" });
    const btn = el("button", { textContent: "提交" });
    const aria = el("button", { attrs: { "aria-label": "关闭" }, textContent: "x" });
    const ph = el("input", { attrs: { placeholder: "请输入" } });
    link(body, [labelA, inputA, btn, aria, ph]);
    const out = collect(body, { scroll: 1440, client: 1440 });
    const controls = byKind(out.a11y).control ?? [];
    const buttons = controls.filter((c) => c.selector.includes("> button"));
    expect(buttons.map((b) => b.accessibleName)).toEqual(["提交", "关闭"]);
    const inputs = controls.filter((c) => c.selector.includes("> input"));
    expect(inputs.map((i) => i.accessibleName)).toEqual(["邮箱", "请输入"]);
  });

  it("链接：a[href] 用 aria-label 或 trimmed 文本", () => {
    const body = el("body");
    link(body, [
      el("a", { textContent: "了解更多", attrs: { href: "/about" } }),
      el("a", { textContent: "  ", attrs: { href: "/x", "aria-label": "次要" } }),
      el("a", { textContent: "无 href 不算 link" }), // 没 href 应被 querySelectorAll('a[href]') 排除
    ]);
    const out = collect(body, { scroll: 1440, client: 1440 });
    const links = byKind(out.a11y).link ?? [];
    expect(links).toHaveLength(2);
    expect(links[0]!.accessibleName).toBe("了解更多");
    expect(links[1]!.accessibleName).toBe("次要");
  });

  it("studioId：取最近 data-studio-id 祖先", () => {
    const body = el("body");
    const section = el("div", { studioId: "n1" });
    const img = el("img", { attrs: { alt: "x" } });
    link(body, [section]);
    link(section, [img]);
    const out = collect(body, { scroll: 1440, client: 1440 });
    const images = byKind(out.a11y).image ?? [];
    expect(images[0]!.studioId).toBe("n1");
  });
});

describe("COLLECT_SCRIPT：seo 采集", () => {
  it("正常页面：title / lang / h1Count / description / viewportMeta", () => {
    const body = el("body");
    link(body, [el("h1", { textContent: "A" }), el("h1", { textContent: "B" })]);
    const out = collect(body, { scroll: 1440, client: 1440 }, {
      title: "  页面  ",
      lang: "zh-CN",
      meta: { description: "  描述  ", viewport: "width=..." },
    });
    const seo = expectSeo(out);
    expect(seo.title).toBe("页面");
    expect(seo.description).toBe("描述");
    expect(seo.lang).toBe("zh-CN");
    expect(seo.viewportMeta).toBe(true);
    expect(seo.h1Count).toBe(2);
  });

  it("缺字段不抛：缺 description / viewport / lang 全是空串 / false", () => {
    const out = collect(el("body"), { scroll: 1440, client: 1440 });
    const seo = expectSeo(out);
    expect(seo.title).toBe("");
    expect(seo.description).toBe("");
    expect(seo.lang).toBe("");
    expect(seo.viewportMeta).toBe(false);
    expect(seo.h1Count).toBe(0);
  });

  it("h1Count 来自 body.querySelectorAll('h1')", () => {
    const body = el("body");
    link(body, [el("h1", { textContent: "A" }), el("h2", { textContent: "B" }), el("h1", { textContent: "C" })]);
    const out = collect(body, { scroll: 1440, client: 1440 });
    expect(expectSeo(out).h1Count).toBe(2);
  });
});
