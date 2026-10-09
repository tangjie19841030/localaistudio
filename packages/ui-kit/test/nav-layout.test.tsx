import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Accordion from "../src/components/Accordion";
import BottomNav from "../src/components/BottomNav";
import Breadcrumb from "../src/components/Breadcrumb";
import Divider from "../src/components/Divider";
import Pagination from "../src/components/Pagination";
import Steps from "../src/components/Steps";

describe("Breadcrumb 面包屑", () => {
  it("字符串 items 渲染胶囊条，末项为当前页", () => {
    const root = render(<Breadcrumb items={["首页", "列表", "详情"]} studioId="bc-1" />).container.firstElementChild as HTMLElement;
    expect(root.dataset.component).toBe("Breadcrumb");
    expect(root.textContent).toContain("›");
    expect(screen.getByText("详情").className).toContain("font-medium");
    expect(screen.getByText("详情").className).toContain("var(--studio-color-text)");
  });
  it("字符串与 { label } 混合均渲染；空/全无效条目渲染 null", () => {
    render(<Breadcrumb items={["首页", { label: "订单" }]} />);
    expect(screen.getByText("首页")).toBeInTheDocument();
    expect(screen.getByText("订单")).toBeInTheDocument();
    expect(render(<Breadcrumb items={[]} />).container.firstElementChild).toBeNull();
  });
});

describe("Pagination 分页", () => {
  it("默认渲染 1 / 12 指示器", () => {
    const root = render(<Pagination studioId="pg-1" />).container.firstElementChild as HTMLElement;
    expect(root.dataset.component).toBe("Pagination");
    expect(root.textContent).toContain("1 / 12");
  });
  it("上一页/下一页在边界处钳制，越界初始值渲染安全", async () => {
    const user = userEvent.setup();
    render(<Pagination page={1} pageCount={3} />);
    const prev = screen.getByRole("button", { name: "上一页" });
    const next = screen.getByRole("button", { name: "下一页" });
    await user.click(prev);
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    await user.click(next);
    await user.click(next);
    await user.click(next);
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    expect(render(<Pagination page={99} pageCount={3} />).container.textContent).toContain("3 / 3");
  });
});

describe("Steps 步骤条", () => {
  it("已完成步骤显示品牌色对勾，未来步骤灰显", () => {
    const root = render(<Steps items={["提交", "审核", "完成"]} current={1} studioId="st-1" />).container.firstElementChild as HTMLElement;
    expect(root.dataset.component).toBe("Steps");
    expect(root.textContent).toContain("提交");
    expect(screen.getByText("✓").className).toContain("bg-[var(--studio-color-brand)]");
    expect(screen.getByText("3").className).toContain("var(--studio-color-muted)");
    expect(screen.getByText("3").className).not.toContain("var(--studio-color-brand)");
  });
  it("字符串与 { label, description } 混合均渲染；空 items 渲染 null", () => {
    render(<Steps items={["提交", { label: "审核", description: "1 个工作日内" }]} current={0} />);
    expect(screen.getByText("审核")).toBeInTheDocument();
    expect(screen.getByText("1 个工作日内")).toBeInTheDocument();
    expect(render(<Steps items={[]} />).container.firstElementChild).toBeNull();
  });
});

describe("BottomNav 底部导航", () => {
  it("激活项品牌色高亮，点击可切换激活项", async () => {
    const user = userEvent.setup();
    const root = render(<BottomNav items={["首页", "发现", "我的"]} studioId="bn-1" />).container.firstElementChild as HTMLElement;
    expect(root.dataset.component).toBe("BottomNav");
    const first = screen.getByRole("button", { name: "首页" });
    expect(first.className).toContain("var(--studio-color-brand)");
    await user.click(screen.getByRole("button", { name: "我的" }));
    expect(screen.getByRole("button", { name: "我的" }).className).toContain("var(--studio-color-brand)");
    expect(first.className).not.toContain("var(--studio-color-brand)");
  });
  it("字符串与 { key, label } 混合均渲染；空 items 渲染 null", () => {
    render(<BottomNav items={["首页", { key: "find", label: "发现" }]} />);
    expect(screen.getByRole("button", { name: "发现" })).toBeInTheDocument();
    expect(render(<BottomNav items={[]} />).container.firstElementChild).toBeNull();
  });
});

describe("Divider 分隔线", () => {
  it("horizontal 带 label 时文本居中夹于两侧线间；无 label 为满宽细线", () => {
    const root = render(<Divider label="或" studioId="dv-1" />).container.firstElementChild as HTMLElement;
    expect(root.dataset.component).toBe("Divider");
    expect(root.className).toContain("items-center");
    expect(screen.getByText("或").className).toContain("var(--studio-color-muted)");
    expect((render(<Divider />).container.firstElementChild as HTMLElement).className).toContain("h-px");
  });
  it("vertical 竖线随父容器拉伸；空白 label 退化为纯线不崩溃", () => {
    const el = render(<Divider orientation="vertical" />).container.firstElementChild as HTMLElement;
    expect(el.className).toContain("w-px");
    expect(el.className).toContain("self-stretch");
    expect((render(<Divider label="  " />).container.firstElementChild as HTMLElement).className).toContain("h-px");
  });
});

describe("Accordion 折叠面板", () => {
  it("默认展开第一项，点击标题可切换开合", async () => {
    const user = userEvent.setup();
    const items = [{ title: "如何开始？", content: "点击新建项目。" }, { title: "支持导出吗？", content: "支持导出完整工程。" }];
    render(<Accordion items={items} studioId="ac-1" />);
    expect(screen.getByText("点击新建项目。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /如何开始/ }));
    expect(screen.queryByText("点击新建项目。")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /支持导出/ }));
    expect(screen.getByText("支持导出完整工程。")).toBeInTheDocument();
  });
  it("openIndex=-1 全部收起，无效条目被跳过；空 items 渲染 null", () => {
    const items = [{ title: "唯一问题", content: "答案" }, null, 42, { content: "无标题" }] as never;
    const { container } = render(<Accordion items={items} openIndex={-1} />);
    expect(screen.queryByText("答案")).not.toBeInTheDocument();
    expect(container.textContent).toContain("唯一问题");
    expect(container.textContent).not.toContain("无标题");
    expect(render(<Accordion items={[]} />).container.firstElementChild).toBeNull();
  });
});
