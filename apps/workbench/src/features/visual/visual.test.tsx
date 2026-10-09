import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { summarize, type Issue } from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { visualApi, type VisualRunResult } from "../../api/visual";
import { useAiStore } from "../../state/aiStore";
import { ApiError } from "../../api/client";
import type { SendRequest } from "../ai/types";
import { useVisualStore } from "../../state/visualStore";
import { VisualPanel } from "./VisualPanel";

vi.mock("../../api/visual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/visual")>();
  return {
    ...actual,
    visualApi: {
      runCheck: vi.fn(),
      listRuns: vi.fn(),
      // Keep the real URL builder: the <img src> assertions depend on its shape.
      shotUrl: actual.visualApi.shotUrl,
      fetchShotDataUrl: vi.fn(),
    },
  };
});

/** Spy on aiStore.send without replacing the store: the panel calls it via getState(). */
const mockedSend = vi.fn<(req: SendRequest) => Promise<void>>();
useAiStore.setState({ send: mockedSend });

const mockedRun = vi.mocked(visualApi.runCheck);
const mockedList = vi.mocked(visualApi.listRuns);
const mockedShot = vi.mocked(visualApi.fetchShotDataUrl);

const PID = "00000000-0000-4000-8000-000000000000";

const ISSUES: Issue[] = [
  {
    kind: "horizontal-overflow",
    viewport: "mobile",
    severity: "error",
    message: "页面在 mobile 视口出现横向滚动",
    studioIds: ["n_root"],
  },
  {
    kind: "text-truncation",
    viewport: "mobile",
    severity: "warn",
    message: "文本被截断",
    selector: "div.card > p",
    studioIds: ["n_card", "n_root"],
  },
];

const NEW_KIND_ISSUES: Issue[] = [
  { kind: "a11y-image-alt", viewport: "desktop", severity: "error", message: "图片缺少 alt", selector: "img", studioIds: ["n_img"] },
  { kind: "a11y-control-name", viewport: "desktop", severity: "error", message: "控件缺少可访问名", selector: "input", studioIds: ["n_control"] },
  { kind: "a11y-link-name", viewport: "desktop", severity: "error", message: "链接缺少可访问名", selector: "a", studioIds: ["n_link"] },
  { kind: "a11y-heading-order", viewport: "desktop", severity: "warn", message: "标题层级跳级", selector: "h3", studioIds: ["n_heading"] },
  { kind: "seo-title", viewport: "desktop", severity: "error", message: "缺少页面标题", studioIds: ["n_title"] },
  { kind: "seo-description", viewport: "desktop", severity: "warn", message: "缺少页面描述", studioIds: ["n_description"] },
  { kind: "seo-h1", viewport: "desktop", severity: "warn", message: "h1 数量异常", studioIds: ["n_h1"] },
];

function makeRun(issues: Issue[] = ISSUES): VisualRunResult {
  return {
    runId: "run-1",
    createdAt: "2026-09-09T00:00:00.000Z",
    url: "http://127.0.0.1:5180",
    issues,
    summary: summarize(issues),
    shots: [
      { viewport: "desktop", file: "desktop.png" },
      { viewport: "tablet", file: "tablet.png" },
      { viewport: "mobile", file: "mobile.png" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useVisualStore.getState().clear();
  useAiStore.getState().clear();
  mockedList.mockResolvedValue([]);
  mockedSend.mockResolvedValue(undefined);
  mockedShot.mockImplementation(async (_pid, _runId, file) =>
    Promise.resolve(`data:image/png;base64,${file}`),
  );
});

describe("VisualPanel 空态与历史加载", () => {
  it("未执行检查：占位文案，无问题清单，AI 修复按钮禁用", async () => {
    render(<VisualPanel projectId={PID} />);
    await waitFor(() => expect(mockedList).toHaveBeenCalledWith(PID));

    expect(screen.getByText("请先启动项目预览，再点击“开始本地质检”。")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "问题清单" })).toBeNull();
    expect(screen.getByRole("button", { name: "发给 AI 修复" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "开始本地质检" })).toBeEnabled();
  });

  it("projectId 为空：不请求历史且检查按钮禁用", () => {
    render(<VisualPanel projectId={null} />);
    expect(mockedList).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "开始本地质检" })).toBeDisabled();
  });
});

describe("VisualPanel 执行检查", () => {
  it("点击开始本地质检：调用 runCheck 并渲染问题清单与汇总", async () => {
    mockedRun.mockResolvedValue(makeRun());
    const user = userEvent.setup();
    render(<VisualPanel projectId={PID} />);

    await user.click(screen.getByRole("button", { name: "开始本地质检" }));

    expect(mockedRun).toHaveBeenCalledWith(PID);
    const list = await screen.findByRole("list", { name: "问题清单" });
    expect(list).toHaveTextContent("页面在 mobile 视口出现横向滚动");
    expect(list).toHaveTextContent("文本被截断");
    expect(list).toHaveTextContent("div.card > p");
    expect(list).toHaveTextContent("横向溢出");
    expect(screen.getByText(/错误 1/)).toBeInTheDocument();
    expect(screen.getByText(/警告 1/)).toBeInTheDocument();
  });

  it("新增 a11y/SEO 问题按统一标签分组并显示计数", async () => {
    mockedRun.mockResolvedValue(makeRun(NEW_KIND_ISSUES));
    const user = userEvent.setup();
    render(<VisualPanel projectId={PID} />);

    await user.click(screen.getByRole("button", { name: "开始本地质检" }));
    const list = await screen.findByRole("list", { name: "问题清单" });
    expect(screen.getByText(/共 7 项/)).toBeInTheDocument();
    expect(screen.getByText(/错误 4/)).toBeInTheDocument();
    expect(screen.getByText(/警告 3/)).toBeInTheDocument();
    for (const issue of NEW_KIND_ISSUES) {
      expect(list).toHaveTextContent(issue.message);
      expect(screen.getByText(new RegExp(`${issue.message}（1）`))).toBeInTheDocument();
    }
  });

  it("preview_not_running 409 显示中文引导且不显示原始错误码", async () => {
    mockedRun.mockRejectedValue(
      new ApiError(409, JSON.stringify({ error: "preview_not_running", message: "preview_not_running" })),
    );
    const user = userEvent.setup();
    render(<VisualPanel projectId={PID} />);

    await user.click(screen.getByRole("button", { name: "开始本地质检" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("请先启动本地项目预览，再运行本地质检");
    expect(alert).not.toHaveTextContent("preview_not_running");
  });

  it("检查中：按钮文案变检查中…且禁用，完成后恢复", async () => {
    let release: (r: VisualRunResult) => void = () => {};
    mockedRun.mockImplementation(
      () => new Promise<VisualRunResult>((resolve) => (release = resolve)),
    );
    const user = userEvent.setup();
    render(<VisualPanel projectId={PID} />);

    await user.click(screen.getByRole("button", { name: "开始本地质检" }));
    const running = await screen.findByRole("button", { name: "检查中…" });
    expect(running).toBeDisabled();

    release(makeRun());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "开始本地质检" })).toBeEnabled(),
    );
  });

  it("有问题时 AI 修复按钮可用；零问题时保持禁用", async () => {
    mockedRun.mockResolvedValue(makeRun([]));
    const user = userEvent.setup();
    render(<VisualPanel projectId={PID} />);

    await user.click(screen.getByRole("button", { name: "开始本地质检" }));
    expect(await screen.findByText("无问题")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发给 AI 修复" })).toBeDisabled();

    mockedRun.mockResolvedValue(makeRun());
    await user.click(screen.getByRole("button", { name: "开始本地质检" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发给 AI 修复" })).toBeEnabled(),
    );
  });

  it("失败：role=alert 展示错误文案", async () => {
    mockedRun.mockRejectedValue(new Error("截图执行失败"));
    const user = userEvent.setup();
    render(<VisualPanel projectId={PID} />);

    await user.click(screen.getByRole("button", { name: "开始本地质检" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("截图执行失败");
  });
});

describe("VisualPanel 视口切换", () => {
  it("三视口 tab 切换换图，img alt 与 src 随之变化", async () => {
    mockedRun.mockResolvedValue(makeRun());
    const user = userEvent.setup();
    render(<VisualPanel projectId={PID} />);

    await user.click(screen.getByRole("button", { name: "开始本地质检" }));
    const desktopImg = await screen.findByRole("img", { name: "桌面 截图" });
    expect(desktopImg).toHaveAttribute(
      "src",
      `/api/projects/${PID}/screenshots/run-1/desktop.png`,
    );

    const tablist = screen.getByRole("tablist", { name: "视口切换" });
    expect(tablist).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "手机" }));

    const mobileImg = await screen.findByRole("img", { name: "手机 截图" });
    expect(mobileImg).toHaveAttribute("src", `/api/projects/${PID}/screenshots/run-1/mobile.png`);
    expect(screen.getByRole("tab", { name: "手机" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "桌面" })).toHaveAttribute("aria-selected", "false");
  });
});

describe("VisualPanel 发给 AI 修复", () => {
  /** Run the check, then click the repair button and settle. */
  async function runThenRepair(run: VisualRunResult = makeRun()): Promise<void> {
    mockedRun.mockResolvedValue(run);
    const user = userEvent.setup();
    render(<VisualPanel projectId={PID} />);
    await user.click(screen.getByRole("button", { name: "开始本地质检" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发给 AI 修复" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "发给 AI 修复" }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalled());
  }

  it("点击后拉取截图 data URL，并以 patch 模式带 scope.nodeIds 与 images 调用 send", async () => {
    await runThenRepair();

    expect(mockedShot).toHaveBeenCalledWith(PID, "run-1", "mobile.png");
    const req = mockedSend.mock.calls[0]?.[0] as SendRequest;
    expect(req.mode).toBe("patch");
    expect(req.projectId).toBe(PID);
    expect(req.scope).toEqual({ nodeIds: ["n_root", "n_card"], allowAllTokens: false });
    expect(req.images?.length).toBeGreaterThan(0);
    expect(req.images?.[0]).toMatch(/^data:image\/png;base64,/);
    expect(req.text).toContain("页面在 mobile 视口出现横向滚动");
    expect(req.text).toContain("n_root、n_card");
  });

  it("只附带有问题的视口截图（本例仅 mobile）", async () => {
    await runThenRepair();
    expect(mockedShot).toHaveBeenCalledTimes(1);
    expect(mockedShot).toHaveBeenCalledWith(PID, "run-1", "mobile.png");
    const req = mockedSend.mock.calls[0]?.[0] as SendRequest;
    expect(req.images).toEqual(["data:image/png;base64,mobile.png"]);
  });

  it("发送中：按钮文案变发送中…且禁用，完成后恢复", async () => {
    mockedRun.mockResolvedValue(makeRun());
    let release: () => void = () => {};
    mockedSend.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    const user = userEvent.setup();
    render(<VisualPanel projectId={PID} />);
    await user.click(screen.getByRole("button", { name: "开始本地质检" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发给 AI 修复" })).toBeEnabled(),
    );

    await user.click(screen.getByRole("button", { name: "发给 AI 修复" }));
    const busy = await screen.findByRole("button", { name: "发送中…" });
    expect(busy).toBeDisabled();

    release();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发给 AI 修复" })).toBeEnabled(),
    );
  });

  it("截图读取失败：role=alert 展示错误且不调用 send", async () => {
    mockedRun.mockResolvedValue(makeRun());
    mockedShot.mockRejectedValue(new Error("截图读取失败"));
    const user = userEvent.setup();
    render(<VisualPanel projectId={PID} />);
    await user.click(screen.getByRole("button", { name: "开始本地质检" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发给 AI 修复" })).toBeEnabled(),
    );

    await user.click(screen.getByRole("button", { name: "发给 AI 修复" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("截图读取失败");
    expect(mockedSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "发给 AI 修复" })).toBeEnabled();
  });

  it("send 抛错：role=alert 展示错误文案", async () => {
    mockedRun.mockResolvedValue(makeRun());
    mockedSend.mockRejectedValue(new Error("无法连接本地服务"));
    const user = userEvent.setup();
    render(<VisualPanel projectId={PID} />);
    await user.click(screen.getByRole("button", { name: "开始本地质检" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发给 AI 修复" })).toBeEnabled(),
    );

    await user.click(screen.getByRole("button", { name: "发给 AI 修复" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法连接本地服务");
  });

  it("问题涉及多个视口：附带对应的多张截图", async () => {
    const multi: Issue[] = [
      ...ISSUES,
      {
        kind: "overlap",
        viewport: "desktop",
        severity: "error",
        message: "两个可交互元素重叠",
        selectors: ["button.a", "button.b"],
        studioIds: ["n_btn"],
      },
    ];
    await runThenRepair(makeRun(multi));
    expect(mockedShot).toHaveBeenCalledTimes(2);
    const req = mockedSend.mock.calls[0]?.[0] as SendRequest;
    expect(req.images).toEqual([
      "data:image/png;base64,desktop.png",
      "data:image/png;base64,mobile.png",
    ]);
    // P7.3: SendRequest.scope is a union now — UI shape carries nodeIds.
    expect((req.scope as { nodeIds?: string[] }).nodeIds).toEqual(["n_root", "n_card", "n_btn"]);
  });
});
