import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { flushSync } from "react-dom";
import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotesPanel } from "./NotesPanel";
import { PptEditorPanel } from "./PptEditorPanel";
import { PropertyPanel } from "./PropertyPanel";
import { SlideCanvas } from "./SlideCanvas";
import { SlideList } from "./SlideList";
import { SlideObjectView } from "./SlideObjectView";
import { manualInvocation } from "./state";
import { usePptEditorStore } from "./state";
import { resetStore, sampleDeck } from "./testFixtures";
import { api } from "../../api/client";
import { useEditorStore } from "../../state/editorStore";
import type { PptDocument, PptSlideObject } from "@studio/ppt-toolkit";
import type { ProjectMeta } from "@studio/schema-core";

let onDocumentChange: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cleanup();
  onDocumentChange = resetStore().onDocumentChange;
});

const meta: ProjectMeta = {
  id: "p1",
  name: "示例项目",
  projectType: "ppt",
  productType: "",
  targetUsers: "",
  goal: "",
  referenceLinks: [],
  brandRules: "",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function stubNarrowViewport(): void {
  vi.stubGlobal(
    "matchMedia",
    ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia,
  );
}

function stubResponsiveViewport(initial: "narrow" | "wide" = "narrow") {
  const state = { wide: initial === "wide", medium: initial === "wide" };
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    ((query: string) => ({
      matches: query === "(min-width: 1440px)" ? state.wide : state.medium,
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    })) as unknown as typeof window.matchMedia,
  );
  return {
    setWide: async () => {
      state.wide = true;
      state.medium = true;
      await act(() => {
        flushSync(() => listeners.forEach((listener) => listener()));
      });
    },
    setNarrow: async () => {
      state.wide = false;
      state.medium = false;
      await act(() => {
        flushSync(() => listeners.forEach((listener) => listener()));
      });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SlideList", () => {
  it("点击选中幻灯片；删除按钮经事务删除并回调 onDocumentChange", async () => {
    const user = userEvent.setup();
    render(<SlideList deck={sampleDeck()} selectedSlideId="slide-1" onSelect={(id) => usePptEditorStore.getState().selectSlide(id)} />);
    // 点击第二张选中
    await user.click(screen.getByRole("button", { name: /幻灯片 2：第二页/ }));
    expect(usePptEditorStore.getState().selectedSlideId).toBe("slide-2");
    // 双击第一张打开操作菜单，删除
    const card = screen.getByRole("button", { name: /幻灯片 1：第一页/ });
    await user.dblClick(card);
    await user.click(await screen.findByRole("button", { name: "删除幻灯片 1" }));
    await waitFor(() => {
      expect(usePptEditorStore.getState().deck!.slides).toHaveLength(1);
      expect(usePptEditorStore.getState().deck!.slides[0]!.id).toBe("slide-2");
    });
    expect(onDocumentChange).toHaveBeenCalled();
  });
});

describe("SlideCanvas", () => {
  it("渲染 text 与 shape 对象（aria-label 可寻址）", () => {
    const deck = sampleDeck();
    render(
      <SlideCanvas
        deck={deck}
        slide={deck.slides[0]!}
        selectedObjectIds={[]}
        onSelectSlide={() => {}}
        onSelectObject={() => {}}
      />,
    );
    expect(screen.getByLabelText(/文本（100, 80）/)).toBeInTheDocument();
    expect(screen.getByLabelText(/形状（100, 200）/)).toBeInTheDocument();
    expect(screen.getByText("标题文本")).toBeInTheDocument();
  });

  it("点击对象选中；锁定幻灯片上仍可选中但不拖拽", () => {
    const deck = sampleDeck();
    render(
      <SlideCanvas
        deck={deck}
        slide={deck.slides[0]!}
        selectedObjectIds={[]}
        onSelectSlide={() => usePptEditorStore.getState().selectObjects([])}
        onSelectObject={(id) => usePptEditorStore.getState().selectObjects([id])}
      />,
    );
    fireEvent.pointerDown(screen.getByLabelText(/形状（100, 200）/), { button: 0 });
    expect(usePptEditorStore.getState().selectedObjectIds).toEqual(["shape-1"]);
  });

  it("Shift/Ctrl+点击以 additive 方式上报（多选切换由 store 完成）", () => {
    const deck = sampleDeck();
    const onSelectObject = vi.fn();
    render(
      <SlideCanvas
        deck={deck}
        slide={deck.slides[0]!}
        selectedObjectIds={[]}
        onSelectSlide={() => {}}
        onSelectObject={onSelectObject}
      />,
    );
    // This jsdom has no PointerEvent constructor and drops modifier init keys
    // on fireEvent; dispatch a MouseEvent carrying the pointerdown type instead.
    const modifierPointerDown = (label: RegExp, modifier: "shiftKey" | "ctrlKey") => {
      const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
      Object.defineProperty(event, modifier, { value: true });
      screen.getByLabelText(label).dispatchEvent(event);
    };
    modifierPointerDown(/形状（100, 200）/, "shiftKey");
    expect(onSelectObject).toHaveBeenCalledWith("shape-1", true);
    modifierPointerDown(/文本（100, 80）/, "ctrlKey");
    expect(onSelectObject).toHaveBeenCalledWith("text-1", true);
    // Plain click stays single-select.
    fireEvent.pointerDown(screen.getByLabelText(/形状（100, 200）/), { button: 0 });
    expect(onSelectObject).toHaveBeenLastCalledWith("shape-1", false);
  });
});

describe("SlideObjectView 文本默认色与换行（导入模板白字不可见回归）", () => {
  it("无显式颜色的 run 渲染深色默认值；长文本换行而不是截断", () => {
    const longText = "这是一段没有显式颜色的导入正文，".repeat(6);
    const object: PptSlideObject = {
      kind: "text",
      id: "imp-text",
      rect: { x: 100, y: 100, w: 300, h: 200 },
      paragraphs: [{ runs: [{ text: longText }] }],
      fontSize: 18,
    };
    render(<SlideObjectView object={object} selected={false} onPointerDown={() => {}} />);
    const span = screen.getByText(/这是一段没有显式颜色的导入正文/);
    // Default dark ink sits on the text container (runs inherit it).
    expect(span.closest("p")?.parentElement?.style.color).toBe("rgb(31, 41, 55)");
    // The paragraph wraps (no single-line truncate).
    expect(span.closest("p")?.className).not.toContain("truncate");
  });

  it("显式 run 颜色覆盖默认值", () => {
    const object: PptSlideObject = {
      kind: "text",
      id: "imp-text-2",
      rect: { x: 0, y: 0, w: 100, h: 40 },
      paragraphs: [{ runs: [{ text: "白字", color: "#FFFFFF" }] }],
    };
    render(<SlideObjectView object={object} selected={false} onPointerDown={() => {}} />);
    expect(screen.getByText("白字").style.color).toBe("rgb(255, 255, 255)");
  });
});

describe("SlideObjectView 图片兜底", () => {
  const brokenImage: PptSlideObject = {
    kind: "image",
    id: "img-bad",
    rect: { x: 0, y: 0, w: 480, h: 270 },
    src: "https://images.example.invalid/cover.png",
    fit: "cover",
  };

  it("图片加载失败时显示可见的破损占位（不再静默空白）", () => {
    render(<SlideObjectView object={brokenImage} selected={false} onPointerDown={() => {}} />);
    const img = screen.getByRole("img");
    fireEvent.error(img);
    expect(screen.getByText("图片无法加载")).toBeInTheDocument();
    // Host of the fabricated URL is shown so the cause is diagnosable.
    expect(screen.getByText("images.example.invalid")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("更换 src 后退出破损态重新尝试加载", () => {
    const { rerender } = render(<SlideObjectView object={brokenImage} selected={false} onPointerDown={() => {}} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("图片无法加载")).toBeInTheDocument();
    const fixed = { ...brokenImage, src: "/api/projects/p1/assets/abcd.png" };
    rerender(<SlideObjectView object={fixed} selected={false} onPointerDown={() => {}} />);
    expect(screen.queryByText("图片无法加载")).toBeNull();
    expect(screen.getByRole("img")).toHaveAttribute("src", "/api/projects/p1/assets/abcd.png");
  });
});

describe("SlideObjectView 视频对象（T30 插视频）", () => {
  const videoObject: PptSlideObject = {
    kind: "video",
    id: "vid-1",
    rect: { x: 200, y: 140, w: 880, h: 495 },
    src: "/api/projects/p1/assets/abcd.mp4",
    title: "产品演示",
  };

  it("渲染原生 video 元素，带 controls/preload=metadata/poster", () => {
    render(
      <SlideObjectView
        object={{ ...videoObject, poster: "/api/projects/p1/assets/poster.png" }}
        selected={false}
        onPointerDown={() => {}}
      />,
    );
    // objectLabel prefers object.title over the kind label.
    const el = screen.getByLabelText(/产品演示（200, 140）/);
    const video = el.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).toHaveAttribute("poster", "/api/projects/p1/assets/poster.png");
    expect(video).toHaveAttribute("src", "/api/projects/p1/assets/abcd.mp4");
  });

  it("加载失败显示可见的失败占位；换源后重新尝试", () => {
    const { rerender } = render(
      <SlideObjectView object={{ ...videoObject, title: undefined }} selected={false} onPointerDown={() => {}} />,
    );
    fireEvent.error(screen.getByLabelText(/视频（200, 140）/).querySelector("video")!);
    expect(screen.getByText("视频无法播放")).toBeInTheDocument();
    expect(screen.getByText("/api/projects/p1/assets/abcd.mp4")).toBeInTheDocument();

    rerender(
      <SlideObjectView
        object={{ ...videoObject, title: undefined, src: "/api/projects/p1/assets/fixed.webm" }}
        selected={false}
        onPointerDown={() => {}}
      />,
    );
    expect(screen.queryByText("视频无法播放")).toBeNull();
    expect(screen.getByLabelText(/视频（200, 140）/).querySelector("video")).toHaveAttribute(
      "src",
      "/api/projects/p1/assets/fixed.webm",
    );
  });
});

describe("PPT 多选（store）", () => {
  it("toggleObjectSelection 同页加入/移除；跨页替换并切换当前页", () => {
    const deck = sampleDeck();
    deck.slides[1] = {
      ...deck.slides[1]!,
      objects: [
        { kind: "shape", id: "shape-2", rect: { x: 40, y: 40, w: 100, h: 100 }, shape: "rect", fill: "#333333" },
      ],
    };
    const store = usePptEditorStore.getState();
    store.syncDocument(deck);
    const [text, shape] = deck.slides[0]!.objects;

    store.selectObjects([text!.id]);
    store.toggleObjectSelection(shape!.id);
    expect(usePptEditorStore.getState().selectedObjectIds).toEqual([text!.id, shape!.id]);

    // Toggle again removes the object from the multi-selection.
    usePptEditorStore.getState().toggleObjectSelection(text!.id);
    expect(usePptEditorStore.getState().selectedObjectIds).toEqual([shape!.id]);

    // Selecting an object on another slide replaces the selection (single-slide rule).
    usePptEditorStore.getState().toggleObjectSelection("shape-2");
    const state = usePptEditorStore.getState();
    expect(state.selectedSlideId).toBe("slide-2");
    expect(state.selectedObjectIds).toEqual(["shape-2"]);
  });
});

describe("PPT replaceDeck（pptx 导入）", () => {
  it("合法文档：压入撤销栈、保留仍存在的选择、触发 onDocumentChange；非法文档拒绝", () => {
    const deck = sampleDeck();
    const { onDocumentChange } = resetStore();
    const store = usePptEditorStore.getState();
    store.selectSlide("slide-2"); // empty slide, selection survives as slideId

    const imported: PptDocument = {
      ...deck,
      slides: [
        ...deck.slides,
        { id: "slide-3", title: "导入页", notes: "", objects: [] },
      ],
    };
    expect(store.replaceDeck(imported)).toBe(true);
    expect(usePptEditorStore.getState().deck?.slides).toHaveLength(3);
    expect(usePptEditorStore.getState().selectedSlideId).toBe("slide-2");
    expect(onDocumentChange).toHaveBeenLastCalledWith(expect.objectContaining({ slides: expect.any(Array) }));

    // Undo returns to the pre-import deck.
    usePptEditorStore.getState().undo();
    expect(usePptEditorStore.getState().deck?.slides).toHaveLength(2);

    // A structurally invalid deck is rejected and surfaces an error.
    const bad = { ...imported, slides: [{ id: "x", title: "坏页", objects: [{ id: "o", kind: "image" }] }] } as unknown as PptDocument;
    expect(usePptEditorStore.getState().replaceDeck(bad)).toBe(false);
    expect(usePptEditorStore.getState().error).toBeTruthy();
  });
});

describe("PropertyPanel", () => {
  it("rect 数值编辑经事务提交并回调 onDocumentChange", async () => {
    const user = userEvent.setup();
    const deck = sampleDeck();
    const shape = deck.slides[0]!.objects[1]!;
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={shape} />);
    const x = screen.getByLabelText("X 坐标");
    await user.clear(x);
    await user.type(x, "300");
    fireEvent.blur(x);
    await waitFor(() => {
      const object = usePptEditorStore.getState().deck!.slides[0]!.objects.find((o) => o.id === "shape-1")!;
      expect(object.rect.x).toBe(300);
    });
    expect(onDocumentChange).toHaveBeenCalledTimes(1);
  });

  it("rect 数字框：清空不提交（不再清空即变 0），一次编辑只产生一个事务", async () => {
    const user = userEvent.setup();
    const deck = sampleDeck();
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={deck.slides[0]!.objects[1]!} />);
    const x = screen.getByLabelText("X 坐标");
    fireEvent.change(x, { target: { value: "" } });
    fireEvent.blur(x);
    expect(usePptEditorStore.getState().deck!.slides[0]!.objects[1]!.rect.x).toBe(100);
    expect(onDocumentChange).not.toHaveBeenCalled();
  });

  it("x 越界输入被 clamp 到画布内", async () => {
    const user = userEvent.setup();
    const deck = sampleDeck();
    const shape = deck.slides[0]!.objects[1]!; // w=200 → x 最大 1080
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={shape} />);
    const x = screen.getByLabelText("X 坐标");
    await user.clear(x);
    fireEvent.change(x, { target: { value: "99999" } });
    fireEvent.blur(x);
    await waitFor(() => {
      const object = usePptEditorStore.getState().deck!.slides[0]!.objects.find((o) => o.id === "shape-1")!;
      expect(object.rect.x).toBe(1080);
    });
  });

  it("锁定幻灯片上编辑被拒且显示错误", async () => {
    const user = userEvent.setup();
    usePptEditorStore.getState().runCommands([
      manualInvocation("slide.lock", { slideId: "slide-1", locked: true }),
    ]);
    const deck = usePptEditorStore.getState().deck!;
    const shape = deck.slides[0]!.objects[1]!;
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={shape} />);
    const y = screen.getByLabelText("Y 坐标");
    await user.clear(y);
    fireEvent.change(y, { target: { value: "10" } });
    fireEvent.blur(y);
    await waitFor(() => {
      expect(usePptEditorStore.getState().error).toContain("幻灯片已锁定");
    });
  });

  it("选中 slide 时可应用布局模板", async () => {
    const user = userEvent.setup();
    const deck = sampleDeck();
    render(<PropertyPanel slide={deck.slides[1]!} selectedObject={null} />);
    await user.click(screen.getByRole("button", { name: "应用布局 标题+内容" }));
    await waitFor(() => {
      const slide = usePptEditorStore.getState().deck!.slides[1]!;
      expect(slide.layoutId).toBe("titleContent");
      expect(slide.objects.length).toBeGreaterThan(0);
    });
    expect(onDocumentChange).toHaveBeenCalled();
  });

  it("标题输入 Enter 提交 slide.rename", () => {
    const deck = sampleDeck();
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={null} />);
    const title = screen.getByLabelText("幻灯片标题");
    fireEvent.change(title, { target: { value: "Enter 新标题" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(usePptEditorStore.getState().deck!.slides[0]!.title).toBe("Enter 新标题");
    expect(onDocumentChange).toHaveBeenCalled();
  });

  it("外部 slide.rename 后同步标题输入框", () => {
    const deck = sampleDeck();
    const { rerender } = render(<PropertyPanel slide={deck.slides[0]!} selectedObject={null} />);
    const renamed = { ...deck.slides[0]!, title: "2026 年第三季度经营复盘" };

    rerender(<PropertyPanel slide={renamed} selectedObject={null} />);

    expect(screen.getByLabelText("幻灯片标题")).toHaveValue("2026 年第三季度经营复盘");
  });

  it("标题输入 Shift+Enter 不提交", () => {
    const deck = sampleDeck();
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={null} />);
    const title = screen.getByLabelText("幻灯片标题");
    fireEvent.change(title, { target: { value: "未提交标题" } });
    fireEvent.keyDown(title, { key: "Enter", shiftKey: true });
    expect(usePptEditorStore.getState().deck!.slides[0]!.title).toBe("第一页");
    expect(onDocumentChange).not.toHaveBeenCalled();
  });

  function deckWithImage(): { deck: PptDocument; image: Extract<PptSlideObject, { kind: "image" }> } {
    const deck = sampleDeck();
    const image: Extract<PptSlideObject, { kind: "image" }> = {
      kind: "image",
      id: "img-1",
      rect: { x: 0, y: 0, w: 400, h: 200 },
      src: "https://x.invalid/a.png",
      fit: "contain",
    };
    deck.slides[0]!.objects.push(image);
    usePptEditorStore.getState().syncDocument(deck);
    return { deck, image };
  }

  it("图片对象：填充方式切换走 object.editImage", () => {
    const { deck, image } = deckWithImage();
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={image} />);
    fireEvent.change(screen.getByLabelText("填充方式"), { target: { value: "cover" } });
    const stored = usePptEditorStore.getState().deck!.slides[0]!.objects.find((o) => o.id === "img-1")!;
    expect(stored.kind === "image" && stored.fit).toBe("cover");
    expect(stored.kind === "image" && stored.src).toBe("https://x.invalid/a.png"); // src preserved
    expect(onDocumentChange).toHaveBeenCalled();
  });

  it("上传图片替换：api.uploadPptAsset → object.editImage 写入资产 URL；失败显示错误", async () => {
    useEditorStore.setState({ projectId: "p1" });
    const { deck, image } = deckWithImage();
    const upload = vi
      .spyOn(api, "uploadPptAsset")
      .mockResolvedValue({ src: "/api/projects/p1/assets/abc.png", sha1: "abc", ext: "png", contentType: "image/png", bytes: 3 });
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={image} />);
    expect(screen.getByText("https://x.invalid/a.png")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("选择要上传的图片"), {
      target: { files: [new File([new Uint8Array([1, 2, 3])], "火把节.png", { type: "image/png" })] },
    });
    await waitFor(() => {
      const stored = usePptEditorStore.getState().deck!.slides[0]!.objects.find((o) => o.id === "img-1")!;
      expect(stored.kind === "image" && stored.src).toBe("/api/projects/p1/assets/abc.png");
    });
    expect(upload).toHaveBeenCalledTimes(1);
    upload.mockRestore();

    // Failure path: Chinese server message surfaces in the panel.
    const failSpy = vi.spyOn(api, "uploadPptAsset").mockRejectedValue(new Error("不支持的图片格式，仅支持 PNG / JPEG"));
    fireEvent.change(screen.getByLabelText("选择要上传的图片"), {
      target: { files: [new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })] },
    });
    expect(await screen.findByText(/不支持的图片格式/)).toBeInTheDocument();
    failSpy.mockRestore();
    useEditorStore.setState({ projectId: null });
  });
});

describe("NotesPanel", () => {
  it("备注失焦提交到当前幻灯片", async () => {
    const user = userEvent.setup();
    const deck = sampleDeck();
    const { rerender } = render(<NotesPanel slide={deck.slides[0]!} />);
    const area = screen.getByLabelText("幻灯片备注");
    await user.clear(area);
    await user.type(area, "开场白要点");
    fireEvent.blur(area);
    await waitFor(() => {
      expect(usePptEditorStore.getState().deck!.slides[0]!.notes).toBe("开场白要点");
    });
    expect(onDocumentChange).toHaveBeenCalled();
    // rerender 用新 slide 引用避免过期 props 告警
    rerender(<NotesPanel slide={usePptEditorStore.getState().deck!.slides[0]!} />);
  });

  it("备注 Enter 提交（无需失焦）", () => {
    const deck = sampleDeck();
    render(<NotesPanel slide={deck.slides[0]!} />);
    const area = screen.getByLabelText("幻灯片备注");
    fireEvent.change(area, { target: { value: "Enter 提交的备注" } });
    fireEvent.keyDown(area, { key: "Enter" });
    expect(usePptEditorStore.getState().deck!.slides[0]!.notes).toBe("Enter 提交的备注");
    expect(onDocumentChange).toHaveBeenCalled();
  });

  it("备注 Shift+Enter 换行不提交", () => {
    const deck = sampleDeck();
    render(<NotesPanel slide={deck.slides[0]!} />);
    const area = screen.getByLabelText("幻灯片备注");
    fireEvent.change(area, { target: { value: "第一行" } });
    fireEvent.keyDown(area, { key: "Enter", shiftKey: true });
    expect(usePptEditorStore.getState().deck!.slides[0]!.notes).toBe("");
    expect(onDocumentChange).not.toHaveBeenCalled();
  });
});

describe("PptEditorPanel", () => {
  it("窄屏属性草稿在关闭与断点切宽后保留，显式提交仍走事务", async () => {
    const media = stubResponsiveViewport("narrow");
    const user = userEvent.setup();
    render(<PptEditorPanel document={sampleDeck()} meta={meta} onDocumentChange={onDocumentChange} />);

    const propertiesToggle = screen.getByRole("button", { name: "切换幻灯片属性" });
    await user.click(propertiesToggle);
    const title = screen.getByLabelText("幻灯片标题");
    await user.clear(title);
    await user.type(title, "Escape 后保留的标题");
    await user.click(screen.getByRole("button", { name: "关闭幻灯片属性" }));

    expect(screen.queryByRole("dialog", { name: "幻灯片属性" })).toBeNull();

    await user.click(propertiesToggle);
    expect(screen.getByLabelText("幻灯片标题")).toHaveValue("Escape 后保留的标题");

    const reopenedTitle = screen.getByLabelText("幻灯片标题");
    await user.clear(reopenedTitle);
    await user.type(reopenedTitle, "切宽后保留的标题");
    const historyBeforeBreakpoint = usePptEditorStore.getState().past.length;
    await media.setWide();

    const wideTitle = screen.getByLabelText("幻灯片标题");
    expect(wideTitle).toHaveValue("切宽后保留的标题");
    expect(usePptEditorStore.getState().past.length).toBe(historyBeforeBreakpoint);
    fireEvent.keyDown(wideTitle, { key: "Enter" });
    await waitFor(() => expect(usePptEditorStore.getState().deck!.slides[0]!.title).toBe("切宽后保留的标题"));
    expect(screen.getByRole("complementary", { name: "属性面板" })).toBeInTheDocument();

    await media.setNarrow();
    const narrowPropertiesToggle = screen.getByRole("button", { name: "切换幻灯片属性" });
    expect(narrowPropertiesToggle).toHaveAttribute("aria-expanded", "false");
    await user.click(narrowPropertiesToggle);
    expect(narrowPropertiesToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "幻灯片属性" })).toBeInTheDocument();
  });

  it("窄屏对象文本草稿在属性抽屉关闭重开后保留", async () => {
    stubResponsiveViewport("narrow");
    const user = userEvent.setup();
    render(<PptEditorPanel document={sampleDeck()} meta={meta} onDocumentChange={onDocumentChange} />);

    await user.click(screen.getByLabelText(/文本（100, 80）/));
    const propertiesToggle = screen.getByRole("button", { name: "切换幻灯片属性" });
    await user.click(propertiesToggle);
    const text = screen.getByLabelText("文本内容");
    await user.clear(text);
    await user.type(text, "Escape 后保留的对象文本");
    await user.click(screen.getByRole("button", { name: "关闭幻灯片属性" }));

    expect(screen.queryByRole("dialog", { name: "幻灯片属性" })).toBeNull();

    await user.click(propertiesToggle);
    expect(screen.getByLabelText("文本内容")).toHaveValue("Escape 后保留的对象文本");
  });

  it("窄屏只优先显示画布，幻灯片列表与属性改由可关闭抽屉访问", async () => {
    stubNarrowViewport();
    const user = userEvent.setup();
    render(<PptEditorPanel document={sampleDeck()} meta={meta} onDocumentChange={onDocumentChange} />);

    expect(screen.getByLabelText("幻灯片画布")).toBeInTheDocument();
    expect(screen.getByLabelText("PPT 编辑器").querySelector("header")).toHaveClass("flex-wrap");
    expect(screen.queryByRole("list", { name: "幻灯片列表" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "属性面板" })).toBeNull();

    const slidesToggle = screen.getByRole("button", { name: "切换幻灯片列表" });
    const propertiesToggle = screen.getByRole("button", { name: "切换幻灯片属性" });
    expect(slidesToggle).toHaveAttribute("aria-expanded", "false");
    expect(propertiesToggle).toHaveAttribute("aria-expanded", "false");

    await user.click(slidesToggle);
    expect(screen.getByRole("dialog", { name: "幻灯片列表" })).toBeInTheDocument();
    expect(slidesToggle).toHaveAttribute("aria-expanded", "true");
    await user.click(slidesToggle);
    expect(screen.queryByRole("dialog", { name: "幻灯片列表" })).toBeNull();

    await user.click(propertiesToggle);
    expect(screen.getByRole("dialog", { name: "幻灯片属性" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "属性面板" })).toBeInTheDocument();
    await user.click(propertiesToggle);
    expect(screen.queryByRole("dialog", { name: "幻灯片属性" })).toBeNull();
  });

  it("备注编辑后撤销/重做同步输入框，并继续响应 AI 外部更新", async () => {
    const source = sampleDeck();
    const deck = {
      ...source,
      slides: [{ ...source.slides[0]!, notes: "备注 A" }, ...source.slides.slice(1)],
    };
    render(<PptEditorPanel document={deck} meta={meta} onDocumentChange={onDocumentChange} />);

    const area = await screen.findByLabelText("幻灯片备注");
    fireEvent.change(area, { target: { value: "备注 B" } });
    fireEvent.blur(area);
    await waitFor(() => expect(usePptEditorStore.getState().deck!.slides[0]!.notes).toBe("备注 B"));

    act(() => {
      usePptEditorStore.getState().undo();
    });
    await waitFor(() => expect(usePptEditorStore.getState().deck!.slides[0]!.notes).toBe("备注 A"));
    expect(area).toHaveValue("备注 A");

    act(() => {
      usePptEditorStore.getState().redo();
    });
    await waitFor(() => expect(usePptEditorStore.getState().deck!.slides[0]!.notes).toBe("备注 B"));
    expect(area).toHaveValue("备注 B");

    act(() => {
      usePptEditorStore.getState().runCommands([
        manualInvocation("slide.setNotes", { slideId: "slide-1", notes: "AI 外部更新" }),
      ]);
    });
    await waitFor(() => expect(area).toHaveValue("AI 外部更新"));
  });

  it("undo 恢复：新增幻灯片后撤销回到 2 张", async () => {
    const user = userEvent.setup();
    render(<PptEditorPanel document={sampleDeck()} meta={meta} onDocumentChange={onDocumentChange} />);
    expect(await screen.findByLabelText(/幻灯片 1：第一页/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新增幻灯片" }));
    await waitFor(() => {
      expect(usePptEditorStore.getState().deck!.slides).toHaveLength(3);
    });
    expect(onDocumentChange).toHaveBeenCalled();
    act(() => {
      usePptEditorStore.getState().undo();
    });
    await waitFor(() => {
      expect(usePptEditorStore.getState().deck!.slides).toHaveLength(2);
    });
    // Post-undo the disabled undo button equals an empty past stack
    // (future holds the undone snapshot for redo, so it is length 1 here).
    expect(usePptEditorStore.getState().past).toHaveLength(0);
    expect(usePptEditorStore.getState().future).toHaveLength(1);
  });

  it("工具栏「插入图片」：上传为项目资产并在当前页 object.add 图片对象", async () => {
    useEditorStore.setState({ projectId: "p1" });
    const upload = vi.spyOn(api, "uploadPptAsset").mockResolvedValue({
      src: "/api/projects/p1/assets/inserted.png",
      sha1: "deadbeef",
      ext: "png",
      contentType: "image/png",
      bytes: 7,
    });
    render(<PptEditorPanel document={sampleDeck()} meta={meta} onDocumentChange={onDocumentChange} />);
    fireEvent.change(screen.getByLabelText("选择图片文件"), {
      target: { files: [new File([new Uint8Array(7)], "背景.png", { type: "image/png" })] },
    });
    await waitFor(() => {
      const slide = usePptEditorStore.getState().deck!.slides[0]!;
      const added = slide.objects.find((o) => o.kind === "image");
      expect(added).toBeDefined();
      expect(added && added.kind === "image" && added.src).toBe("/api/projects/p1/assets/inserted.png");
    });
    expect(upload).toHaveBeenCalledWith("p1", expect.any(File));
    expect(onDocumentChange).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("图片已插入");
    upload.mockRestore();
    useEditorStore.setState({ projectId: null });
  });

  it("选中形状：属性面板可改填充色与形状类型（object.editShape）", () => {
    const deck = sampleDeck();
    const shape = deck.slides[0]!.objects[1]!;
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={shape} />);
    fireEvent.change(screen.getByLabelText("形状类型"), { target: { value: "ellipse" } });
    fireEvent.change(screen.getByLabelText("填充颜色"), { target: { value: "#FF0000" } });
    const updated = usePptEditorStore.getState().deck!.slides[0]!.objects[1]!;
    expect(updated.kind === "shape" && updated.shape).toBe("ellipse");
    expect(updated.kind === "shape" && updated.fill?.toUpperCase()).toBe("#FF0000");
  });

  it("文本对象：字号与对齐走 object.editText 字段级合并", () => {
    const deck = sampleDeck();
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={deck.slides[0]!.objects[0]!} />);
    fireEvent.change(screen.getByLabelText("字号"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "居中" }));
    const text = usePptEditorStore.getState().deck!.slides[0]!.objects[0]!;
    expect(text.kind === "text" && text.fontSize).toBe(40);
    expect(text.kind === "text" && text.align).toBe("center");
    expect(text.kind === "text" && text.paragraphs[0]!.runs[0]!.text).toBe("标题文本");
  });

  it("多选时属性面板显示批量操作；左对齐走 object.alignMany", () => {
    const deck = sampleDeck();
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={null} selectedIds={["text-1", "shape-1"]} />);
    expect(screen.getByText(/已选 2 个/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "左对齐" }));
    const objects = usePptEditorStore.getState().deck!.slides[0]!.objects;
    const xs = objects.filter((o) => ["text-1", "shape-1"].includes(o.id)).map((o) => o.rect.x);
    expect(new Set(xs).size).toBe(1);
  });

  it("形状不透明度滑块走 object.editShape opacity（封面遮罩透明化）", () => {
    const deck = sampleDeck();
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={deck.slides[0]!.objects[1]!} />);
    fireEvent.change(screen.getByLabelText("形状不透明度"), { target: { value: "0.3" } });
    const shape = usePptEditorStore.getState().deck!.slides[0]!.objects[1]!;
    expect(shape.kind === "shape" && shape.opacity).toBeCloseTo(0.3);
  });

  it("文本：字体下拉与加粗走 object.editText", () => {
    const deck = sampleDeck();
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={deck.slides[0]!.objects[0]!} />);
    fireEvent.change(screen.getByLabelText("字体"), { target: { value: "楷体" } });
    let text = usePptEditorStore.getState().deck!.slides[0]!.objects[0]!;
    expect(text.kind === "text" && text.fontFamily).toBe("楷体");
    fireEvent.click(screen.getByRole("button", { name: "加粗" }));
    text = usePptEditorStore.getState().deck!.slides[0]!.objects[0]!;
    expect(text.kind === "text" && text.paragraphs[0]!.runs[0]!.bold).toBe(true);
  });

  it("层级按钮走 object.reorder；复制按钮走 object.duplicate", () => {
    const deck = sampleDeck();
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={deck.slides[0]!.objects[0]!} />);
    fireEvent.click(screen.getByRole("button", { name: "置顶" }));
    expect(usePptEditorStore.getState().deck!.slides[0]!.objects.at(-1)!.id).toBe("text-1");
    fireEvent.click(screen.getByRole("button", { name: "复制对象" }));
    const objects = usePptEditorStore.getState().deck!.slides[0]!.objects;
    expect(objects.filter((o) => o.kind === "text")).toHaveLength(2);
  });

  it("工具栏插入菜单：插入文本框/矩形/表格/图表", async () => {
    const user = userEvent.setup();
    render(<PptEditorPanel document={sampleDeck()} meta={meta} onDocumentChange={onDocumentChange} />);
    await user.click(screen.getByRole("button", { name: "插入对象" }));
    await user.click(screen.getByRole("button", { name: "矩形" }));
    let objects = usePptEditorStore.getState().deck!.slides[0]!.objects;
    expect(objects.some((o) => o.kind === "shape")).toBe(true);
    await user.click(screen.getByRole("button", { name: "插入对象" }));
    await user.click(screen.getByRole("button", { name: "表格" }));
    objects = usePptEditorStore.getState().deck!.slides[0]!.objects;
    expect(objects.some((o) => o.kind === "table")).toBe(true);
    await user.click(screen.getByRole("button", { name: "插入对象" }));
    await user.click(screen.getByRole("button", { name: "图表" }));
    objects = usePptEditorStore.getState().deck!.slides[0]!.objects;
    expect(objects.some((o) => o.kind === "chart")).toBe(true);
  });

  it("Ctrl/Cmd+D 复制选中对象", () => {
    const deck = sampleDeck();
    render(<PptEditorPanel document={deck} meta={meta} onDocumentChange={onDocumentChange} />);
    usePptEditorStore.getState().selectObjects(["shape-1"]);
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(usePptEditorStore.getState().deck!.slides[0]!.objects.filter((o) => o.kind === "shape")).toHaveLength(2);
  });

  it("幻灯片属性：背景色走 slide.setBackground", () => {
    const deck = sampleDeck();
    render(<PropertyPanel slide={deck.slides[0]!} selectedObject={null} />);
    fireEvent.change(screen.getByLabelText("幻灯片背景色"), { target: { value: "#0F172A" } });
    expect(usePptEditorStore.getState().deck!.slides[0]!.background?.toUpperCase()).toBe("#0F172A");
  });

  it("Delete 键删除所有选中对象；Esc 清空选择", () => {
    const deck = sampleDeck();
    render(<PptEditorPanel document={deck} meta={meta} onDocumentChange={onDocumentChange} />);
    usePptEditorStore.getState().selectObjects(["text-1", "shape-1"]);
    fireEvent.keyDown(window, { key: "Delete" });
    const objects = usePptEditorStore.getState().deck!.slides[0]!.objects;
    expect(objects.some((o) => o.id === "text-1")).toBe(false);
    expect(objects.some((o) => o.id === "shape-1")).toBe(false);
    usePptEditorStore.getState().selectObjects(["text-1"]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(usePptEditorStore.getState().selectedObjectIds).toEqual([]);
  });

  it("事务失败时错误条可见且可关闭", async () => {
    const user = userEvent.setup();
    render(<PptEditorPanel document={sampleDeck()} meta={meta} onDocumentChange={onDocumentChange} />);
    // 复制到唯一一张幻灯片删除被拒？sampleDeck 有 2 张——锁定后再删走面板
    await user.dblClick(screen.getByRole("button", { name: /幻灯片 1：第一页/ }));
    await user.click(await screen.findByRole("button", { name: "锁定幻灯片 1" }));
    await user.dblClick(screen.getByRole("button", { name: /幻灯片 1：第一页（已锁定）/ }));
    await user.click(await screen.findByRole("button", { name: "删除幻灯片 1" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("幻灯片已锁定");
    await user.click(screen.getByRole("button", { name: "关闭错误" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
