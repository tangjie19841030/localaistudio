import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FeatureGrid from "../src/components/FeatureGrid";
import Footer from "../src/components/Footer";
import Hero from "../src/components/Hero";
import PricingCard from "../src/components/PricingCard";
import Progress from "../src/components/Progress";
import ProgressRing from "../src/components/ProgressRing";
import Skeleton from "../src/components/Skeleton";
import StatsBanner from "../src/components/StatsBanner";
import Testimonial from "../src/components/Testimonial";
import Toast from "../src/components/Toast";
import Tooltip from "../src/components/Tooltip";

describe("反馈组件", () => {
  it("Progress：label 与百分比渲染，填充宽度随 value 变化", () => {
    const { container } = render(<Progress value={42} label="加载中" />);
    expect(screen.getByText("加载中")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    const fill = container.querySelector('[data-component="Progress"] div.h-full') as HTMLElement;
    expect(fill.style.width).toBe("42%");
  });

  it("Progress：越界值钳制到 0-100", () => {
    const { container } = render(<Progress value={150} />);
    const fill = container.querySelector('[data-component="Progress"] div.h-full') as HTMLElement;
    expect(fill.style.width).toBe("100%");
    expect(screen.getByText("100%")).toBeInTheDocument();
    render(<Progress value={-5} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("ProgressRing：默认渲染 72% 且包含 SVG 圆环", () => {
    const { container } = render(<ProgressRing />);
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(container.querySelector("svg circle")).toBeInTheDocument();
  });

  it("ProgressRing：自定义值与尺寸，越界钳制", () => {
    render(<ProgressRing value={999} size={120} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "100%" })).toHaveAttribute("width", "120");
  });

  it("Skeleton：text 变体默认渲染 3 根条且宽度循环", () => {
    const { container } = render(<Skeleton />);
    const bars = container.querySelectorAll('[data-component="Skeleton"] > div');
    expect(bars.length).toBe(3);
    expect((bars[0] as HTMLElement).style.width).toBe("100%");
    expect((bars[1] as HTMLElement).style.width).toBe("80%");
    expect((bars[2] as HTMLElement).style.width).toBe("60%");
  });

  it("Skeleton：rows 控制条数，card/avatar 变体为单个块", () => {
    const { container } = render(<Skeleton rows={5} />);
    expect(container.querySelectorAll('[data-component="Skeleton"] > div').length).toBe(5);
    const card = render(<Skeleton variant="card" />).container;
    expect(card.querySelectorAll('[data-component="Skeleton"] > div').length).toBe(1);
    const avatar = render(<Skeleton variant="avatar" />).container;
    expect(avatar.querySelector('[data-component="Skeleton"] > div')?.className).toContain("rounded-full");
  });

  it("Toast：默认成功态渲染文本，tone 变化切换软色背景", () => {
    const { container } = render(<Toast />);
    expect(screen.getByText("已保存")).toBeInTheDocument();
    const root = container.querySelector('[data-component="Toast"]') as HTMLElement;
    expect(root.style.backgroundColor).toContain("--color-success-soft");
    render(<Toast tone="danger" text="保存失败" />);
    expect(screen.getByText("保存失败")).toBeInTheDocument();
  });

  it("Toast：未知 tone 回退成功态且不崩溃", () => {
    const { container } = render(<Toast tone={"oops" as never} text="任意" />);
    const root = container.querySelector('[data-component="Toast"]') as HTMLElement;
    expect(root.style.backgroundColor).toContain("--color-success-soft");
  });

  it("Tooltip：气泡与锚点文本常显渲染", () => {
    const { container } = render(<Tooltip text="这是提示" anchor="悬停我" />);
    expect(screen.getByText("这是提示")).toBeVisible();
    expect(screen.getByText("悬停我")).toBeInTheDocument();
    expect(container.querySelector('[data-component="Tooltip"]')?.className).toContain("inline-flex");
  });

  it("Tooltip：默认文案渲染", () => {
    render(<Tooltip />);
    expect(screen.getByText("提示内容")).toBeInTheDocument();
    expect(screen.getByText("悬停查看")).toBeInTheDocument();
  });
});

describe("营销组件", () => {
  it("Hero：默认标题、副标题与 CTA 文案渲染", () => {
    render(<Hero />);
    expect(screen.getByText("构建下一代产品")).toBeInTheDocument();
    expect(screen.getByText("从想法到上线，一站式完成")).toBeInTheDocument();
    expect(screen.getByText("立即开始")).toBeInTheDocument();
  });

  it("Hero：自定义文案透传", () => {
    render(<Hero title="自定义标题" subtitle="自定义副标题" ctaText="马上试用" />);
    expect(screen.getByText("自定义标题")).toBeInTheDocument();
    expect(screen.getByText("马上试用")).toBeInTheDocument();
  });

  it("FeatureGrid：默认 3 项特性渲染标题与描述", () => {
    render(<FeatureGrid />);
    expect(screen.getByText("极速")).toBeInTheDocument();
    expect(screen.getByText("毫秒级响应")).toBeInTheDocument();
    expect(screen.getByText("协作")).toBeInTheDocument();
  });

  it("FeatureGrid：features 为空时返回 null，columns 透传到网格样式", () => {
    const empty = render(<FeatureGrid features={[]} />).container;
    expect(empty.firstElementChild).toBeNull();
    const { container } = render(<FeatureGrid columns={2} />);
    const grid = container.querySelector('[data-component="FeatureGrid"]') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
  });

  it("PricingCard：默认套餐、价格与特性清单渲染", () => {
    render(<PricingCard />);
    expect(screen.getByText("专业版")).toBeInTheDocument();
    expect(screen.getByText("¥99")).toBeInTheDocument();
    expect(screen.getByText("/月")).toBeInTheDocument();
    expect(screen.getByText("无限项目")).toBeInTheDocument();
    expect(screen.getByText("立即订阅")).toBeInTheDocument();
  });

  it("PricingCard：featured 渲染荐角标，空 features 不崩溃", () => {
    render(<PricingCard featured features={[]} />);
    expect(screen.getByText("荐")).toBeInTheDocument();
    expect(screen.queryByText("无限项目")).not.toBeInTheDocument();
  });

  it("Testimonial：默认引言、作者与角色渲染", () => {
    render(<Testimonial />);
    expect(screen.getByText("这个工具彻底改变了我们的工作方式。")).toBeInTheDocument();
    expect(screen.getByText("王小姐")).toBeInTheDocument();
    expect(screen.getByText("产品经理")).toBeInTheDocument();
  });

  it("Testimonial：首字符作为头像缩写", () => {
    render(<Testimonial author="李先生" role="工程师" quote="很好用" />);
    expect(screen.getByText("李")).toBeInTheDocument();
    expect(screen.getByText("很好用")).toBeInTheDocument();
  });

  it("StatsBanner：默认 3 项统计渲染值与标签", () => {
    render(<StatsBanner />);
    expect(screen.getByText("10k+")).toBeInTheDocument();
    expect(screen.getByText("活跃用户")).toBeInTheDocument();
    expect(screen.getByText("99%")).toBeInTheDocument();
  });

  it("StatsBanner：stats 为空时返回 null，自定义项渲染", () => {
    const empty = render(<StatsBanner stats={[]} />).container;
    expect(empty.firstElementChild).toBeNull();
    render(<StatsBanner stats={[{ label: "订单量", value: "1.2w" }]} />);
    expect(screen.getByText("1.2w")).toBeInTheDocument();
  });

  it("Footer：默认两列链接与版权行渲染", () => {
    render(<Footer />);
    expect(screen.getByText("产品")).toBeInTheDocument();
    expect(screen.getByText("定价")).toBeInTheDocument();
    expect(screen.getByText("© 2026 Studio")).toBeInTheDocument();
  });

  it("Footer：columns 为空时仍渲染版权行且不崩溃", () => {
    render(<Footer columns={[]} copyright="© 2026 测试" />);
    expect(screen.getByText("© 2026 测试")).toBeInTheDocument();
    expect(screen.queryByText("产品")).not.toBeInTheDocument();
  });
});
