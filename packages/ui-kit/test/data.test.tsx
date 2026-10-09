import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Avatar from "../src/components/Avatar";
import AvatarGroup from "../src/components/AvatarGroup";
import Calendar from "../src/components/Calendar";
import CodeBlock from "../src/components/CodeBlock";
import KeyValList from "../src/components/KeyValList";
import List from "../src/components/List";
import Timeline from "../src/components/Timeline";

describe("Avatar 头像", () => {
  it("无 src 时渲染姓名首字 initials", () => {
    render(<Avatar name="张三" />);
    expect(screen.getByText("张")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("有 src 时渲染 img 并 object-cover", () => {
    render(<Avatar name="李四" src="https://example.com/a.png" />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.com/a.png");
    expect(img).toHaveAttribute("alt", "李四");
  });

  it("脏 props（数字 name / null src / 非法 size）降级不抛异常", () => {
    render(<Avatar name={42 as never} src={null as never} size={"xxl" as never} studioId="a1" />);
    expect(screen.getByText("张")).toBeInTheDocument();
  });

  it("空数组等价：空 name 也走默认", () => {
    render(<Avatar name="" />);
    expect(screen.getByText("张")).toBeInTheDocument();
  });
});

describe("AvatarGroup 头像组", () => {
  it("默认渲染三个姓名 initials", () => {
    render(<AvatarGroup />);
    expect(screen.getByText("张")).toBeInTheDocument();
    expect(screen.getByText("李")).toBeInTheDocument();
    expect(screen.getByText("王")).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it("names 超出 overflowCount 时渲染 +N 圆点", () => {
    render(<AvatarGroup names={["甲", "乙", "丙", "丁", "戊", "己", "庚"]} overflowCount={3} />);
    expect(screen.getByText("+4")).toBeInTheDocument();
    expect(screen.queryByText("丁")).not.toBeInTheDocument();
  });

  it("空数组与脏 names 渲染为 null，不抛异常", () => {
    const { container } = render(<AvatarGroup names={[]} />);
    expect(container.firstChild).toBeNull();
    const dirty = render(<AvatarGroup names={"junk" as never} />);
    expect(dirty.container.firstChild).toBeNull();
  });
});

describe("List 列表", () => {
  it("渲染标题、描述与 meta", () => {
    render(<List items={[{ title: "列表项一", description: "描述文本", meta: "3 分钟前" }]} />);
    expect(screen.getByText("列表项一")).toBeInTheDocument();
    expect(screen.getByText("描述文本")).toBeInTheDocument();
    expect(screen.getByText("3 分钟前")).toBeInTheDocument();
  });

  it("空数组渲染为 null", () => {
    const { container } = render(<List items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("脏 items 丢弃无 title 项，合法项照常渲染", () => {
    const dirty = [null, 42, {}, { title: "合法项" }, { description: "无标题" }] as never;
    render(<List items={dirty} />);
    expect(screen.getByText("合法项")).toBeInTheDocument();
    expect(screen.queryByText("无标题")).not.toBeInTheDocument();
  });
});

describe("KeyValList 键值对", () => {
  it("渲染 key 与 value 两列", () => {
    render(<KeyValList items={[{ key: "订单编号", value: "SO-0041" }]} />);
    expect(screen.getByText("订单编号")).toBeInTheDocument();
    expect(screen.getByText("SO-0041")).toBeInTheDocument();
  });

  it("空数组渲染为 null；数字 value 容忍为字符串", () => {
    const { container } = render(<KeyValList items={[]} />);
    expect(container.firstChild).toBeNull();
    render(<KeyValList items={[{ key: "数量", value: 3 as never }]} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

describe("Timeline 时间线", () => {
  it("渲染 title、time 与 description", () => {
    render(<Timeline items={[{ title: "订单创建", time: "09:00", description: "用户下单" }]} />);
    expect(screen.getByText("订单创建")).toBeInTheDocument();
    expect(screen.getByText("09:00")).toBeInTheDocument();
    expect(screen.getByText("用户下单")).toBeInTheDocument();
  });

  it("无 title 但有 description 的条目仍渲染", () => {
    render(<Timeline items={[{ description: "仅描述" }]} />);
    expect(screen.getByText("仅描述")).toBeInTheDocument();
  });

  it("空数组与全空条目渲染为 null", () => {
    const { container } = render(<Timeline items={[{}, { title: "" }]} />);
    expect(container.firstChild).toBeNull();
    const dirty = render(<Timeline items={"junk" as never} />);
    expect(dirty.container.firstChild).toBeNull();
  });
});

describe("CodeBlock 代码块", () => {
  it("渲染代码内容与语言标签", () => {
    render(<CodeBlock code="const x = 1;" language="ts" />);
    expect(screen.getByText("const x = 1;")).toBeInTheDocument();
    expect(screen.getByText("ts")).toBeInTheDocument();
  });

  it("默认值为 const x = 1; / ts", () => {
    render(<CodeBlock />);
    expect(screen.getByText("const x = 1;")).toBeInTheDocument();
    expect(screen.getByText("ts")).toBeInTheDocument();
  });

  it("脏 code（数字/null）不抛异常", () => {
    render(<CodeBlock code={123 as never} />);
    expect(screen.getByText("123")).toBeInTheDocument();
    const empty = render(<CodeBlock code={null as never} />);
    expect(empty.container.querySelector("pre")).not.toBeNull();
  });
});

describe("Calendar 日历", () => {
  it("month 标题渲染为中文格式", () => {
    render(<Calendar month="2026-09" />);
    expect(screen.getByText("2026 年 9 月")).toBeInTheDocument();
    expect(screen.getByText("日")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("非法 month 回退到 2026-09", () => {
    const bad = render(<Calendar month="junk" />);
    expect(bad.getByText("2026 年 9 月")).toBeInTheDocument();
    bad.unmount();
    const dirty = render(<Calendar month={null as never} />);
    expect(dirty.getByText("2026 年 9 月")).toBeInTheDocument();
  });
});
