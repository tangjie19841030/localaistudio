import { NAVIGATION_DEFS } from "./defs-navigation.js";
import { FORMS_DEFS } from "./defs-forms.js";
import { DATA_DEFS } from "./defs-data.js";
import { CHARTS_DEFS } from "./defs-charts.js";
import { FEEDBACK_DEFS } from "./defs-feedback.js";
import { MARKETING_DEFS } from "./defs-marketing.js";
import type { NewComponentDef } from "./defs-navigation.js";

/** New-category defs share the { meta, schema } shape; map through def(). */
function mapNew(newDefs: NewComponentDef[]): ComponentDef[] {
  return newDefs.map((d) => def(d.meta as Parameters<typeof def>[0], d.schema as never));
}


import { z } from "zod";
import { presetsFor, validatePresets, type ComponentPreset } from "./componentPresets.js";
import { SVG_SOURCE_MAX_LENGTH } from "./svgSubset.js";

export type ComponentCategory =
  | "layout"
  | "navigation"
  | "content"
  | "form"
  | "data"
  | "chart"
  | "feedback"
  | "marketing";

export type ContainerLayout = "stack-v" | "grid" | "row" | "shell";

/** Semantic token names — hex literals are forbidden in component props (spec §2). */
export const TONE_VALUES = ["brand", "neutral", "success", "warning", "danger"] as const;

export interface ComponentDef {
  /** Unique PascalCase type name, e.g. "AppShell". */
  type: string;
  /** Chinese display title. */
  title: string;
  category: ComponentCategory;
  /** Whether the node accepts children. */
  container: boolean;
  /** Layout semantics; containers only. */
  layout?: ContainerLayout;
  /** zod schema whose output is valid props. */
  propsSchema: z.ZodTypeAny;
  /** Equal to propsSchema.parse({}). */
  defaultProps: Record<string, unknown>;
  /** Top-level props required by the copied ui-kit component's TypeScript contract. */
  requiredProps: readonly string[];
  /** Named props snippets rendered as chips in the editor form (W4-B). */
  presets?: readonly ComponentPreset[];
}

const tone = () => z.enum(TONE_VALUES);

/**
 * The registry schema describes what the editor may omit by supplying defaults;
 * the copied ui-kit sources still expose a small set of required TypeScript
 * props. Keep that boundary explicit so codegen can materialize only the
 * required defaults instead of making every optional prop noisy in generated JSX.
 */
const REQUIRED_PROPS: Readonly<Record<string, readonly string[]>> = {
  AppShell: ["title", "sidebar"],
  Header: ["title"],
  Section: ["title"],
  Grid: ["columns", "gap"],
  Stack: ["gap"],
  Container: ["maxWidth"],
  MetricGrid: ["columns"],
  FormField: ["label"],
  Select: ["options"],
  Button: ["label"],
  Checkbox: ["label"],
  Badge: ["label"],
  Heading: ["text"],
  Text: ["content"],
  Image: ["src", "alt"],
  EmptyState: ["title"],
  StatCard: ["label", "value"],
};

/**
 * Defines a component from its zod object schema.
 * defaultProps is derived once via schema.parse({}) — defaults live only in the schema.
 */
function def(
  meta: { type: string; title: string; category: ComponentCategory; container?: boolean; layout?: ContainerLayout },
  propsSchema: z.ZodObject<z.ZodRawShape>,
): ComponentDef {
  return {
    type: meta.type,
    title: meta.title,
    category: meta.category,
    container: meta.container ?? false,
    ...(meta.container ? { layout: meta.layout ?? "stack-v" } : {}),
    propsSchema,
    defaultProps: propsSchema.parse({}),
    requiredProps: REQUIRED_PROPS[meta.type] ?? [],
  };
}

/**
 * Fixed declaration order — the canonical component list from the P1 plan.
 * listComponentDefs() returns this order; the InsertMenu groups by category in the same sequence.
 */
const defs: ComponentDef[] = [
  def(
    { type: "AppShell", title: "应用外壳", category: "layout", container: true, layout: "shell" },
    z.object({
      title: z.string().default("应用"),
      sidebar: z.boolean().default(false),
    }),
  ),
  def(
    { type: "Header", title: "页头", category: "layout" },
    z.object({
      title: z.string().default("页面标题"),
      subtitle: z.string().default(""),
    }),
  ),
  def(
    { type: "Nav", title: "导航", category: "layout", container: true, layout: "stack-v" },
    z.object({
      items: z
        .array(z.union([z.string(), z.object({ key: z.string().optional(), label: z.string().optional() })]))
        .default(["首页", "数据", "设置"]),
    }),
  ),
  def(
    { type: "Section", title: "区块", category: "layout", container: true, layout: "stack-v" },
    z.object({
      title: z.string().default("区块标题"),
      description: z.string().default(""),
    }),
  ),
  def(
    { type: "Grid", title: "栅格", category: "layout", container: true, layout: "grid" },
    z.object({
      columns: z.number().int().min(1).max(12).default(3),
      gap: z.number().min(0).max(32).default(4),
    }),
  ),
  def(
    { type: "Stack", title: "纵向堆叠", category: "layout", container: true, layout: "stack-v" },
    z.object({
      gap: z.number().min(0).max(32).default(4),
      align: z.enum(["start", "center", "end", "stretch"]).default("stretch"),
    }),
  ),
  def(
    { type: "Container", title: "容器", category: "layout", container: true, layout: "stack-v" },
    z.object({
      maxWidth: z.enum(["sm", "md", "lg", "xl", "full"]).default("lg"),
    }),
  ),
  def(
    { type: "Card", title: "卡片", category: "content", container: true, layout: "stack-v" },
    z.object({
      title: z.string().default("卡片"),
      padded: z.boolean().default(true),
    }),
  ),
  def(
    { type: "MetricGrid", title: "指标栅格", category: "data", container: true, layout: "grid" },
    z.object({
      columns: z.number().int().min(1).max(6).default(4),
    }),
  ),
  def(
    { type: "StatCard", title: "指标卡", category: "data" },
    z.object({
      label: z.string().default("指标"),
      value: z.string().default("0"),
      delta: z.string().default(""),
      tone: tone().default("brand"),
    }),
  ),
  def(
    { type: "Table", title: "表格", category: "data" },
    z.object({
      columns: z
        .array(
          z.union([
            z.string(),
            z.object({
              key: z.string().optional(),
              title: z.string().optional(),
              width: z.union([z.number(), z.string()]).optional(),
            }),
          ]),
        )
        .default(["名称", "数值", "状态"]),
      rows: z
        .array(
          z.union([
            z.array(z.union([z.string(), z.number()])),
            z.record(z.string(), z.unknown()),
          ]),
        )
        .default([["示例", "100", "正常"]]),
    }),
  ),
  def(
    { type: "Form", title: "表单", category: "form", container: true, layout: "stack-v" },
    z.object({
      title: z.string().default("表单"),
    }),
  ),
  def(
    { type: "FormField", title: "表单字段", category: "form", container: true, layout: "stack-v" },
    z.object({
      label: z.string().default("字段"),
      required: z.boolean().default(false),
      helpText: z.string().default(""),
    }),
  ),
  def(
    { type: "Input", title: "输入框", category: "form" },
    z.object({
      placeholder: z.string().default("请输入"),
      type: z.enum(["text", "password", "email", "number"]).default("text"),
    }),
  ),
  def(
    { type: "Select", title: "下拉选择", category: "form" },
    z.object({
      options: z.array(z.string()).default(["选项一", "选项二"]),
      placeholder: z.string().default("请选择"),
    }),
  ),
  def(
    { type: "Checkbox", title: "复选框", category: "form" },
    z.object({
      label: z.string().default("选项"),
      checked: z.boolean().default(false),
    }),
  ),
  def(
    { type: "Textarea", title: "多行输入", category: "form" },
    z.object({
      placeholder: z.string().default("请输入"),
      rows: z.number().int().min(2).max(12).default(3),
    }),
  ),
  def(
    { type: "Button", title: "按钮", category: "form" },
    z.object({
      label: z.string().default("按钮"),
      variant: z.enum(["primary", "secondary", "ghost", "danger"]).default("primary"),
      size: z.enum(["sm", "md", "lg"]).default("md"),
    }),
  ),
  def(
    { type: "Badge", title: "标签", category: "feedback" },
    z.object({
      label: z.string().default("标签"),
      tone: tone().default("neutral"),
    }),
  ),
  def(
    { type: "Heading", title: "标题", category: "content" },
    z.object({
      text: z.string().default("标题"),
      level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]).default(2),
    }),
  ),
  def(
    { type: "Text", title: "正文", category: "content" },
    z.object({
      content: z.string().default("正文"),
      muted: z.boolean().default(false),
    }),
  ),
  def(
    { type: "Image", title: "图片", category: "content" },
    z.object({
      // src is a resource URL, not a color — arbitrary string allowed (spec §2 note).
      src: z.string().min(0).default(""),
      alt: z.string().default("图片"),
    }),
  ),
  def(
    { type: "SvgBox", title: "矢量图形", category: "content" },
    z.object({
      // Inline SVG source. z.string().max() is the field-level guard (OP-5);
      // the controlled-subset check lives in checkStudioDocument (svgSubset.ts).
      source: z.string().max(SVG_SOURCE_MAX_LENGTH, "SVG 源码过长").default(""),
      alt: z.string().default(""),
    }),
  ),
  def(
    { type: "EmptyState", title: "空状态", category: "feedback" },
    z.object({
      title: z.string().default("暂无数据"),
      description: z.string().default(""),
    }),
  ),
];

// P6 后扩编：导航/图表/营销品类 + 表单/数据/反馈补齐（共 36 个新组件）。
defs.push(
  ...mapNew(NAVIGATION_DEFS),
  ...mapNew(FORMS_DEFS),
  ...mapNew(DATA_DEFS),
  ...mapNew(CHARTS_DEFS),
  ...mapNew(FEEDBACK_DEFS),
  ...mapNew(MARKETING_DEFS),
  // Divider / Accordion 属 layout 品类，单独注册
  def(
    { type: "Divider", title: "分隔线", category: "layout" },
    z.object({
      orientation: z.enum(["horizontal", "vertical"]).default("horizontal"),
      label: z.string().default(""),
    }),
  ),
  def(
    { type: "Accordion", title: "折叠面板", category: "layout", container: true, layout: "stack-v" },
    z.object({
      items: z
        .array(z.object({ title: z.string(), content: z.string() }))
        .default([
          { title: "如何开始？", content: "点击新建项目，填写需求即可。" },
          { title: "支持导出吗？", content: "支持导出完整 React 工程。" },
        ]),
      openIndex: z.number().min(-1).default(0),
    }),
  ),
);

/** type -> def. Key set equals the registered types; insertion order is the declaration order. */
export const componentRegistry: Record<string, ComponentDef> = Object.fromEntries(
  defs.map((d) => [d.type, { ...d, presets: presetsFor(d.type) }]),
);

// One-shot preset metadata validation (W4-B): a bad preset is a developer
// error and must fail fast at module load, before any consumer runs.
validatePresets(componentRegistry);

export function getComponentDef(type: string): ComponentDef | undefined {
  return componentRegistry[type];
}

export function hasComponent(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(componentRegistry, type);
}

/** All defs in fixed declaration order. */
export function listComponentDefs(): ComponentDef[] {
  return defs;
}

/** Exact top-level props accepted by a registered component. */
export function componentPropKeys(definition: Pick<ComponentDef, "propsSchema" | "defaultProps">): string[] {
  const shape = (definition.propsSchema as { shape?: Record<string, unknown> }).shape;
  return Object.keys(shape ?? definition.defaultProps);
}

/** Types whose nodes accept children. */
export const CONTAINER_TYPES: ReadonlySet<string> = new Set(
  defs.filter((d) => d.container).map((d) => d.type),
);
