import { render } from "@testing-library/react";
import { defaultTokens } from "@studio/schema-core";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { kitComponents } from "../src/index";

/**
 * studioId contract: codegen injects studioId="<schema node id>" on every
 * emitted element; the kit renders it as data-studio-id on the component root.
 * The visual audit reads closest("[data-studio-id]") to map a DOM issue back to
 * the Schema node, so a missing attribute on any root silently breaks repair
 * scoping — hence a table over the full component set rather than a sample.
 */
type Case = { type: string; render: (studioId?: string) => ReactElement };

const el = (type: string, props: Record<string, unknown>) =>
  ({ type, render: (studioId?: string) => {
    const Comp = kitComponents[type]!;
    return <Comp {...props} studioId={studioId} />;
  } }) satisfies Case;

const CASES: Case[] = [
  el("AppShell", { tokens: defaultTokens(), title: "壳", sidebar: true }),
  el("Header", { title: "标题" }),
  el("Nav", { items: ["首页"] }),
  el("Section", { title: "区块" }),
  el("Grid", { columns: 2, gap: 2 }),
  el("Stack", { gap: 2 }),
  el("Container", { maxWidth: "md" }),
  el("Card", { title: "卡片" }),
  el("MetricGrid", { columns: 2 }),
  el("StatCard", { label: "标签", value: "1" }),
  el("Table", { columns: ["A"], rows: [["1"]] }),
  el("Form", { title: "表单" }),
  el("FormField", { label: "字段" }),
  el("Input", {}),
  el("Select", { options: ["A"] }),
  el("Checkbox", { label: "勾选" }),
  el("Textarea", {}),
  el("Button", { label: "按钮" }),
  el("Badge", { label: "徽标" }),
  el("Heading", { text: "标题" }),
  el("Text", { content: "正文" }),
  el("Image", { src: "https://example.test/a.png", alt: "图" }),
  el("EmptyState", { title: "空" }),
  el("Tabs", { items: ["标签"] }),
  el("Breadcrumb", { items: ["首页"] }),
  el("Pagination", {}),
  el("Steps", { items: ["提交"] }),
  el("BottomNav", { items: ["首页"] }),
  el("Divider", {}),
  el("Accordion", { items: [{ title: "问", content: "答" }] }),
  el("Switch", { label: "开关" }),
  el("Radio", { items: ["选项"] }),
  el("SearchInput", { placeholder: "搜" }),
  el("Slider", {}),
  el("InputNumber", {}),
  el("DatePicker", { value: "2026-09-10" }),
  el("Upload", { hint: "上传" }),
  el("Avatar", { name: "张三" }),
  el("AvatarGroup", { names: ["张三"] }),
  el("List", { items: [{ title: "项" }] }),
  el("KeyValList", { items: [{ key: "K", value: "V" }] }),
  el("Timeline", { items: [{ title: "T" }] }),
  el("CodeBlock", { code: "x" }),
  el("Calendar", {}),
  el("BarChart", { data: [{ label: "A", value: 1 }] }),
  el("LineChart", { data: [{ label: "A", value: 1 }] }),
  el("DonutChart", { data: [{ label: "A", value: 1 }] }),
  el("Sparkline", { values: [1, 2] }),
  el("Alert", { title: "提示" }),
  el("Progress", {}),
  el("ProgressRing", {}),
  el("Skeleton", {}),
  el("Toast", { text: "已保存" }),
  el("Tooltip", {}),
  el("Hero", { title: "首屏" }),
  el("FeatureGrid", { features: [{ title: "T", description: "D" }] }),
  el("PricingCard", { plan: "专业版" }),
  el("Testimonial", { quote: "引用" }),
  el("StatsBanner", { stats: [{ label: "L", value: "V" }] }),
  el("Footer", { columns: [{ title: "T", links: ["L"] }] }),
];

function rootOf(node: ReactElement): HTMLElement {
  const { container } = render(node);
  return container.firstElementChild as HTMLElement;
}

describe("studioId -> data-studio-id（视觉问题回溯 Schema 节点）", () => {
  it("表格覆盖全部 58 个组件，无遗漏", () => {
    expect(CASES).toHaveLength(Object.keys(kitComponents).length);
    expect(CASES.map((c) => c.type).sort()).toEqual(Object.keys(kitComponents).sort());
  });

  it.each(CASES.map((c) => [c.type, c] as const))(
    "%s：传 studioId 时根元素带 data-studio-id",
    (type, c) => {
      const root = rootOf(c.render("n1"));
      expect(root.getAttribute("data-studio-id")).toBe("n1");
      // 与 data-component 同在根元素上：审计只需读一个祖先即可拿到两者
      expect(root.getAttribute("data-component")).toBe(type);
    },
  );

  it.each(CASES.map((c) => [c.type, c] as const))(
    "%s：不传 studioId 时根元素完全没有该属性",
    (_type, c) => {
      const root = rootOf(c.render(undefined));
      expect(root.hasAttribute("data-studio-id")).toBe(false);
      expect(root.outerHTML).not.toContain("data-studio-id");
    },
  );

  it("Image 的占位分支（src 为空）同样带 data-studio-id", () => {
    const Image = kitComponents["Image"]!;
    const root = rootOf(<Image src="" alt="占位" studioId="img-1" />);
    expect(root.tagName).toBe("DIV");
    expect(root.getAttribute("data-studio-id")).toBe("img-1");
  });

  it("嵌套时 closest 命中最近祖先（审计的映射方式）", () => {
    const Section = kitComponents["Section"]!;
    const Button = kitComponents["Button"]!;
    const { container } = render(
      <Section title="外" studioId="sec-1">
        <Button label="按钮" studioId="btn-1" />
      </Section>,
    );
    const btn = container.querySelector("button")!;
    expect(btn.closest("[data-studio-id]")?.getAttribute("data-studio-id")).toBe("btn-1");
    const label = container.querySelector("h2")!;
    expect(label.closest("[data-studio-id]")?.getAttribute("data-studio-id")).toBe("sec-1");
  });
});
