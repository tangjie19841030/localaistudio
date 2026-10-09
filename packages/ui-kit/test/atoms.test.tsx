import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import Button from "../src/components/Button";
import Checkbox from "../src/components/Checkbox";
import Form from "../src/components/Form";
import FormField from "../src/components/FormField";
import Image from "../src/components/Image";
import Input from "../src/components/Input";
import Select from "../src/components/Select";
import Table from "../src/components/Table";
import Textarea from "../src/components/Textarea";

describe("表单组件", () => {
  it("Form：标题 + 垂直布局渲染 children", () => {
    render(
      <Form title="新建项目">
        <Input placeholder="项目名" />
      </Form>,
    );
    expect(screen.getByText("新建项目")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("项目名")).toBeInTheDocument();
  });

  it("FormField：label + required 星标 + helpText", () => {
    render(
      <FormField label="项目名称" required helpText="3-20 个字符">
        <input />
      </FormField>,
    );
    expect(screen.getByText("项目名称")).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
    expect(screen.getByText("3-20 个字符")).toBeInTheDocument();
  });

  it("FormField：required=false 不渲染星标", () => {
    render(
      <FormField label="备注">
        <input />
      </FormField>,
    );
    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });

  it("Input：placeholder 与 type 透传", () => {
    render(<Input placeholder="邮箱地址" type="email" />);
    const input = screen.getByPlaceholderText("邮箱地址");
    expect(input).toHaveAttribute("type", "email");
    expect(input.className).toContain("rounded-[var(--studio-radius-control)]");
  });

  it("Input：type 缺省为 text", () => {
    render(<Input placeholder="任意" />);
    expect(screen.getByPlaceholderText("任意")).toHaveAttribute("type", "text");
  });

  it("Select：options 生成 option，placeholder 提示", () => {
    render(<Select options={["待支付", "已支付", "已取消"]} placeholder="全部状态" />);
    expect(screen.getByText("全部状态")).toBeInTheDocument();
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    const opts = screen.getAllByRole("option");
    expect(opts.map((o) => o.textContent)).toEqual([
      "全部状态",
      "待支付",
      "已支付",
      "已取消",
    ]);
  });

  it("Checkbox：label 文本 + 非受控选中态", () => {
    render(<Checkbox label="接受协议" checked />);
    expect(screen.getByLabelText("接受协议")).toBeInTheDocument();
    expect(screen.getByLabelText("接受协议")).toBeChecked();
  });

  it("Textarea：rows 与 placeholder 透传", () => {
    render(<Textarea placeholder="详细描述" rows={5} />);
    const ta = screen.getByPlaceholderText("详细描述");
    expect(ta).toHaveAttribute("rows", "5");
  });

  it("Table：列头 + 数据行渲染", () => {
    render(
      <Table
        columns={["订单号", "金额", "状态"]}
        rows={[
          ["A001", "199", "已支付"],
          ["A002", "88", "待支付"],
        ]}
      />,
    );
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("订单号");
    expect(table).toHaveTextContent("金额");
    expect(table).toHaveTextContent("状态");
    expect(table).toHaveTextContent("A001");
    expect(table).toHaveTextContent("199");
    expect(table).toHaveTextContent("A002");
  });
});

describe("交互冒烟", () => {
  it("Button：label 渲染且可点击触发 onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button label="保存" onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "保存" });
    expect(btn.className).toContain("bg-[var(--studio-color-brand)]");
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("Select：可交互的 combobox", () => {
    render(<Select options={["a", "b"]} placeholder="请选择" />);
    const select = screen.getByRole("combobox");
    expect((select as HTMLSelectElement).value).toBe("");
  });

  it("Checkbox：label 点击可切换", async () => {
    const user = userEvent.setup();
    render(<Checkbox label="开启通知" />);
    const cb = screen.getByLabelText("开启通知");
    expect(cb).not.toBeChecked();
    await user.click(cb);
    expect(cb).toBeChecked();
  });
});

describe("Image 占位语义", () => {
  it("src 为空字符串时渲染占位框且不渲染 img", () => {
    const { container } = render(<Image src="" alt="产品图" />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    const box = container.firstElementChild as HTMLElement;
    expect(box.dataset.component).toBe("Image");
    expect(box).toHaveTextContent("产品图");
    expect(box.className).toContain("border-dashed");
  });

  it("src 非空时渲染 img + alt", () => {
    render(<Image src="https://example.com/a.png" alt="示意图" />);
    const img = screen.getByRole("img", { name: "示意图" });
    expect(img).toHaveAttribute("src", "https://example.com/a.png");
  });
});
