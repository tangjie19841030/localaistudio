import { describe, expect, it } from "vitest";
import {
  CONTAINER_TYPES,
  componentRegistry,
  getComponentDef,
  hasComponent,
  listComponentDefs,
} from "../src/registry/index.js";
import { presetsFor, validatePresets, type ComponentPreset } from "../src/registry/index.js";

const ALL_TYPES = [
  "AppShell",
  "Header",
  "Nav",
  "Section",
  "Grid",
  "Stack",
  "Container",
  "Card",
  "MetricGrid",
  "StatCard",
  "Table",
  "Form",
  "FormField",
  "Input",
  "Select",
  "Checkbox",
  "Textarea",
  "Button",
  "Badge",
  "Heading",
  "Text",
  "Image",
  "SvgBox",
  "EmptyState",
  // P6 后扩编（Figma 标准覆盖度）：导航/布局/表单/数据/图表/反馈/营销
  "Tabs",
  "Breadcrumb",
  "Pagination",
  "Steps",
  "BottomNav",
  "Switch",
  "Radio",
  "SearchInput",
  "Slider",
  "InputNumber",
  "DatePicker",
  "Upload",
  "Avatar",
  "AvatarGroup",
  "List",
  "KeyValList",
  "Timeline",
  "CodeBlock",
  "Calendar",
  "BarChart",
  "LineChart",
  "DonutChart",
  "Sparkline",
  "Alert",
  "Progress",
  "ProgressRing",
  "Skeleton",
  "Toast",
  "Tooltip",
  "Hero",
  "FeatureGrid",
  "PricingCard",
  "Testimonial",
  "StatsBanner",
  "Footer",
  "Divider",
  "Accordion",
] as const;

// Plan says "22 components" but its enumerated list contains 23 types
// (spec §3: "初始约 22 个"); the explicit list wins.
// W5: +SvgBox（content 品类矢量旁路，无 kit 组件——渲染/codegen 走 schema-core
// 私有分支，见 svgSubset.ts）。
const EXPECTED_COUNT = 61;

const CONTAINER_EXPECTED = new Set<string>([
  "AppShell",
  "Nav",
  "Section",
  "Grid",
  "Stack",
  "Container",
  "Card",
  "MetricGrid",
  "Form",
  "FormField", "Accordion" ]);

describe("componentRegistry", () => {
  it("23 个 type 全部注册且无重复", () => {
    expect(Object.keys(componentRegistry).sort()).toEqual([...ALL_TYPES].sort());
    expect(new Set(Object.keys(componentRegistry)).size).toBe(EXPECTED_COUNT);
  });

  it("listComponentDefs 按固定声明顺序返回全部定义", () => {
    const defs = listComponentDefs();
    expect(defs.map((d) => d.type)).toEqual([...ALL_TYPES]);
    expect(defs).toHaveLength(EXPECTED_COUNT);
  });

  it("每个 def 的 defaultProps 通过自己的 propsSchema", () => {
    for (const def of listComponentDefs()) {
      const result = def.propsSchema.safeParse(def.defaultProps);
      expect(result.success, `${def.type} defaultProps 未通过自身 schema`).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(def.defaultProps);
      }
    }
  });

  it("每个 def 的 title 非空、container 为布尔、type 非空", () => {
    for (const def of listComponentDefs()) {
      expect(def.type.length, `${def.type}`).toBeGreaterThan(0);
      expect(def.title.length, `${def.type} title 为空`).toBeGreaterThan(0);
      expect(typeof def.container, `${def.type} container 非布尔`).toBe("boolean");
    }
  });

  it("container 布局语义：容器才有 layout，非容器没有", () => {
    for (const def of listComponentDefs()) {
      if (def.container) {
        expect(def.layout, `${def.type} 是容器但缺 layout`).toBeDefined();
      } else {
        expect(def.layout, `${def.type} 非容器不应有 layout`).toBeUndefined();
      }
    }
  });

  it("getComponentDef / hasComponent 查询", () => {
    const def = getComponentDef("AppShell");
    expect(def?.type).toBe("AppShell");
    expect(def?.title).toBe("应用外壳");
    expect(def?.container).toBe(true);
    expect(getComponentDef("Nope")).toBeUndefined();
    expect(hasComponent("Button")).toBe(true);
    expect(hasComponent("nope")).toBe(false);
  });

  it("CONTAINER_TYPES 与 def.container 一致", () => {
    expect(CONTAINER_TYPES.size).toBe(CONTAINER_EXPECTED.size);
    for (const def of listComponentDefs()) {
      expect(CONTAINER_TYPES.has(def.type)).toBe(def.container);
    }
    for (const type of CONTAINER_EXPECTED) {
      expect(CONTAINER_TYPES.has(type), `${type} 应为容器`).toBe(true);
    }
  });

  it("props 中不出现十六进制颜色字面量", () => {
    const hexRe = /#[0-9a-fA-F]{3,8}\b/;
    for (const def of listComponentDefs()) {
      const json = JSON.stringify(def.defaultProps);
      expect(hexRe.test(json), `${def.type} props 含十六进制颜色`).toBe(false);
    }
  });
});

describe("props 边界", () => {
  it("StatCard tone 非法值被拒", () => {
    const schema = getComponentDef("StatCard")!.propsSchema;
    expect(schema.safeParse({ ...getComponentDef("StatCard")!.defaultProps, tone: "pink" }).success).toBe(false);
  });

  it("Grid columns 13 被拒，1-12 接受", () => {
    const def = getComponentDef("Grid")!;
    for (const columns of [1, 12]) {
      expect(def.propsSchema.safeParse({ ...def.defaultProps, columns }).success).toBe(true);
    }
    expect(def.propsSchema.safeParse({ ...def.defaultProps, columns: 13 }).success).toBe(false);
    expect(def.propsSchema.safeParse({ ...def.defaultProps, columns: 0 }).success).toBe(false);
  });

  it("Heading level 7 被拒，1-6 接受", () => {
    const def = getComponentDef("Heading")!;
    for (const level of [1, 6]) {
      expect(def.propsSchema.safeParse({ ...def.defaultProps, level }).success).toBe(true);
    }
    expect(def.propsSchema.safeParse({ ...def.defaultProps, level: 7 }).success).toBe(false);
  });

  it("Textarea rows 2-12 接受，越界拒绝", () => {
    const def = getComponentDef("Textarea")!;
    expect(def.propsSchema.safeParse({ ...def.defaultProps, rows: 1 }).success).toBe(false);
    expect(def.propsSchema.safeParse({ ...def.defaultProps, rows: 12 }).success).toBe(true);
    expect(def.propsSchema.safeParse({ ...def.defaultProps, rows: 13 }).success).toBe(false);
  });

  it("Stack gap 0-32 与 align 枚举", () => {
    const def = getComponentDef("Stack")!;
    expect(def.propsSchema.safeParse({ ...def.defaultProps, gap: 33 }).success).toBe(false);
    expect(def.propsSchema.safeParse({ ...def.defaultProps, align: "left" }).success).toBe(false);
    expect(def.propsSchema.safeParse({ ...def.defaultProps, align: "center" }).success).toBe(true);
  });
});

describe("默认 props 快照（关键组件）", () => {
  it("AppShell / Table / Button 默认值符合约定", () => {
    expect(getComponentDef("AppShell")!.defaultProps).toEqual({ title: "应用", sidebar: false });
    expect(getComponentDef("Table")!.defaultProps).toEqual({
      columns: ["名称", "数值", "状态"],
      rows: [["示例", "100", "正常"]],
    });
    expect(getComponentDef("Button")!.defaultProps).toEqual({
      label: "按钮",
      variant: "primary",
      size: "md",
    });
  });

  it("Nav items 默认导航项", () => {
    expect(getComponentDef("Nav")!.defaultProps).toEqual({ items: ["首页", "数据", "设置"] });
  });

  it("Section / Container / StatCard 默认值", () => {
    expect(getComponentDef("Section")!.defaultProps).toEqual({
      title: "区块标题",
      description: "",
    });
    expect(getComponentDef("Container")!.defaultProps).toEqual({ maxWidth: "lg" });
    expect(getComponentDef("StatCard")!.defaultProps).toEqual({
      label: "指标",
      value: "0",
      delta: "",
      tone: "brand",
    });
  });
});

describe("componentPresets（W4-B 首批）", () => {
  it("presetsFor 返回首批数据（Button 4 / Badge 3 / Card 2），registry 组装挂载", () => {
    expect(presetsFor("Button").map((p) => p.id)).toEqual([
      "cta",
      "quiet",
      "destructive",
      "secondary-standard",
    ]);
    expect(presetsFor("Badge").map((p) => p.id)).toEqual(["positive", "warning-badge", "error"]);
    expect(presetsFor("Card").map((p) => p.id)).toEqual(["comfortable", "bare"]);
    expect(presetsFor("Button")).toEqual(getComponentDef("Button")!.presets);
    expect(presetsFor("Input")).toEqual([]);
    expect(getComponentDef("Input")!.presets).toEqual([]);
    expect(presetsFor("Nope")).toEqual([]);
  });

  it("每个预设 props 与 defaultProps 合并后过组件自身 schema", () => {
    for (const def of listComponentDefs()) {
      for (const preset of presetsFor(def.type)) {
        const result = def.propsSchema.safeParse({ ...def.defaultProps, ...preset.props });
        expect(result.success, `${def.type}.${preset.id} 预设值未通过组件 schema`).toBe(true);
      }
    }
  });

  it("validatePresets 对首批常量全过（模块加载期校验等价通过）", () => {
    expect(() => validatePresets(componentRegistry)).not.toThrow();
  });

  it("坏键 throw：props 键不是组件声明属性（副本注入，不污染常量）", () => {
    const bad: Record<string, ComponentPreset[]> = {
      Button: [{ id: "bad", name: "坏", props: { variant: "primary", nope: 1 } }],
    };
    expect(() => validatePresets(componentRegistry, bad)).toThrow(/nope/);
  });

  it("坏值 throw：值未过字段 schema；常量不被污染", () => {
    const bad: Record<string, ComponentPreset[]> = {
      Button: [{ id: "bad", name: "坏", props: { variant: "pink" } }],
      Nope: [{ id: "x", name: "x", props: {} }],
    };
    expect(() => validatePresets(componentRegistry, bad)).toThrow(/variant 值未通过|未注册/);
    expect(() => validatePresets(componentRegistry)).not.toThrow();
  });
});
