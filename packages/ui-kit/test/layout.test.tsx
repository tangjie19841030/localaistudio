import { render, screen } from "@testing-library/react";
import { defaultTokens } from "@studio/schema-core";
import { describe, expect, it } from "vitest";
import AppShell from "../src/components/AppShell";
import Badge from "../src/components/Badge";
import Card from "../src/components/Card";
import Container from "../src/components/Container";
import EmptyState from "../src/components/EmptyState";
import Grid from "../src/components/Grid";
import Heading from "../src/components/Heading";
import Header from "../src/components/Header";
import MetricGrid from "../src/components/MetricGrid";
import Nav from "../src/components/Nav";
import Section from "../src/components/Section";
import Stack from "../src/components/Stack";
import StatCard from "../src/components/StatCard";
import Text from "../src/components/Text";

describe("布局容器组件", () => {
  it("AppShell：顶栏 + 侧栏 + 内容，根节点注入 tokens CSS 变量", () => {
    const { container } = render(
      <AppShell tokens={defaultTokens()} title="控制台" sidebar>
        <p>内容区文本</p>
      </AppShell>,
    );
    const root = container.firstElementChild as HTMLElement;
    const style = root.getAttribute("style") ?? "";
    expect(style).toContain("--studio-color-brand: #0F766E");
    expect(style).toContain("--studio-font-sans");
    expect(screen.getByRole("banner")).toHaveTextContent("控制台");
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.getByText("内容区文本")).toBeInTheDocument();
  });

  it("AppShell：sidebar=false 不渲染侧栏", () => {
    render(
      <AppShell tokens={defaultTokens()} title="T" sidebar={false}>
        <p>body</p>
      </AppShell>,
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("Header：标题与副标题", () => {
    render(<Header title="页面标题" subtitle="页面副标题" />);
    expect(screen.getByText("页面标题")).toBeInTheDocument();
    expect(screen.getByText("页面副标题")).toBeInTheDocument();
  });

  it("Nav：渲染 items 列表", () => {
    render(<Nav items={["概览", "订单", "设置"]} />);
    const nav = screen.getByRole("navigation");
    expect(nav).toHaveTextContent("概览");
    expect(nav).toHaveTextContent("订单");
    expect(nav).toHaveTextContent("设置");
  });

  it("Section：标题 + 描述 + children", () => {
    render(
      <Section title="数据总览" description="近 7 日">
        <div>区块内容</div>
      </Section>,
    );
    expect(screen.getByText("数据总览")).toBeInTheDocument();
    expect(screen.getByText("近 7 日")).toBeInTheDocument();
    expect(screen.getByText("区块内容")).toBeInTheDocument();
  });

  it("Grid：columns/gap 映射为 inline grid 样式", () => {
    render(
      <Grid columns={3} gap={2}>
        <div>a</div>
      </Grid>,
    );
    const el = screen.getByText("a").parentElement as HTMLElement;
    expect(el.style.getPropertyValue("grid-template-columns")).toBe(
      "repeat(3, minmax(0,1fr))",
    );
    expect(el.style.getPropertyValue("gap")).toBe("8px");
    // 预览容器查询依赖该标记折叠列数（workbench previewDevice.css）
    expect(el.dataset.columns).toBe("3");
  });

  it("Stack：纵向 flex + gap 与 alignItems 映射", () => {
    render(
      <Stack gap={3} align="center">
        <div>条目</div>
      </Stack>,
    );
    const el = screen.getByText("条目").parentElement as HTMLElement;
    expect(el.style.display).toBe("flex");
    expect(el.style.flexDirection).toBe("column");
    expect(el.style.gap).toBe("12px");
    expect(el.style.alignItems).toBe("center");
  });

  it("Container：maxWidth 映射 + 水平居中", () => {
    const { container } = render(
      <Container maxWidth="md">
        <div>c</div>
      </Container>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.maxWidth).toBe("512px");
    expect(el.style.marginLeft).toBe("auto");
    expect(el.style.marginRight).toBe("auto");
  });

  it("Card：标题 + 内容，data-component 标记", () => {
    render(
      <Card title="卡片标题" padded>
        <p>卡片内容</p>
      </Card>,
    );
    expect(screen.getByText("卡片标题")).toBeInTheDocument();
    expect(screen.getByText("卡片内容")).toBeInTheDocument();
    expect(
      (screen.getByText("卡片内容").closest("[data-component]") as HTMLElement)
        .dataset.component,
    ).toBe("Card");
  });

  it("MetricGrid：columns 生成 grid 且含子内容", () => {
    render(
      <MetricGrid columns={2}>
        <div>指标A</div>
        <div>指标B</div>
      </MetricGrid>,
    );
    const el = screen.getByText("指标A").parentElement as HTMLElement;
    expect(el.style.getPropertyValue("grid-template-columns")).toBe(
      "repeat(2, minmax(0,1fr))",
    );
    expect(screen.getByText("指标B")).toBeInTheDocument();
    expect(el.dataset.columns).toBe("2");
  });

  it("EmptyState：标题 + 描述 + 虚线边框", () => {
    render(<EmptyState title="暂无数据" description="先创建一条记录" />);
    const box = screen.getByText("暂无数据").closest("[data-component]") as HTMLElement;
    expect(box.dataset.component).toBe("EmptyState");
    expect(screen.getByText("先创建一条记录")).toBeInTheDocument();
    expect(box.className).toContain("border-dashed");
  });
});

describe("展示原子组件", () => {
  it("StatCard：label/value/delta 渲染且用 tone 类", () => {
    render(<StatCard label="今日订单" value="128" delta="+12%" tone="success" />);
    expect(screen.getByText("今日订单")).toBeInTheDocument();
    expect(screen.getByText("128")).toBeInTheDocument();
    expect(screen.getByText("+12%").className).toContain("text-[var(--studio-color-success)]");
  });

  it("Badge：label + tone 底色类", () => {
    render(<Badge label="已上线" tone="success" />);
    const el = screen.getByText("已上线");
    expect(el.className).toContain("bg-[var(--studio-color-success-soft)]");
  });

  it("Heading：level=2 渲染 h2 且文本可见", () => {
    render(<Heading text="二级标题" level={2} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("二级标题");
  });

  it("Heading：level 缺省渲染 h2", () => {
    render(<Heading text="默认级标题" />);
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });

  it("Text：muted=true 使用 muted 色类", () => {
    render(<Text content="辅助说明文字" muted />);
    expect(screen.getByText("辅助说明文字").className).toContain(
      "text-[var(--studio-color-muted)]",
    );
  });

  it("AppShell 组合：Header + Section 内 StatCard 文本可见", () => {
    render(
      <AppShell tokens={defaultTokens()} title="组合" sidebar>
        <Header title="运营总览" subtitle="日报" />
        <Section title="核心指标">
          <StatCard label="GMV" value="9,800" delta="+3%" tone="brand" />
        </Section>
      </AppShell>,
    );
    expect(screen.getByText("运营总览")).toBeInTheDocument();
    expect(screen.getByText("GMV")).toBeInTheDocument();
    expect(screen.getByText("9,800")).toBeInTheDocument();
  });
});
