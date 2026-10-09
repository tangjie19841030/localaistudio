import { describe, expect, it } from "vitest";
import {
  checkPage,
  checkStudioDocument,
  defaultPage,
  defaultStudioDocument,
  defaultTokens,
  DOCUMENT_VERSION,
  pageSchema,
  studioDocumentSchema,
  validateDocument,
  type Page,
  type StudioDocument,
} from "../src/document.js";
import { docFormat, downgradeToV1, migrateV1ToV2 } from "../src/migrate.js";

/** v1 legacy raw fixture (the old pageDocumentSchema output shape). */
function v1Doc(name: string) {
  return {
    documentVersion: 1,
    name,
    tokens: defaultTokens(),
    rootId: "root",
    nodes: [{ id: "root", type: "Container", props: {}, children: [] }],
  };
}

/** Wrap a page fixture into a minimal single-page StudioDocument. */
function docOf(page: Page, name = "x"): StudioDocument {
  return { documentVersion: DOCUMENT_VERSION, name, tokens: defaultTokens(), pages: [page] };
}

describe("StudioDocument（v2）", () => {
  it("defaultStudioDocument 生成单页 v2 文档", () => {
    const doc = defaultStudioDocument("运营工作台");
    expect(validateDocument(doc)).toEqual(doc);
    expect(doc.documentVersion).toBe(2);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]!.rootId).toBe("root");
    expect(doc.pages[0]!.nodes).toHaveLength(1);
    expect(checkStudioDocument(doc)).toEqual([]);
  });

  it("defaultTokens 提供全部固定 token 路径", () => {
    const tokens = defaultTokens();
    expect(Object.keys(tokens.color).sort()).toEqual(
      ["accent", "border", "brand", "danger", "muted", "success", "surface", "text", "warning"],
    );
  });

  it("validateDocument 拒绝坏十六进制颜色", () => {
    const doc = defaultStudioDocument("x");
    doc.tokens.color.brand = "teal";
    expect(() => validateDocument(doc)).toThrow();
  });

  it("validateDocument 拒绝空页表与错误版本号", () => {
    const doc = defaultStudioDocument("x");
    expect(() => validateDocument({ ...doc, pages: [] })).toThrow();
    expect(() => validateDocument({ ...doc, documentVersion: 1 })).toThrow();
  });

  it("checkPage 捕获缺失 rootId、悬空子引用与重复 ID", () => {
    const page = defaultPage("x");
    page.rootId = "missing";
    expect(checkPage(page)).toEqual(['rootId "missing" 不在节点表中']);

    const page2 = defaultPage("x");
    page2.nodes[0]!.children = ["ghost"];
    expect(checkPage(page2)).toEqual(['节点 "root" 引用了不存在的子节点 "ghost"']);

    const page3 = defaultPage("x");
    page3.nodes.push({ ...page3.nodes[0]!, id: "root" });
    expect(checkPage(page3)).toEqual(["存在重复的节点 ID"]);
  });

  it("checkStudioDocument 捕获重复页 ID 与跨页重复节点 ID", () => {
    const doc = defaultStudioDocument("x");
    doc.pages.push({ ...defaultPage("第二页", "p_2"), id: "page-1" });
    expect(checkStudioDocument(doc)).toContain('存在重复的页 ID "page-1"');

    const doc2 = defaultStudioDocument("x");
    doc2.pages.push({
      id: "p_2",
      name: "第二页",
      rootId: "root",
      nodes: [{ id: "root", type: "Container", props: {}, children: [] }],
    });
    expect(checkStudioDocument(doc2).some((e) => e.includes('节点 ID "root" 跨页重复'))).toBe(true);
  });

  it("页名 80 上限在形状层被拒绝", () => {
    const page = defaultPage("x");
    page.name = "a".repeat(81);
    expect(pageSchema.safeParse(page).success).toBe(false);
  });
});

describe("Schema 契约边界（Task 2 审查采纳）", () => {
  const base = () => defaultStudioDocument("x");

  it("radius 0/64 接受，-1/65 拒绝", () => {
    for (const card of [0, 64]) {
      const doc = base();
      doc.tokens.radius.card = card;
      expect(validateDocument(doc)).toBeTruthy();
    }
    for (const card of [-1, 65]) {
      const doc = base();
      doc.tokens.radius.card = card;
      expect(() => validateDocument(doc)).toThrow();
    }
  });

  it("spacing.unit 1/24 接受，0/25 拒绝", () => {
    for (const unit of [1, 24]) {
      const doc = base();
      doc.tokens.spacing.unit = unit;
      expect(validateDocument(doc)).toBeTruthy();
    }
    for (const unit of [0, 25]) {
      const doc = base();
      doc.tokens.spacing.unit = unit;
      expect(() => validateDocument(doc)).toThrow();
    }
  });

  it("name 空串与 81 字符拒绝", () => {
    const doc1 = base();
    doc1.name = "";
    expect(() => validateDocument(doc1)).toThrow();
    const doc2 = base();
    doc2.name = "a".repeat(81);
    expect(() => validateDocument(doc2)).toThrow();
  });

  it("解析缺失 props/children 的节点时填充默认值", () => {
    const parsed = validateDocument({
      documentVersion: 2,
      name: "x",
      tokens: defaultTokens(),
      pages: [{ id: "page-1", name: "首页", rootId: "r", nodes: [{ id: "r", type: "T" }] }],
    });
    expect(parsed.pages[0]!.nodes[0]!.props).toEqual({});
    expect(parsed.pages[0]!.nodes[0]!.children).toEqual([]);
  });

  it("radius/spacing/font token 键集完整", () => {
    const tokens = defaultTokens();
    expect(Object.keys(tokens.radius).sort()).toEqual(["card", "control"]);
    expect(Object.keys(tokens.spacing)).toEqual(["unit"]);
    expect(Object.keys(tokens.font)).toEqual(["sans"]);
  });

  it("checkPage 多错误按固定顺序返回", () => {
    const page = defaultPage("x");
    page.rootId = "missing";
    page.nodes[0]!.children = ["ghost"];
    expect(checkPage(page)).toEqual([
      'rootId "missing" 不在节点表中',
      '节点 "root" 引用了不存在的子节点 "ghost"',
    ]);
  });

  it("children 中的空字符串 ID 在形状层被拒绝", () => {
    const doc = base();
    doc.pages[0]!.nodes[0]!.children = [""];
    const result = studioDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });
});

describe("frame 字段（P5 自由画布）", () => {
  const framePage = () => {
    const page = defaultPage("带画布");
    page.nodes.push({
      id: "n1",
      type: "Card",
      props: {},
      children: [],
      frame: { x: -40, y: 120.5, w: 320, h: 160, rotation: 30 },
    });
    page.nodes[0]!.children.push("n1");
    return page;
  };

  it("旧页（无 frame）照常解析，不注入默认 frame", () => {
    const page = defaultPage("旧文档");
    expect(page.nodes[0]!.frame).toBeUndefined();
    const parsed = validateDocument(docOf(page, "旧文档"));
    expect(parsed.documentVersion).toBe(2);
    expect(parsed.pages[0]!.nodes[0]!.frame).toBeUndefined();
    expect(checkStudioDocument(parsed)).toEqual([]);
  });

  it("带 frame 的页解析成功且值保持不变（含负坐标）", () => {
    const parsed = validateDocument(docOf(framePage(), "带画布"));
    expect(parsed.pages[0]!.nodes[1]!.frame).toEqual({ x: -40, y: 120.5, w: 320, h: 160, rotation: 30 });
    expect(checkPage(parsed.pages[0]!)).toEqual([]);
  });

  it("frame 缺 rotation 时解析注入默认 0", () => {
    const parsed = validateDocument({
      documentVersion: 2,
      name: "默认旋转",
      tokens: defaultTokens(),
      pages: [
        { id: "page-1", name: "首页", rootId: "r", nodes: [{ id: "r", type: "T", frame: { x: 0, y: 0, w: 10, h: 10 } }] },
      ],
    });
    expect(parsed.pages[0]!.nodes[0]!.frame).toEqual({ x: 0, y: 0, w: 10, h: 10, rotation: 0 });
  });

  it("frame w:0 在形状层被拒绝", () => {
    const page = framePage();
    page.nodes[1]!.frame = { x: 0, y: 0, w: 0, h: 10, rotation: 0 };
    expect(pageSchema.safeParse(page).success).toBe(false);
  });

  it("frame 越界 rotation 361 被拒绝；x/y 负值被接受", () => {
    const page = framePage();
    page.nodes[1]!.frame = { x: -1, y: -2, w: 10, h: 10, rotation: 361 };
    expect(pageSchema.safeParse(page).success).toBe(false);

    const page2 = framePage();
    page2.nodes[1]!.frame = { x: -1, y: -2, w: 10, h: 10, rotation: 360 };
    expect(pageSchema.safeParse(page2).success).toBe(true);
  });

  it("无 frame 与有 frame 的节点可在同一页混用", () => {
    const page = framePage(); // root 无 frame，n1 有 frame
    const parsed = validateDocument(docOf(page, "混用"));
    expect(parsed.pages[0]!.nodes[0]!.frame).toBeUndefined();
    expect(parsed.pages[0]!.nodes[1]!.frame).toBeDefined();
    expect(checkPage(parsed.pages[0]!)).toEqual([]);
  });
});

describe("action 字段（W3-A 页面跳转）", () => {
  const navDoc = () => {
    const home = defaultPage("首页");
    home.nodes.push({ id: "btn", type: "Button", props: {}, children: [], action: { type: "navigate", pageId: "p_2" } });
    home.nodes[0]!.children.push("btn");
    const second: Page = {
      id: "p_2",
      name: "第二页",
      rootId: "root-2",
      nodes: [{ id: "root-2", type: "Container", props: {}, children: [] }],
    };
    return { documentVersion: DOCUMENT_VERSION, name: "nav", tokens: defaultTokens(), pages: [home, second] } as StudioDocument;
  };

  it("合法 action 经 parse 保留，跨页目标校验通过", () => {
    const parsed = validateDocument(navDoc());
    expect(parsed.pages[0]!.nodes[1]!.action).toEqual({ type: "navigate", pageId: "p_2" });
    expect(checkStudioDocument(parsed)).toEqual([]);
  });

  it("悬空 pageId 被 checkStudioDocument 报错", () => {
    const doc = navDoc();
    doc.pages[0]!.nodes[1]!.action = { type: "navigate", pageId: "p_ghost" };
    expect(checkStudioDocument(doc)).toEqual(['节点 "btn" 的 action 指向不存在的页 "p_ghost"']);
  });

  it("自页跳转合法（指向自身页 id）", () => {
    const doc = navDoc();
    doc.pages[0]!.nodes[1]!.action = { type: "navigate", pageId: "page-1" };
    expect(checkStudioDocument(doc)).toEqual([]);
  });

  it("strip 语义：旧文档无 action 时 parse 不注入该字段", () => {
    const parsed = validateDocument(docOf(defaultPage("旧文档"), "旧文档"));
    expect(parsed.pages[0]!.nodes[0]!.action).toBeUndefined();
    expect("action" in parsed.pages[0]!.nodes[0]!).toBe(false);
    expect(checkStudioDocument(parsed)).toEqual([]);
  });

  it("action 形状非法（未知 type / 空 pageId）在形状层被拒绝", () => {
    const page = defaultPage("x");
    page.nodes.push({ id: "b", type: "Button", props: {}, children: [], action: { type: "jump", pageId: "p_2" } as never });
    expect(pageSchema.safeParse(page).success).toBe(false);
    const page2 = defaultPage("x");
    page2.nodes.push({ id: "b", type: "Button", props: {}, children: [], action: { type: "navigate", pageId: "" } });
    expect(pageSchema.safeParse(page2).success).toBe(false);
  });
});

describe("T19 A 组：v1→v2 迁移", () => {
  it("A1 v1→v2 字段全量落点（§3.1 表逐项）", () => {
    const v1 = v1Doc("运营工作台");
    const doc = migrateV1ToV2(v1);
    expect(doc.documentVersion).toBe(2); // version literal
    expect(doc.name).toBe("运营工作台"); // name hoisted
    expect(doc.tokens).toEqual(v1.tokens); // tokens hoisted verbatim
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]!.id).toBe("page-1"); // fixed page id
    expect(doc.pages[0]!.name).toBe("运营工作台"); // page name mirrors doc name
    expect(doc.pages[0]!.rootId).toBe("root");
    expect(doc.pages[0]!.nodes).toEqual(v1.nodes); // nodes untouched
  });

  it("A2 幂等：跑两遍与一遍输出 JSON 逐字节一致", () => {
    const v1 = v1Doc("幂等档");
    const once = validateDocument(v1);
    const twice = validateDocument(JSON.parse(JSON.stringify(once)));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("A3 v2 输入经 validateDocument 直通不变形", () => {
    const v2 = defaultStudioDocument("直通");
    const parsed = validateDocument(JSON.parse(JSON.stringify(v2)));
    expect(parsed).toEqual(v2);
  });

  it("A4 docFormat 三分类", () => {
    expect(docFormat(v1Doc("x"))).toBe("v1");
    expect(docFormat(defaultStudioDocument("x"))).toBe("v2");
    expect(docFormat({ documentVersion: 3, name: "x" })).toBe("unknown");
    expect(docFormat(null)).toBe("unknown");
    expect(docFormat("text")).toBe("unknown");
  });

  it("A5 downgradeToV1：单页可逆且往返无损；多页返回 null", () => {
    const v1 = v1Doc("回滚档");
    const doc = migrateV1ToV2(v1);
    const folded = downgradeToV1(doc);
    expect(folded).not.toBeNull();
    expect(folded).toEqual(v1);
    // multi-page: never silently truncated
    const multi = defaultStudioDocument("多页");
    multi.pages.push(defaultPage("第二页", "p_2"));
    expect(downgradeToV1(multi)).toBeNull();
  });

  it("A6 缺 documentVersion 但 v1 形状 → validateDocument 升维", () => {
    const raw = v1Doc("缺版本");
    const { documentVersion: _dropped, ...legacy } = raw;
    const doc = validateDocument(legacy);
    expect(doc.documentVersion).toBe(2);
    expect(doc.pages[0]!.id).toBe("page-1");
  });

  it("A7 未知版本 → 抛错不猜测", () => {
    expect(() => validateDocument({ documentVersion: 3, name: "x" })).toThrow();
    expect(() => validateDocument(v1Doc("v1ok"))).not.toThrow(); // v1 ok
  });

  it("A8 validateDocument 对 v1/v2 双形输出恒 v2（C3）", () => {
    expect(validateDocument(v1Doc("v1")).documentVersion).toBe(2);
    expect(validateDocument(defaultStudioDocument("v2")).documentVersion).toBe(2);
  });
});
