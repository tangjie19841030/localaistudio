import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Nav from "../src/components/Nav";
import Table from "../src/components/Table";

/**
 * 回归：真实模型（火山方舟）给 Nav/Table 传对象数组，旧实现把对象直接当
 * React 子节点渲染 → "Objects are not valid as a React child" 整个编辑器白屏。
 * 组件层必须宽容两种形状（字符串 / 对象）。
 */
describe("Nav/Table 容忍模型输出形状", () => {
  it("Nav：字符串数组照常渲染", () => {
    render(<Nav items={["首页", "数据"]} />);
    expect(screen.getByText("首页")).toBeInTheDocument();
    expect(screen.getByText("数据")).toBeInTheDocument();
  });

  it("Nav：{key,label} 对象数组渲染 label 而不是崩溃", () => {
    render(
      <Nav
        items={[
          { key: "dashboard", label: "工作台" },
          { key: "orders", label: "订单管理" },
        ]}
      />,
    );
    expect(screen.getByText("工作台")).toBeInTheDocument();
    expect(screen.getByText("订单管理")).toBeInTheDocument();
  });

  it("Nav：脏数据降级为少几项，不抛异常", () => {
    const dirty = ["合法项", null, 42, { key: "no-label" }, { label: "有标签" }] as unknown;
    render(<Nav items={dirty as never} />);
    expect(screen.getByText("合法项")).toBeInTheDocument();
    expect(screen.getByText("有标签")).toBeInTheDocument();
  });

  it("Table：字符串列 + 二维数组行照常渲染", () => {
    render(<Table columns={["名称", "数值"]} rows={[["示例", "100"]]} />);
    expect(screen.getByText("名称")).toBeInTheDocument();
    expect(screen.getByText("示例")).toBeInTheDocument();
  });

  it("Table：{key,title} 列 + 对象行按列键取值", () => {
    render(
      <Table
        columns={[
          { key: "orderNo", title: "订单号" },
          { key: "amount", title: "金额" },
        ]}
        rows={[{ orderNo: "SO-0041", amount: "¥2,480.00" }]}
      />,
    );
    expect(screen.getByText("订单号")).toBeInTheDocument();
    expect(screen.getByText("SO-0041")).toBeInTheDocument();
    expect(screen.getByText("¥2,480.00")).toBeInTheDocument();
  });

  it("Table：列空或行空时渲染 null，不崩溃", () => {
    const { container } = render(<Table columns={[]} rows={[]} />);
    expect(container.querySelector("table")).toBeNull();
  });
});
