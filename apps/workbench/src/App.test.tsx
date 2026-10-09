import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultStudioDocument, newProjectMeta, type ProjectBundle } from "@studio/schema-core";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./api/client";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

vi.mock("./api/client", () => ({
  api: {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    getProject: vi.fn(),
    saveProject: vi.fn(),
    createVersion: vi.fn(),
    listVersions: vi.fn(),
    deleteVersion: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

const b: ProjectBundle = {
  meta: newProjectMeta({ name: "运营工作台", productType: "后台", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" }),
  document: defaultDoc("运营工作台"),
};

describe("App 接线（列表 → 打开 → 编辑 → 保存）", () => {
  it("完整用户流", async () => {


    const user = userEvent.setup();
    mockedApi.listProjects.mockResolvedValue([b.meta]);
    mockedApi.getProject.mockResolvedValue(b);
    const bumped: ProjectBundle = {
      ...b,
      meta: { ...b.meta, updatedAt: new Date(Date.parse(b.meta.updatedAt) + 1).toISOString() },
      document: { ...b.document, name: "新文档名" },
    };
    mockedApi.saveProject.mockResolvedValue(bumped);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 运营工作台" }));
    expect(await screen.findByRole("complementary", { name: "需求" })).toBeInTheDocument();

    const nameInput = screen.getByLabelText("文档名称");
    await user.clear(nameInput);
    await user.type(nameInput, "新文档名");
    expect(screen.getByRole("status")).toHaveTextContent("未保存更改");

    await user.click(screen.getByRole("button", { name: "保存" }));
    // status 元素常驻，findByRole 不会等文本翻转——异步保存完成前它会读到
    // 「未保存更改」造成竞态。用 waitFor 轮询文本本身。
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("已保存");
    });
    expect(screen.getByLabelText("文档名称")).toHaveValue("新文档名"); // 保存后回显服务端返回的文档
    expect(mockedApi.saveProject).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });
});
