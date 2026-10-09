import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { defaultPage, defaultStudioDocument, type NodeRecord, type Page, type StudioDocument } from "@studio/schema-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeImageGenError, generateImage } from "../../api/imageGen";
import { ApiError } from "../../api/client";
import { useEditorStore } from "../../state/editorStore";
import { CanvasSurface } from "./CanvasSurface";
import { ImageGenPopover } from "./ImageGenPopover";
import { useImageGen } from "./useImageGen";
import { defaultTokens } from "@studio/schema-core";

/**
 * U7 workbench contract (design §5 D1-D4): entry visibility derives from the
 * masked settings probe + the selected node type; a successful generation
 * swaps the Image node src through ONE store applyOp (undo +1); a 501 hides
 * the entry but keeps the guidance banner; non-Image selections never show it.
 * All network is a stubbed global fetch — no server is started.
 */

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_SRC = `/api/projects/${PROJECT_ID}/assets/${"a".repeat(40)}.png`;

const F = { x: 100, y: 100, w: 200, h: 120, rotation: 0 };

function imageDoc(): StudioDocument {
  const page: Page = {
    ...defaultPage("图像页"),
    nodes: [
      { id: "root", type: "Container", props: {}, children: ["img", "txt"] },
      { id: "img", type: "Image", props: { src: "", alt: "占位图" }, children: [], frame: F, pinned: true },
      { id: "txt", type: "Text", props: { content: "说明文字" }, children: [], frame: F, pinned: true },
    ],
  };
  return { ...defaultStudioDocument("图像文档"), pages: [page] };
}

function settingsResponse(available: boolean): Response {
  return new Response(
    JSON.stringify({
      provider: "openai-compat",
      openai: { baseUrl: "https://x/v1", apiKey: "", model: "gpt" },
      ollama: { baseUrl: "http://127.0.0.1:11434", model: "" },
      temperature: 0.2,
      hasKey: available,
      keyHint: "",
      imageGen: { model: available ? "dall-e-x" : "" },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

interface StubOptions {
  available: boolean;
  postStatus?: number;
  postBody?: unknown;
}

function stubFetch(opts: StubOptions): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/settings")) return settingsResponse(opts.available);
    if (url.endsWith("/image-gen")) {
      const status = opts.postStatus ?? 200;
      return new Response(JSON.stringify(opts.postBody ?? { src: ASSET_SRC, bytes: 95 }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Wire one UI document into the store and return the active page. */
function seedStore(doc: StudioDocument): void {
  useEditorStore.setState({
    projectId: PROJECT_ID,
    meta: { id: PROJECT_ID, name: doc.name, projectType: "ui" } as never,
    document: doc,
    dirty: false,
    selectedId: null,
    selectedIds: [],
    undoStack: { past: [], future: [] },
    canUndo: false,
    canRedo: false,
  });
}

beforeEach(() => {
  seedStore(imageDoc());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useEditorStore.getState().reset();
});

describe("D1 useImageGen visible 推导（settings 探测）", () => {
  it("选中 Image + hasKey/model 均配置 → visible；挂载即探测一次", async () => {
    const fetchMock = stubFetch({ available: true });
    const doc = imageDoc();
    const { result } = renderHook(() =>
      useImageGen({ projectId: PROJECT_ID, doc: doc.pages[0]!, selectedId: "img", applyOp: vi.fn(() => true) }),
    );
    await waitFor(() => expect(result.current.visible).toBe(true));
    const settingsCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/settings"));
    expect(settingsCalls).toHaveLength(1);
  });

  it("hasKey=false（未配置 key/model）→ visible 恒 false，入口隐藏", async () => {
    stubFetch({ available: false });
    const doc = imageDoc();
    const { result } = renderHook(() =>
      useImageGen({ projectId: PROJECT_ID, doc: doc.pages[0]!, selectedId: "img", applyOp: vi.fn(() => true) }),
    );
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.visible).toBe(false);
  });

  it("探测请求失败（服务未启动）→ 入口保持隐藏，不抛错", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const doc = imageDoc();
    const { result } = renderHook(() =>
      useImageGen({ projectId: PROJECT_ID, doc: doc.pages[0]!, selectedId: "img", applyOp: vi.fn(() => true) }),
    );
    await waitFor(() => expect(result.current.visible).toBe(false));
  });
});

describe("D4 选中类型判定", () => {
  it("选中非 Image 节点 → visible=false", async () => {
    stubFetch({ available: true });
    const doc = imageDoc();
    const { result } = renderHook(() =>
      useImageGen({ projectId: PROJECT_ID, doc: doc.pages[0]!, selectedId: "txt", applyOp: vi.fn(() => true) }),
    );
    await waitFor(() => expect(result.current.visible).toBe(false));
  });

  it("selectedId=null → visible=false", async () => {
    stubFetch({ available: true });
    const doc = imageDoc();
    const { result } = renderHook(() =>
      useImageGen({ projectId: PROJECT_ID, doc: doc.pages[0]!, selectedId: null, applyOp: vi.fn(() => true) }),
    );
    await waitFor(() => expect(result.current.visible).toBe(false));
  });
});

describe("D2 生成成功 → 节点 src 替换（单 undo 条目）", () => {
  it("onGenerate：POST 后 updateProps 替换 Image.src，store undoStack 恰 +1", async () => {
    stubFetch({ available: true });
    const doc = imageDoc();
    const storeApply = (fn: (d: StudioDocument) => StudioDocument) => useEditorStore.getState().applyOp(fn);
    const { result } = renderHook(() =>
      useImageGen({ projectId: PROJECT_ID, doc: doc.pages[0]!, selectedId: "img", applyOp: storeApply }),
    );
    await waitFor(() => expect(result.current.visible).toBe(true));

    let ok = false;
    await act(async () => {
      ok = await result.current.onGenerate("蓝色头图");
    });
    expect(ok).toBe(true);

    const next = useEditorStore.getState().document as StudioDocument;
    const img = next.pages[0]!.nodes.find((n) => n.id === "img") as NodeRecord;
    expect(img.props.src).toBe(ASSET_SRC);
    // Untouched props survive the partial merge.
    expect(img.props.alt).toBe("占位图");
    expect(useEditorStore.getState().undoStack.past).toHaveLength(1);
    expect(useEditorStore.getState().canUndo).toBe(true);
  });

  it("POST body 带 projectId 与 prompt（1..500）", async () => {
    const fetchMock = stubFetch({ available: true });
    await generateImage(PROJECT_ID, "封面");
    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/image-gen"))!;
    expect(url).toBe(`/api/projects/${PROJECT_ID}/image-gen`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ prompt: "封面" });
  });
});

describe("D3 错误路径", () => {
  it("501 image_gen_unavailable：visible 翻为 false，blocked 展示指引，错误不再出现于 error", async () => {
    stubFetch({
      available: true,
      postStatus: 501,
      postBody: { error: "image_gen_unavailable", message: "未配置图像生成模型，请在设置中填写图像模型名称与 API Key" },
    });
    const doc = imageDoc();
    const { result } = renderHook(() =>
      useImageGen({ projectId: PROJECT_ID, doc: doc.pages[0]!, selectedId: "img", applyOp: vi.fn(() => true) }),
    );
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(async () => {
      expect(await result.current.onGenerate("x")).toBe(false);
    });
    expect(result.current.visible).toBe(false);
    expect(result.current.blocked).toContain("设置");
    expect(result.current.error).toBeNull();
  });

  it("502 image_gen_failed：入口保留，error 可读、undoStack 不增", async () => {
    stubFetch({ available: true, postStatus: 502, postBody: { error: "image_gen_failed", message: "内容策略拒绝" } });
    const doc = imageDoc();
    const { result } = renderHook(() =>
      useImageGen({ projectId: PROJECT_ID, doc: doc.pages[0]!, selectedId: "img", applyOp: vi.fn(() => true) }),
    );
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(async () => {
      await result.current.onGenerate("x");
    });
    expect(result.current.visible).toBe(true);
    expect(result.current.error).toBe("内容策略拒绝");
    expect(useEditorStore.getState().undoStack.past).toHaveLength(0);
  });

  it("504 timeout：error 展示超时文案", async () => {
    stubFetch({ available: true, postStatus: 504, postBody: { error: "image_gen_timeout", message: "图像生成超时（60 秒）" } });
    const doc = imageDoc();
    const { result } = renderHook(() =>
      useImageGen({ projectId: PROJECT_ID, doc: doc.pages[0]!, selectedId: "img", applyOp: vi.fn(() => true) }),
    );
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(async () => {
      await result.current.onGenerate("x");
    });
    expect(result.current.error).toContain("超时");
  });

  it("网络层失败（status 0）：error 为连接提示，入口不隐藏", async () => {
    const described = describeImageGenError(new ApiError(0, "无法连接本地服务（127.0.0.1:8787）"));
    expect(described.unavailable).toBe(false);
    expect(described.message).toContain("127.0.0.1");
  });
});

describe("ImageGenPopover 组件", () => {
  it("visible=false 时不渲染任何浮层", () => {
    const api = {
      visible: false, busy: false, error: null, blocked: null,
      onGenerate: vi.fn(), dismissBlocked: vi.fn(),
    };
    const { container } = render(<ImageGenPopover api={api} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("blocked 时渲染指引条，dismiss 后可关闭", () => {
    const dismiss = vi.fn();
    const api = {
      visible: false, busy: false, error: null, blocked: "未配置图像生成模型，请在设置中填写",
      onGenerate: vi.fn(), dismissBlocked: dismiss,
    };
    render(<ImageGenPopover api={api} />);
    expect(screen.getByTestId("image-gen-blocked").textContent).toContain("设置");
    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("成功后展示 R3 导出限制文案", async () => {
    stubFetch({ available: true });
    const storeApply = (fn: (d: StudioDocument) => StudioDocument) => useEditorStore.getState().applyOp(fn);
    render(
      <CanvasSurface
        doc={imageDoc().pages[0]!}
        tokens={defaultTokens()}
        selectedId="img"
        onSelect={vi.fn()}
        applyOp={storeApply}
      />,
    );
    const popover = await screen.findByTestId("image-gen-popover");
    fireEvent.click(screen.getByRole("button", { name: /AI 生成图片/ }));
    fireEvent.change(screen.getByLabelText("图片描述"), { target: { value: "扁平头图" } });
    fireEvent.click(screen.getByRole("button", { name: "生成并替换" }));

    const done = await screen.findByTestId("image-gen-done");
    expect(done.textContent).toContain("导出代码工程时需替换为静态资源");
    // Node update landed through the real store op.
    const next = useEditorStore.getState().document as StudioDocument;
    expect((next.pages[0]!.nodes.find((n) => n.id === "img") as NodeRecord).props.src).toBe(ASSET_SRC);
    expect(popover).toBeInTheDocument();
  });

  it("未配置时画布上完全没有入口（D1 集成）", async () => {
    stubFetch({ available: false });
    render(
      <CanvasSurface
        doc={imageDoc().pages[0]!}
        tokens={defaultTokens()}
        selectedId="img"
        onSelect={vi.fn()}
        applyOp={vi.fn(() => true)}
      />,
    );
    // Wait out the settings probe, then assert the entry never appears.
    await waitFor(() => expect(screen.queryByTestId("image-gen-popover")).toBeNull());
    expect(screen.queryByText(/AI 生成图片/)).toBeNull();
  });
});
