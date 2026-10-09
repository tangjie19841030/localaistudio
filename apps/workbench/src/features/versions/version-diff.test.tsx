import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultStudioDocument, type StudioDocument } from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { VersionListItem } from "../../state/versionStore";
import { VersionDiff, newestVersionId } from "./VersionDiff";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

// Monaco cannot mount under jsdom (needs real DOM layout); expose the text props.
vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({ original, modified }: { original?: string; modified?: string }) => (
    <div data-testid="monaco-diff" data-original={original ?? ""} data-modified={modified ?? ""} />
  ),
}));

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, getVersion: vi.fn() } };
});

const mockedGetVersion = vi.mocked(api.getVersion);

const PID = "00000000-0000-4000-8000-000000000000";
const CURRENT: StudioDocument = { ...defaultDoc("当前页"), name: "当前页" };
const OLD: StudioDocument = { ...defaultDoc("旧版页"), name: "旧版页" };
const NEW: StudioDocument = { ...defaultDoc("新版页"), name: "新版页" };

function item(
  versionId: string,
  name: string,


  createdAt: string,
  doc: StudioDocument | null,
): VersionListItem {
  return { versionId, projectId: PID, name, createdAt, document: doc };
}

const older = item("v-old", "旧版", "2026-01-01T00:00:00.000Z", OLD);
const newer = item("v-new", "新版", "2026-02-01T00:00:00.000Z", NEW);

const diff = () => screen.getByTestId("monaco-diff");

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VersionDiff", () => {
  it("渲染两个下拉：默认最新版本 对比 当前文档", () => {
    render(<VersionDiff projectId={PID} versions={[older, newer]} document={CURRENT} />);
    const left = screen.getByLabelText("对比基准版本") as HTMLSelectElement;
    const right = screen.getByLabelText("对比目标版本") as HTMLSelectElement;
    expect(left.value).toBe("v-new"); // createdAt 最新
    expect(right.value).toBe("__current__");
    expect(diff().getAttribute("data-original")).toContain("新版页");
    expect(diff().getAttribute("data-modified")).toContain("当前页");
  });

  it("切换目标下拉 → diff 右侧内容随之改变", async () => {
    const user = userEvent.setup();
    render(<VersionDiff projectId={PID} versions={[older, newer]} document={CURRENT} />);
    await user.selectOptions(screen.getByLabelText("对比目标版本"), "v-old");
    await waitFor(() => expect(diff().getAttribute("data-modified")).toContain("旧版页"));
    expect(diff().getAttribute("data-original")).toContain("新版页");
  });

  it("切换基准下拉到当前文档 → diff 左侧变为当前文档", async () => {
    const user = userEvent.setup();
    render(<VersionDiff projectId={PID} versions={[older, newer]} document={CURRENT} />);
    await user.selectOptions(screen.getByLabelText("对比基准版本"), "__current__");
    await waitFor(() => expect(diff().getAttribute("data-original")).toContain("当前页"));
  });

  it("镜像缺失（document=null）的版本走 api.getVersion 拉取并渲染", async () => {
    const noMirror = item("v-remote", "跨会话版", "2026-03-01T00:00:00.000Z", null);
    mockedGetVersion.mockResolvedValue({
      versionId: "v-remote",
      projectId: PID,
      name: "跨会话版",
      createdAt: "2026-03-01T00:00:00.000Z",
      document: OLD,
    });
    render(<VersionDiff projectId={PID} versions={[noMirror]} document={CURRENT} />);
    await waitFor(() => expect(mockedGetVersion).toHaveBeenCalledWith(PID, "v-remote"));
    await waitFor(() => expect(diff().getAttribute("data-original")).toContain("旧版页"));
  });

  it("本地已有镜像时不发起 api.getVersion 请求", async () => {
    render(<VersionDiff projectId={PID} versions={[older, newer]} document={CURRENT} />);
    await waitFor(() => expect(diff()).toBeInTheDocument());
    expect(mockedGetVersion).not.toHaveBeenCalled();
  });

  it("拉取失败 → role=alert 错误提示", async () => {
    const noMirror = item("v-remote", "跨会话版", "2026-03-01T00:00:00.000Z", null);
    mockedGetVersion.mockRejectedValueOnce(new Error("API 404: not_found"));
    render(<VersionDiff projectId={PID} versions={[noMirror]} document={CURRENT} />);
    expect((await screen.findByRole("alert")).textContent).toContain("API 404");
    expect(screen.queryByTestId("monaco-diff")).toBeNull();
  });

  it("无版本时渲染空态且不崩溃", () => {
    render(<VersionDiff projectId={PID} versions={[]} document={CURRENT} />);
    expect(screen.getByText(/暂无版本可对比/)).toBeInTheDocument();
    expect(screen.queryByLabelText("对比基准版本")).toBeNull();
  });

  it("当前文档为 null 时提示一侧无文档，不渲染 diff", () => {
    render(<VersionDiff projectId={PID} versions={[newer]} document={null} />);
    expect(screen.getByText("所选一侧没有可用文档。")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-diff")).toBeNull();
  });
});

describe("newestVersionId（纯函数）", () => {
  it("按 createdAt 取最新；空列表返回 null", () => {
    expect(newestVersionId([older, newer])).toBe("v-new");
    expect(newestVersionId([newer, older])).toBe("v-new");
    expect(newestVersionId([])).toBeNull();
  });
});
