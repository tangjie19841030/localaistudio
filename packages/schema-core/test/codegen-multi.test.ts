import { describe, expect, it } from "vitest";
import {
  DOCUMENT_VERSION,
  defaultStudioDocument,
  defaultTokens,
  type NodeRecord,
  type Page,
  type StudioDocument,
} from "../src/document.js";
import { generateFiles } from "../src/codegen/generateFiles.js";
import { downgradeToV1, migrateV1ToV2 } from "../src/migrate.js";
import { minimalKit } from "./codegen-fixtures.js";

/**
 * F7 multi-page codegen behavior lock (p0-batch1 §3.1, T19 §3.5/§5-F7).
 *
 * Pure black-box assertions over the generateFiles output Map<string,string> —
 * no peeking at internal helpers. Route/nav emission is already locked by
 * codegen-nav.test.ts and is NOT repeated here.
 */

/** Page whose root is a Container holding rootChildren, plus extra nodes. */
function pageWith(id: string, name: string, rootChildren: string[], extra: NodeRecord[]): Page {
  return {
    id,
    name,
    rootId: `${id}-root`,
    nodes: [{ id: `${id}-root`, type: "Container", props: {}, children: rootChildren }, ...extra],
  };
}

function docOf(pages: Page[], name = "多页演示"): StudioDocument {
  return { documentVersion: DOCUMENT_VERSION, name, tokens: defaultTokens(), pages };
}

function btn(id: string, label: string): NodeRecord {
  return { id, type: "Button", props: { label }, children: [] };
}

function sectionNode(id: string, title: string, childId: string): NodeRecord {
  return { id, type: "Section", props: { title, description: "" }, children: [childId] };
}

describe("F7 多页 codegen 行为锁（T19 §3.5/§5-F7 补测）", () => {
  it("两页不同名 -> src/pages/ 两份页文件，组件名各自正确", () => {
    const doc = docOf([
      pageWith("page-1", "首页", ["b1"], [btn("b1", "首页按钮")]),
      pageWith("page-2", "关于", ["b2"], [btn("b2", "关于按钮")]),
    ]);
    const files = generateFiles(doc, minimalKit("Container", "Button"));
    expect(files.has("src/pages/首页.tsx")).toBe(true);
    expect(files.has("src/pages/关于.tsx")).toBe(true);
    expect(files.get("src/pages/首页.tsx")).toContain("export default function 首页()");
    expect(files.get("src/pages/首页.tsx")).toContain('label="首页按钮"');
    expect(files.get("src/pages/关于.tsx")).toContain("export default function 关于()");
    expect(files.get("src/pages/关于.tsx")).toContain('label="关于按钮"');
  });

  it("kit 跨页并集：页甲用 Button、页乙用 Stack -> kit 拷贝单份，两页 import 同一路径", () => {
    const doc = docOf([
      pageWith("page-1", "页甲", ["b1"], [btn("b1", "甲")]),
      pageWith("page-2", "页乙", ["s1"], [{ id: "s1", type: "Stack", props: {}, children: [] }]),
    ]);
    const files = generateFiles(doc, minimalKit("Container", "Button", "Stack"));
    // Exactly one copy per used kit component (union across pages), no extras.
    const kitFiles = [...files.keys()]
      .filter((k) => k.startsWith("src/components/ui-studio/") && k.endsWith(".tsx"))
      .sort();
    expect(kitFiles).toEqual([
      "src/components/ui-studio/Button.tsx",
      "src/components/ui-studio/Container.tsx",
      "src/components/ui-studio/Stack.tsx",
    ]);
    const barrel = files.get("src/components/ui-studio/index.ts")!;
    expect(barrel).toContain('export { default as Button } from "./Button";');
    expect(barrel).toContain('export { default as Stack } from "./Stack";');
    // Each page imports only the kit types it uses; the barrel path is shared.
    const a = files.get("src/pages/页甲.tsx")!;
    const b = files.get("src/pages/页乙.tsx")!;
    const aImport = a.split("\n").find((l) => l.startsWith("import {") && l.includes("../components/ui-studio"))!;
    const bImport = b.split("\n").find((l) => l.startsWith("import {") && l.includes("../components/ui-studio"))!;
    expect(aImport).toContain("Button");
    expect(aImport).not.toContain("Stack");
    expect(bImport).toContain("Stack");
    expect(bImport).not.toContain("Button");
    expect(bImport.match(/from "(.+)"/)?.[1]).toBe(aImport.match(/from "(.+)"/)?.[1]);
  });

  it("页名重复 -> 列表2 后缀去重，文件不互相覆盖", () => {
    const doc = docOf([
      pageWith("page-1", "列表", ["b1"], [btn("b1", "第一份")]),
      pageWith("page-2", "列表", ["b2"], [btn("b2", "第二份")]),
    ]);
    const files = generateFiles(doc, minimalKit("Container", "Button"));
    expect(files.has("src/pages/列表.tsx")).toBe(true);
    expect(files.has("src/pages/列表2.tsx")).toBe(true);
    expect(files.get("src/pages/列表.tsx")).toContain("export default function 列表()");
    expect(files.get("src/pages/列表.tsx")).toContain('label="第一份"');
    expect(files.get("src/pages/列表2.tsx")).toContain("export default function 列表2()");
    expect(files.get("src/pages/列表2.tsx")).toContain('label="第二份"');
  });

  it("多页含 Section 提取：页内 Section 各自产文件，组件名跨页不冲突", () => {
    const doc = docOf([
      pageWith("page-1", "页甲", ["sa"], [sectionNode("sa", "亮点", "ba"), btn("ba", "甲区按钮")]),
      pageWith("page-2", "页乙", ["sb"], [sectionNode("sb", "亮点", "bb"), btn("bb", "乙区按钮")]),
    ]);
    const files = generateFiles(doc, minimalKit("Container", "Section", "Button"));
    // Same title on both pages -> globally deduped component names (亮点 / 亮点2),
    // so the two generated files never overwrite each other.
    expect(files.has("src/components/generated/亮点.tsx")).toBe(true);
    expect(files.has("src/components/generated/亮点2.tsx")).toBe(true);
    expect(files.get("src/components/generated/亮点.tsx")).toContain('label="甲区按钮"');
    expect(files.get("src/components/generated/亮点2.tsx")).toContain('label="乙区按钮"');
    // Each page file imports its own section component.
    expect(files.get("src/pages/页甲.tsx")).toContain('import { 亮点 } from "../components/generated/亮点";');
    expect(files.get("src/pages/页乙.tsx")).toContain('import { 亮点2 } from "../components/generated/亮点2";');
  });

  it("迁移档字节一致复跑：migrateV1ToV2(单页 v1) 与 native v2 的 generateFiles 输出逐字节一致", () => {
    const native = defaultStudioDocument("字节一致");
    native.pages[0]!.nodes[0]!.children = ["btn-1"];
    native.pages[0]!.nodes.push({
      id: "btn-1",
      type: "Button",
      props: { label: "点", variant: "primary", size: "md" },
      children: [],
    });
    const migrated = migrateV1ToV2(downgradeToV1(native)!);
    const a = generateFiles(native, minimalKit("Container", "Button"));
    const b = generateFiles(migrated, minimalKit("Container", "Button"));
    // A2's codegen-side mirror: insertion order + bytes must match exactly.
    expect(JSON.stringify([...b])).toBe(JSON.stringify([...a]));
  });
});
