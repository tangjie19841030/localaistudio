import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { defaultStudioDocument, type StudioDocument, type Page } from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VersionPanel, exportDocumentJson } from "./VersionPanel";
import type { VersionListItem } from "../../state/versionStore";
/** T19: store/document APIs consume the WHOLE doc; tests pass a page fixture. */
function docAsWhole(page: Page): StudioDocument {
  const doc = defaultStudioDocument(page.name);
  doc.pages[0] = page;
  return doc;
}



// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

// VersionPanel now mounts VersionDiff → Monaco, which cannot run under jsdom.
vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({ original, modified }: { original?: string; modified?: string }) => (
    <div data-testid="monaco-diff" data-original={original ?? ""} data-modified={modified ?? ""} />
  ),
}));

const noop = () => {};

const DOC: StudioDocument = defaultStudioDocument("运营工作台");

function item(versionId: string, name: string, doc: StudioDocument | null = DOC): VersionListItem {
  return {
    versionId,
    projectId: "p1",
    name,
    createdAt: "2026-01-01T00:00:01.000Z",
    document: doc,


  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("VersionPanel", () => {
  it("渲染版本列表：名称 + 时间 + 恢复/删除按钮", async () => {
    render(
      <VersionPanel projectId="p1" versions={[item("v1", "上线前")]} onRestore={noop} onImport={noop} />,
    );
    // 名称也出现在「版本对比」下拉的 option 里，断言收敛到版本列表区域
    const list = within(screen.getByRole("region", { name: "版本列表" }));
    expect(list.getByText("上线前")).toBeInTheDocument();
    expect(list.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复 上线前" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除 上线前" })).toBeInTheDocument();
  });

  it("挂载「版本对比」区域（对比 UI 单独成文件）", () => {
    render(
      <VersionPanel projectId="p1" versions={[item("v1", "上线前")]} document={DOC} onRestore={noop} onImport={noop} />,
    );
    expect(screen.getByRole("region", { name: "版本对比" })).toBeInTheDocument();
    expect(screen.getByLabelText("对比基准版本")).toBeInTheDocument();
    expect(screen.getByLabelText("对比目标版本")).toBeInTheDocument();
  });

  it("「存为版本」输入名并保存 → 调用 saveVersion 回调并刷新列表", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onReload = vi.fn().mockResolvedValue(undefined);
    render(
      <VersionPanel
        projectId="p1"
        versions={[]}
        onSaveVersion={onSave}
        onReloadVersions={onReload}
        onRestore={noop}
        onImport={noop}
      />,
    );
    await user.type(screen.getByLabelText("版本名称"), "上线前");
    await user.click(screen.getByRole("button", { name: "存为版本" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("p1", "上线前"));
    await waitFor(() => expect(onReload).toHaveBeenCalled());
  });

  it("恢复按钮触发 onRestore(document)", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    render(
      <VersionPanel projectId="p1" versions={[item("v1", "上线前")]} onRestore={onRestore} onImport={noop} />,
    );
    await user.click(screen.getByRole("button", { name: "恢复 上线前" }));
    expect(onRestore).toHaveBeenCalledWith(DOC);
  });

  it("镜像缺失（document=null）的版本恢复按钮禁用", () => {
    render(
      <VersionPanel projectId="p1" versions={[item("v1", "无镜像", null)]} onRestore={noop} onImport={noop} />,
    );
    expect(screen.getByRole("button", { name: "恢复 无镜像" })).toBeDisabled();
  });

  it("删除按钮触发 onDeleteVersion 回调并刷新", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onReload = vi.fn().mockResolvedValue(undefined);
    render(
      <VersionPanel
        projectId="p1"
        versions={[item("v1", "待删")]}
        onDeleteVersion={onDelete}
        onReloadVersions={onReload}
        onRestore={noop}
        onImport={noop}
      />,
    );
    await user.click(screen.getByRole("button", { name: "删除 待删" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("p1", "v1"));
    await waitFor(() => expect(onReload).toHaveBeenCalled());
  });

  describe("JSON 导入", () => {
    it("非法 JSON 文本：错误清单（role=alert）且不触发 onImport", async () => {
      const user = userEvent.setup();
      const onImport = vi.fn();
      render(
        <VersionPanel projectId="p1" versions={[]} onRestore={noop} onImport={onImport} />,
      );
      const file = new File(["{ not json"], "doc.json", { type: "application/json" });
      const input = screen.getByLabelText("导入 JSON");
      await user.upload(input, file);
      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(screen.getByRole("alert").textContent).toMatch(/JSON/);
      expect(onImport).not.toHaveBeenCalled();
    });

    it("结构非法文档：zod 错误逐条显示（path+message）且不触发 onImport", async () => {
      const user = userEvent.setup();
      const onImport = vi.fn();
      render(
        <VersionPanel projectId="p1" versions={[]} onRestore={noop} onImport={onImport} />,
      );
      const bad = { ...defaultDoc("x"), documentVersion: 999, rootId: "" };
      const file = new File([JSON.stringify(bad)], "doc.json", { type: "application/json" });
      await user.upload(screen.getByLabelText("导入 JSON"), file);
      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      const list = screen.getByRole("list", { name: "导入错误清单" });
      expect(list.querySelectorAll("li").length).toBeGreaterThan(0);
      expect(list.textContent).toContain("documentVersion");
      expect(onImport).not.toHaveBeenCalled();
    });

    it("合法文档：触发 onImport(document) 且错误清空", async () => {
      const user = userEvent.setup();
      const onImport = vi.fn();
      render(
        <VersionPanel projectId="p1" versions={[]} onRestore={noop} onImport={onImport} />,
      );
      const file = new File([JSON.stringify(DOC)], "doc.json", { type: "application/json" });
      await user.upload(screen.getByLabelText("导入 JSON"), file);
      await waitFor(() => expect(onImport).toHaveBeenCalledWith(DOC));
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("JSON 导出", () => {
    it("点击导出 → Blob 下载 document.json", async () => {
      const user = userEvent.setup();
      const createObjectURL = vi.fn(() => "blob:mock");
      const revokeObjectURL = vi.fn();
      vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      render(
        <VersionPanel projectId="p1" versions={[]} document={DOC} onRestore={noop} onImport={noop} />,
      );
      await user.click(screen.getByRole("button", { name: "导出 JSON" }));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const anchor = clickSpy.mock.instances?.[0] as HTMLAnchorElement | undefined;
      expect(anchor?.download).toBe("document.json");
      expect(anchor?.href).toContain("blob:mock");
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    });
  });
});

describe("exportDocumentJson（纯函数）", () => {
  it("生成可回读的 JSON 下载", () => {
    const text = exportDocumentJson(DOC);
    expect(JSON.parse(text).name).toBe("运营工作台");
  });
});
