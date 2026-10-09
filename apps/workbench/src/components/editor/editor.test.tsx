import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultPage, defaultStudioDocument, type StudioDocument, type Page } from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InsertMenu } from "./InsertMenu";
import { LayerTree } from "./LayerTree";
import { PropsForm } from "./PropsForm";
import { TokenEditor } from "./TokenEditor";
import { RightPanel } from "../layout/RightPanel";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

/** T19: TokenEditor consumes the whole doc; tests build a page fixture. */
function docAsWhole(page: Page): StudioDocument {
  const doc = defaultStudioDocument(page.name);
  doc.pages[0] = page;
  return doc;
}


const treeDoc = (): Page => ({ ...defaultPage("测试页"), rootId: "root",
  nodes: [
    { id: "root", type: "Section", props: { title: "区块", description: "" }, children: ["stat", "btn"] },
    { id: "stat", type: "StatCard", props: { label: "GMV", value: "1,200", delta: "+12%", tone: "brand" }, children: [] },
    { id: "btn", type: "Button", props: { label: "保存", variant: "primary", size: "md" }, children: [] },
  ],
});

const statNode = { id: "stat", type: "StatCard", props: { label: "GMV", value: "1,200", delta: "+12%", tone: "brand" }, children: [] };

beforeEach(cleanup);

describe("TokenEditor", () => {
  it("改品牌色触发 onSetToken(['color','brand'], 新值)", () => {
    const onSetToken = vi.fn();
    render(<TokenEditor doc={docAsWhole(treeDoc())} onSetToken={onSetToken} />);
    // jsdom normalizes color input values to lowercase (DOM spec behavior)


    fireEvent.change(screen.getByLabelText("品牌色"), { target: { value: "#ABCDEF" } });
    expect(onSetToken).toHaveBeenCalledWith(["color", "brand"], "#abcdef");
  });

  it("radius card 数字输入回调数值；非法（空/越界）显示行内错误且不回调", async () => {
    const user = userEvent.setup();
    const onSetToken = vi.fn();
    render(<TokenEditor doc={docAsWhole(treeDoc())} onSetToken={onSetToken} />);
    const radius = screen.getByLabelText("圆角-卡片");
    await user.clear(radius);
    await user.type(radius, "12");
    fireEvent.blur(radius);
    expect(onSetToken).toHaveBeenCalledWith(["radius", "card"], 12);

    onSetToken.mockClear();
    await user.clear(radius);
    await user.type(radius, "99");
    fireEvent.blur(radius);
    expect(onSetToken).not.toHaveBeenCalled();
    expect(screen.getByText(/0-64/)).toBeInTheDocument();
  });

  it("font sans 文本输入回调；空值报错不回调", async () => {
    const user = userEvent.setup();
    const onSetToken = vi.fn();
    render(<TokenEditor doc={docAsWhole(treeDoc())} onSetToken={onSetToken} />);
    const font = screen.getByLabelText("字体-sans");
    await user.clear(font);
    await user.type(font, "PingFang SC");
    fireEvent.blur(font);
    expect(onSetToken).toHaveBeenCalledWith(["font", "sans"], "PingFang SC");

    onSetToken.mockClear();
    await user.clear(font);
    fireEvent.blur(font);
    expect(onSetToken).not.toHaveBeenCalled();
    expect(screen.getByText(/非空/)).toBeInTheDocument();
  });
});

describe("LayerTree", () => {
  it("树状渲染：类型标题 + 短 id，缩进按深度", () => {
    render(
      <LayerTree doc={treeDoc()} selectedId={null} onSelect={() => {}} onRemove={() => {}} />,
    );
    expect(screen.getByText("区块")).toBeInTheDocument();
    // 节点 id 降级为悬停提示（title），行内只显示组件标题
    expect(screen.getByRole("treeitem", { name: /指标卡/ })).toHaveAttribute(
      "title",
      expect.stringContaining("stat"),
    );
    const rows = screen.getAllByRole("treeitem");
    expect(rows).toHaveLength(3);
  });

  it("点击行选中；选中行 aria-selected", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <LayerTree doc={treeDoc()} selectedId="stat" onSelect={onSelect} onRemove={() => {}} />,
    );
    const statRow = screen.getByRole("treeitem", { name: /指标卡/ });
    expect(statRow).toHaveAttribute("aria-selected", "true");
    await user.click(statRow);
    expect(onSelect).toHaveBeenCalledWith("stat");
  });

  it("删除按钮回调节点 id；根节点无删除按钮", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <LayerTree doc={treeDoc()} selectedId={null} onSelect={() => {}} onRemove={onRemove} />,
    );
    const rootRow = screen.getByRole("treeitem", { name: /^区块/ });
    expect(withinRow(rootRow).queryByRole("button", { name: /删除/ })).toBeNull();

    const delBtn = screen.getByRole("button", { name: "删除 指标卡" });
    await user.click(delBtn);
    expect(onRemove).toHaveBeenCalledWith("stat");
  });
});

function withinRow(row: HTMLElement) {
  return {
    queryByRole: (role: string, opts?: { name?: string | RegExp }) => {
      const els = Array.from(row.querySelectorAll(role === "button" ? "button" : `[role="${role}"]`));
      const name = opts?.name;
      if (name === undefined) return els[0] ?? null;
      return (
        els.find((el) =>
          name instanceof RegExp ? name.test((el as HTMLElement).textContent ?? "") : (el as HTMLElement).textContent === name,
        ) ?? null
      );
    },
  };
}

describe("PropsForm", () => {
  it("StatCard 反射生成 label/value/delta/tone 四控件，tone 为 enum select", () => {
    const onPropsChange = vi.fn();
    render(<PropsForm node={statNode} onPropsChange={onPropsChange} />);
    expect(screen.getByLabelText("label")).toBeInTheDocument();
    expect(screen.getByLabelText("value")).toBeInTheDocument();
    expect(screen.getByLabelText("delta")).toBeInTheDocument();
    const tone = screen.getByLabelText("tone");
    expect(tone.tagName).toBe("SELECT");
    for (const opt of ["brand", "neutral", "success", "warning", "danger"]) {
      expect(screen.getByRole("option", { name: opt })).toBeInTheDocument();
    }
  });

  it("修改 label 回调整包 props（含其余字段）", async () => {
    const user = userEvent.setup();
    const onPropsChange = vi.fn();
    render(<PropsForm node={statNode} onPropsChange={onPropsChange} />);
    const label = screen.getByLabelText("label");
    await user.clear(label);
    await user.type(label, "日活");
    expect(onPropsChange).toHaveBeenCalledWith(
      expect.objectContaining({ label: "日活", value: "1,200", delta: "+12%", tone: "brand" }),
    );
  });

  it("ZodBoolean → checkbox、ZodNumber → number input、ZodArray → textarea", () => {
    render(
      <PropsForm
        node={{ id: "nav", type: "Nav", props: { items: ["首页"] }, children: [] }}
        onPropsChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("items")).toHaveProperty("tagName", "TEXTAREA");
    render(
      <PropsForm
        node={{ id: "grid", type: "Grid", props: { columns: 3, gap: 4 }, children: [] }}
        onPropsChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("columns")).toHaveProperty("type", "number");
    expect(screen.getByLabelText("gap")).toHaveProperty("type", "number");
    render(
      <PropsForm
        node={{ id: "card", type: "Card", props: { title: "t", padded: true }, children: [] }}
        onPropsChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("padded")).toHaveProperty("type", "checkbox");
  });

  it("定位状态：flow 节点显示流式布局且无 unpin 入口；pinned 显示自由定位 + 回到流式布局", () => {
    // 流式（无 pinned/frame）：只读徽标 = 流式布局，无 unpin 入口
    render(<PropsForm node={statNode} onPropsChange={() => {}} onUnpin={() => {}} />);
    const flowBadge = screen.getByTestId("props-positioning");
    expect(flowBadge).toHaveTextContent("流式布局");
    expect(flowBadge).toHaveAttribute("data-positioning", "flow");
    expect(screen.queryByTestId("props-unpin")).toBeNull();
    cleanup();

    // 自由定位（pinned && frame）：徽标 = 自由定位，入口出现且回调节点 id
    const pinnedNode = {
      id: "pinned",
      type: "StatCard",
      props: { label: "GMV", value: "1,200", delta: "+12%", tone: "brand" },
      children: [],
      pinned: true,
      frame: { x: 10, y: 20, w: 200, h: 80, rotation: 0 },
    };
    const onUnpin = vi.fn();
    render(<PropsForm node={pinnedNode} onPropsChange={() => {}} onUnpin={onUnpin} />);
    const pinBadge = screen.getByTestId("props-positioning");
    expect(pinBadge).toHaveTextContent("自由定位");
    expect(pinBadge).toHaveAttribute("data-positioning", "pinned");
    fireEvent.click(screen.getByTestId("props-unpin"));
    expect(onUnpin).toHaveBeenCalledWith("pinned");
  });
});

describe("PropsForm 预设 chips（W4-B）", () => {
  const btnNode = {
    id: "btn",
    type: "Button",
    props: { label: "保存", variant: "primary", size: "md" },
    children: [],
  };

  it("选中 Button 渲染 4 个预设 chip", () => {
    render(<PropsForm node={btnNode} onPropsChange={() => {}} />);
    for (const id of ["cta", "quiet", "destructive", "secondary-standard"]) {
      expect(screen.getByTestId(`preset-chip-${id}`)).toBeInTheDocument();
    }
  });

  it("点击 destructive：onPropsChange 收到 variant=danger 且 label 不被覆盖", async () => {
    const user = userEvent.setup();
    const onPropsChange = vi.fn();
    render(<PropsForm node={btnNode} onPropsChange={onPropsChange} />);
    await user.click(screen.getByTestId("preset-chip-destructive"));
    expect(onPropsChange).toHaveBeenCalledTimes(1);
    expect(onPropsChange).toHaveBeenCalledWith({ label: "保存", variant: "danger", size: "md" });
  });

  it("点击多键预设 cta：variant/size 并入，label 保留（局部合并语义）", async () => {
    const user = userEvent.setup();
    const onPropsChange = vi.fn();
    render(<PropsForm node={btnNode} onPropsChange={onPropsChange} />);
    await user.click(screen.getByTestId("preset-chip-cta"));
    expect(onPropsChange).toHaveBeenCalledWith({ label: "保存", variant: "primary", size: "lg" });
  });

  it("无预设组件（Input）不渲染 chip 行", () => {
    render(
      <PropsForm
        node={{ id: "in", type: "Input", props: { placeholder: "x", type: "text" }, children: [] }}
        onPropsChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("preset-row")).toBeNull();
    expect(screen.queryByTestId(/^preset-chip-/)).toBeNull();
  });
});

describe("InsertMenu", () => {
  it("按 category 分组渲染全部注册组件，点击回调 type", async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(<InsertMenu onInsert={onInsert} />);
    // 分组标题：布局/内容/数据/反馈（“表单”与组件 Form 的 title 同名，用标题级查询避免歧义）
    for (const g of ["布局", "内容", "数据", "反馈"]) {
      expect(screen.getByText(g)).toBeInTheDocument();
    }
    expect(screen.getAllByText("表单").length).toBeGreaterThanOrEqual(1);
    await user.click(screen.getByRole("button", { name: "插入 指标卡" }));
    expect(onInsert).toHaveBeenCalledWith("StatCard");
    await user.click(screen.getByRole("button", { name: "插入 应用外壳" }));
    expect(onInsert).toHaveBeenCalledWith("AppShell");
  });
});

describe("RightPanel 三页签", () => {
  const noop = () => {};
  function renderPanel(doc: StudioDocument = docAsWhole(treeDoc()), selectedId: string | null = "stat") {
    return render(
      <RightPanel
        doc={doc}
        selectedId={selectedId}
        onSelect={noop}
        onSetToken={noop}
        onPropsChange={noop}
        onInsert={noop}
        onRemove={noop}
      />,
    );
  }

  it("页签切换：属性/Token/图层 role=tablist", async () => {
    const user = userEvent.setup();
    renderPanel();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["属性", "Token", "图层", "检查"]);
    // 默认属性页：PropsForm 显示选中节点的字段
    expect(screen.getByLabelText("label")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Token" }));
    expect(screen.getByLabelText("品牌色")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "图层" }));
    expect(screen.getByRole("tree")).toBeInTheDocument();
  });

  it("未选中节点时属性页显示提示文案", async () => {
    renderPanel(docAsWhole(treeDoc()), null);
    expect(screen.getByText(/未选中|请选择/)).toBeInTheDocument();
    // 属性页仍提供插入菜单（无选中时默认展开）
    expect(screen.getByRole("button", { name: "插入 指标卡" })).toBeInTheDocument();
  });

  it("选中节点时插入组件区默认折叠且可展开（aria-expanded）", async () => {
    const user = userEvent.setup();
    renderPanel();
    // 属性优先：目录默认折叠，仅保留折叠开关
    const toggle = screen.getByRole("button", { name: "插入组件" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "插入 指标卡" })).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "插入 指标卡" })).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByRole("button", { name: "插入 指标卡" })).toBeNull();
  });

  it("保持 aria-label=属性 的 aside 结构", () => {
    renderPanel();
    expect(screen.getByRole("complementary", { name: "属性" })).toBeInTheDocument();
  });

  it("projectType 默认 ui：doc=null 仍显示「尚未打开项目」", () => {
    render(<RightPanel doc={null} />);
    expect(screen.getByText("尚未打开项目。")).toBeInTheDocument();
  });
});

describe("PropsForm SvgBox textarea（W5 T73）", () => {
  const svgNode = {
    id: "svg",
    type: "SvgBox",
    props: { source: '<svg viewBox="0 0 24 24"><circle/></svg>', alt: "图标" },
    children: [],
  };

  it("选中 SvgBox：source 渲染 8 行 textarea（非单行 input），alt 仍为单行", () => {
    render(<PropsForm node={svgNode} onPropsChange={() => {}} />);
    const ta = screen.getByTestId("props-svg-source");
    expect(ta.tagName).toBe("TEXTAREA");
    expect(ta).toHaveAttribute("rows", "8");
    expect(ta).toHaveValue(svgNode.props.source);
    // SvgBox 的其他 string 字段不受影响
    const alt = screen.getByLabelText("alt");
    expect(alt.tagName).toBe("INPUT");
    expect(alt).toHaveAttribute("type", "text");
  });

  it("textarea 输入触发 onPropsChange 收到更新 source", () => {
    const onPropsChange = vi.fn();
    render(<PropsForm node={svgNode} onPropsChange={onPropsChange} />);
    const next = '<svg viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22"/></svg>';
    fireEvent.change(screen.getByTestId("props-svg-source"), { target: { value: next } });
    expect(onPropsChange).toHaveBeenCalledWith(
      expect.objectContaining({ source: next, alt: "图标" }),
    );
  });

  it("回归：非 SvgBox 的 string 字段（Button label）仍是单行 input", () => {
    render(
      <PropsForm
        node={{ id: "btn", type: "Button", props: { label: "保存", variant: "primary", size: "md" }, children: [] }}
        onPropsChange={() => {}}
      />,
    );
    const label = screen.getByLabelText("label");
    expect(label.tagName).toBe("INPUT");
    expect(label).toHaveAttribute("type", "text");
    expect(screen.queryByTestId("props-svg-source")).toBeNull();
  });
});
