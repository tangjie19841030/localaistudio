import { describe, expect, it } from "vitest";
import { checkStudioDocument, tokensSchema, validateDocument } from "../src/document.js";
import { getComponentDef } from "../src/registry/componentDefs.js";
import { TEMPLATES, templateById } from "../src/templates/index.js";
import { TOKEN_PRESETS, presetById } from "../src/templates/tokenPresets.js";

describe("模板库：注册表", () => {
  it("含 20 个模板：14 个单页 + 6 个多页组合（W1-C）", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([
      "dashboard","analytics","list-detail","form","settings","profile","messages",
      "login","onboarding","landing","pricing","blog","ecommerce","calendar",
      "saas-site","blog-site","shop-flow","account-center","ops-dashboard","auth-flow",
    ]);
  });

  it("每个模板有中文名与描述", () => {
    for (const t of TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("templateById 命中与未知 id 返回 undefined", () => {
    expect(templateById("dashboard")?.id).toBe("dashboard");
    expect(templateById("nope")).toBeUndefined();
  });
});

describe.each(TEMPLATES.map((t) => [t.id, t] as const))("模板 build：%s", (_id, template) => {
  const doc = template.build("我的项目");

  it("产物通过 validateDocument", () => {
    expect(() => validateDocument(doc)).not.toThrow();
  });

  it("通过引用完整性检查（节点 id 唯一、rootId 存在、子引用有效）", () => {
    expect(checkStudioDocument(validateDocument(doc))).toEqual([]);
  });

  it("节点 id 唯一", () => {
    const ids = doc.pages[0]!.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rootId 在节点表中", () => {
    expect(doc.pages[0]!.nodes.some((n) => n.id === doc.pages[0]!.rootId)).toBe(true);
  });

  it("使用传入的文档名", () => {
    expect(doc.name).toBe("我的项目");
  });

  it("所有节点类型都在组件注册表中，且 props 通过该类型的 schema", () => {
    for (const node of doc.pages[0]!.nodes) {
      const def = getComponentDef(node.type);
      expect(def, `未注册的组件类型 ${node.type}`).toBeDefined();
      expect(def!.propsSchema.safeParse(node.props).success, `${node.id} props 不合法`).toBe(true);
    }
  });

  it("非容器节点没有子节点", () => {
    for (const node of doc.pages[0]!.nodes) {
      if (!getComponentDef(node.type)!.container) {
        expect(node.children, `${node.id} 不应有子节点`).toEqual([]);
      }
    }
  });

  it("props 中不含十六进制颜色字面量（token 纪律）", () => {
    expect(JSON.stringify(doc.pages[0]!.nodes)).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("tokens 通过校验", () => {
    expect(() => tokensSchema.parse(doc.tokens)).not.toThrow();
  });

  it("纯函数：同名两次 build 结果深度相等（无随机 id）", () => {
    expect(template.build("我的项目")).toEqual(doc);
  });
});

// W1-C 多页组合模板：在单页 describe.each 之外补页数、跨页唯一性与真实文案断言。
const MULTI_PAGE_IDS = [
  "saas-site",
  "blog-site",
  "shop-flow",
  "account-center",
  "ops-dashboard",
  "auth-flow",
] as const;

describe("多页组合模板（W1-C）", () => {
  it("恰好 6 个多页组合模板且都已注册", () => {
    expect(MULTI_PAGE_IDS).toHaveLength(6);
    for (const id of MULTI_PAGE_IDS) {
      expect(templateById(id), id).toBeDefined();
    }
  });

  it("全部 20 个模板的 id 与中文名互不重复", () => {
    const ids = TEMPLATES.map((t) => t.id);
    const names = TEMPLATES.map((t) => t.name);
    expect(TEMPLATES).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(new Set(names).size).toBe(20);
  });

  it.each(MULTI_PAGE_IDS)("%s：页数 ≥ 2 且整份文档过 checkStudioDocument", (id) => {
    const doc = templateById(id)!.build("我的项目");
    expect(doc.pages.length).toBeGreaterThanOrEqual(2);
    expect(checkStudioDocument(validateDocument(doc))).toEqual([]);
  });

  it.each(MULTI_PAGE_IDS)("%s：页 id 与页名各自不重复", (id) => {
    const doc = templateById(id)!.build("我的项目");
    const pageIds = doc.pages.map((p) => p.id);
    const pageNames = doc.pages.map((p) => p.name);
    expect(new Set(pageIds).size).toBe(pageIds.length);
    expect(new Set(pageNames).size).toBe(pageNames.length);
  });

  it.each(MULTI_PAGE_IDS)("%s：每一页的节点类型已注册且 props 合法", (id) => {
    const doc = validateDocument(templateById(id)!.build("我的项目"));
    for (const page of doc.pages) {
      for (const n of page.nodes) {
        const def = getComponentDef(n.type);
        expect(def, `未注册的组件类型 ${n.type}`).toBeDefined();
        expect(def!.propsSchema.safeParse(n.props).success, `${page.id}/${n.id} props 不合法`).toBe(true);
      }
    }
  });

  it.each(MULTI_PAGE_IDS)("%s：跨页节点 id 无重复", (id) => {
    const doc = templateById(id)!.build("我的项目");
    const ids = doc.pages.flatMap((p) => p.nodes.map((n) => n.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(MULTI_PAGE_IDS)("%s：页面文案为真实内容（无占位符）", (id) => {
    const doc = templateById(id)!.build("我的项目");
    expect(JSON.stringify(doc)).not.toMatch(/lorem|ipsum|占位|待补充|TODO/);
  });
});

describe("token 预设", () => {
  it("提供 4 组预设，id 唯一", () => {
    expect(TOKEN_PRESETS).toHaveLength(4);
    const ids = TOKEN_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toContain("default");
  });

  it("每组预设 tokens 通过 zod 校验", () => {
    for (const preset of TOKEN_PRESETS) {
      expect(() => tokensSchema.parse(preset.tokens), preset.id).not.toThrow();
      expect(preset.name.length).toBeGreaterThan(0);
    }
  });

  it("presetById 命中与未知 id 返回 undefined", () => {
    expect(presetById("default")?.id).toBe("default");
    expect(presetById("nope")).toBeUndefined();
  });

  it("预设之间品牌色不同（预设有实际差异）", () => {
    const brands = TOKEN_PRESETS.map((p) => p.tokens.color.brand);
    expect(new Set(brands).size).toBe(4);
  });
});

