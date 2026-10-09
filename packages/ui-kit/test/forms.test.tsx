import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import DatePicker from "../src/components/DatePicker";
import InputNumber from "../src/components/InputNumber";
import Radio from "../src/components/Radio";
import SearchInput from "../src/components/SearchInput";
import Slider from "../src/components/Slider";
import Switch from "../src/components/Switch";
import Upload from "../src/components/Upload";

describe("Switch 开关", () => {
  it("默认开启，label 渲染在右侧", () => {
    render(<Switch />);
    expect(screen.getByRole("switch", { name: "通知" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("通知")).toBeInTheDocument();
  });

  it("点击切换 aria-checked 与旋钮位移", async () => {
    const user = userEvent.setup();
    const { container } = render(<Switch label="开启通知" />);
    const sw = screen.getByRole("switch", { name: "开启通知" });
    const knob = container.querySelector('[role="switch"] > span > span') as HTMLElement;
    expect(knob.style.transform).toBe("translateX(20px)");
    await user.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(knob.style.transform).toBe("translateX(0px)");
  });

  it("checked=false 时初始关闭", () => {
    render(<Switch checked={false} />);
    expect(screen.getByRole("switch", { name: "通知" })).toHaveAttribute("aria-checked", "false");
  });
});

describe("Radio 单选组", () => {
  it("默认渲染三个选项且选项一选中", () => {
    render(<Radio />);
    expect(screen.getByRole("radio", { name: "选项一" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "选项二" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "选项三" })).toBeInTheDocument();
  });

  it("点击移动选中项", async () => {
    const user = userEvent.setup();
    render(<Radio items={["甲", "乙", "丙"]} value="甲" />);
    await user.click(screen.getByRole("radio", { name: "丙" }));
    expect(screen.getByRole("radio", { name: "丙" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "甲" })).toHaveAttribute("aria-checked", "false");
  });

  it("items 为空数组时不崩溃", () => {
    const { container } = render(<Radio items={[]} />);
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  });
});

describe("SearchInput 搜索框", () => {
  it("渲染 placeholder 与放大镜图标", () => {
    const { container } = render(<SearchInput />);
    expect(screen.getByPlaceholderText("搜索…")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("输入后显示清空按钮，点击清空", async () => {
    const user = userEvent.setup();
    render(<SearchInput value="关键词" />);
    const input = screen.getByPlaceholderText("搜索…") as HTMLInputElement;
    expect(input.value).toBe("关键词");
    expect(screen.getByLabelText("清空")).toBeInTheDocument();
    await user.type(input, "abc");
    expect(input.value).toBe("关键词abc");
    await user.click(screen.getByLabelText("清空"));
    expect(input.value).toBe("");
    expect(screen.queryByLabelText("清空")).not.toBeInTheDocument();
  });
});

describe("Slider 滑块", () => {
  it("渲染默认值 40 与 min/max 属性", () => {
    render(<Slider />);
    const input = screen.getByLabelText("滑块");
    expect(input).toHaveAttribute("min", "0");
    expect(input).toHaveAttribute("max", "100");
    expect(screen.getByText("40")).toBeInTheDocument();
  });

  it("越界 value 钳制到 max", () => {
    render(<Slider value={150} />);
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("拖动更新读数", () => {
    render(<Slider />);
    fireEvent.change(screen.getByLabelText("滑块"), { target: { value: "60" } });
    expect(screen.getByText("60")).toBeInTheDocument();
  });
});

describe("InputNumber 数字输入", () => {
  it("默认值 1，+ / − 按钮步进", async () => {
    const user = userEvent.setup();
    render(<InputNumber />);
    expect(screen.getByText("1")).toBeInTheDocument();
    await user.click(screen.getByLabelText("增加"));
    expect(screen.getByText("2")).toBeInTheDocument();
    await user.click(screen.getByLabelText("减少"));
    await user.click(screen.getByLabelText("减少"));
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("超过 max 时钳制", async () => {
    const user = userEvent.setup();
    render(<InputNumber value={99} min={0} max={99} />);
    await user.click(screen.getByLabelText("增加"));
    expect(screen.getByText("99")).toBeInTheDocument();
  });

  it("step 自定义步长", async () => {
    const user = userEvent.setup();
    render(<InputNumber value={10} step={5} />);
    await user.click(screen.getByLabelText("增加"));
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("非法 value（NaN）回退默认 1，不崩溃", () => {
    render(<InputNumber value={Number.NaN} />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});

describe("DatePicker 日期选择", () => {
  it("渲染默认日期与日历图标", () => {
    const { container } = render(<DatePicker />);
    expect(screen.getByText("2026-09-10")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.firstElementChild).toHaveAttribute("data-component", "DatePicker");
  });

  it("value 为空时显示 placeholder", () => {
    render(<DatePicker value="" />);
    expect(screen.getByText("选择日期")).toBeInTheDocument();
  });
});

describe("Upload 上传", () => {
  it("渲染默认提示文案与虚线边框", () => {
    const { container } = render(<Upload />);
    const box = container.firstElementChild as HTMLElement;
    expect(box).toHaveAttribute("data-component", "Upload");
    expect(box).toHaveTextContent("点击或拖拽文件到此处上传");
    expect(box.className).toContain("border-dashed");
  });

  it("自定义 hint 透传", () => {
    render(<Upload hint="仅支持图片" />);
    expect(screen.getByText("仅支持图片")).toBeInTheDocument();
  });
});
