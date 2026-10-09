import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BarChart from "../src/components/BarChart";
import DonutChart from "../src/components/DonutChart";
import LineChart from "../src/components/LineChart";
import Sparkline from "../src/components/Sparkline";

describe("BarChart 柱状图", () => {
  it("缺省渲染 5 根柱子、数值与星期标签", () => {
    const { container } = render(<BarChart />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("viewBox", "0 0 400 200");
    expect(container.querySelectorAll("path.studio-bar")).toHaveLength(5);
    expect(container.querySelector("svg")).toHaveTextContent("周四");
    expect(container.querySelector("svg")).toHaveTextContent("60");
  });

  it("按 data 长度渲染柱子，showValues=false 隐藏数值", () => {
    const { container } = render(
      <BarChart data={[{ label: "A", value: 1 }, { label: "B", value: 3 }]} showValues={false} />,
    );
    expect(container.querySelectorAll("path.studio-bar")).toHaveLength(2);
    expect(container.querySelector("svg")).not.toHaveTextContent("3");
  });

  it("data 为空数组时渲染 null", () => {
    const { container } = render(<BarChart data={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("脏数据（字符串/对象/null 项）被强制转换或丢弃，不崩溃", () => {
    const { container } = render(
      <BarChart
        data={[
          { label: 42, value: "7" },
          null,
          "oops",
          { label: "坏值", value: "abc" },
          { value: 5 },
        ] as never}
      />,
    );
    // "7"→7 保留，"abc"→NaN 丢弃，非对象项丢弃，缺 label 允许为空
    expect(container.querySelectorAll("path.studio-bar")).toHaveLength(2);
    expect(container.querySelector("svg")).toHaveTextContent("42");
  });
});

describe("LineChart 折线图", () => {
  it("缺省渲染 1 条折线 + 4 个数据点圆圈", () => {
    const { container } = render(<LineChart />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 400 160");
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
    expect(container.querySelectorAll("circle")).toHaveLength(4);
    expect(svg).toHaveTextContent("4 月");
  });

  it("按 data 长度渲染数据点", () => {
    const { container } = render(
      <LineChart data={[{ label: "一", value: 5 }, { label: "二", value: 9 }, { label: "三", value: 7 }]} />,
    );
    expect(container.querySelectorAll("circle")).toHaveLength(3);
  });

  it("data 为空数组时渲染 null", () => {
    const { container } = render(<LineChart data={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("脏数据被强制转换或丢弃，不崩溃", () => {
    const { container } = render(
      <LineChart data={[{ label: "x", value: "3" }, 42, { label: "y", value: null }] as never} />,
    );
    // "3"→3 与 null→0 保留（Number(null)=0 为有限数），非对象项 42 丢弃
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });
});

describe("DonutChart 环形图", () => {
  it("缺省渲染 3 个扇段 + 中心总计 + 图例", () => {
    const { container } = render(<DonutChart />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("role", "img");
    expect(container.querySelectorAll("circle.studio-donut-seg")).toHaveLength(3);
    expect(svg).toHaveTextContent("总计");
    expect(svg).toHaveTextContent("100"); // 40+35+25
    expect(svg).toHaveTextContent("40%");
  });

  it("图例扇段按调色板循环取色", () => {
    const { container } = render(
      <DonutChart
        data={[
          { label: "A", value: 1 },
          { label: "B", value: 1 },
          { label: "C", value: 1 },
          { label: "D", value: 1 },
          { label: "E", value: 1 },
          { label: "F", value: 1 },
        ]}
      />,
    );
    const strokes = [...container.querySelectorAll("circle.studio-donut-seg")].map((c) =>
      c.getAttribute("stroke"),
    );
    expect(strokes[0]).toBe("var(--studio-color-brand)");
    expect(strokes[5]).toBe("var(--studio-color-brand)"); // 循环回起点
    expect(strokes[1]).toBe("var(--studio-color-success)");
  });

  it("data 为空数组时渲染 null", () => {
    const { container } = render(<DonutChart data={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("脏数据被强制转换或丢弃，不崩溃", () => {
    const { container } = render(
      <DonutChart data={[{ label: "a", value: "4" }, { label: "b", value: {} }, [1, 2]] as never} />,
    );
    expect(container.querySelectorAll("circle.studio-donut-seg")).toHaveLength(1);
  });
});

describe("Sparkline 迷你趋势图", () => {
  it("缺省渲染 6 个数据点的折线，viewBox 96x28", () => {
    const { container } = render(<Sparkline />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 96 28");
    const poly = container.querySelector("polyline");
    expect(poly).toHaveAttribute("stroke", "var(--studio-color-brand)");
    expect(poly?.getAttribute("points")?.trim().split(/[\s,]+/)).toHaveLength(12); // 6 点 × xy
  });

  it("tone 映射对应 CSS 变量描边", () => {
    const { container } = render(<Sparkline tone="danger" />);
    expect(container.querySelector("polyline")).toHaveAttribute("stroke", "var(--studio-color-danger)");
  });

  it("values 为空数组时渲染 null", () => {
    const { container } = render(<Sparkline values={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("脏值被强制转换、NaN 丢弃，全坏时渲染 null", () => {
    const { container } = render(<Sparkline values={[1, "2", "bad", null, 5] as never} />);
    // 1,2,5 保留（null→0 也是有限数，共 4 点）
    const poly = container.querySelector("polyline");
    expect(poly?.getAttribute("points")?.trim().split(/[\s,]+/)).toHaveLength(8);
    const { container: empty } = render(<Sparkline values={["x", {}] as never} />);
    expect(empty.querySelector("svg")).toBeNull();
  });
});
