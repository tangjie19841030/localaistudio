import { ISSUE_KIND_LABELS, type Issue, type IssueKind } from "@studio/schema-core";
import { describe, expect, it } from "vitest";
import { buildRepairRequest } from "./repairRequest";

const overflow: Issue = {
  kind: "horizontal-overflow",
  viewport: "mobile",
  severity: "error",
  message: "页面在 mobile 视口出现横向滚动",
  studioIds: ["n_a"],
};

const truncation: Issue = {
  kind: "text-truncation",
  viewport: "tablet",
  severity: "warn",
  message: "文本被截断",
  selector: "div.card > p",
  studioIds: ["n_b", "n_a"], // n_a 重复，用于去重断言
};

const overlap: Issue = {
  kind: "overlap",
  viewport: "desktop",
  severity: "error",
  message: "两个可交互元素重叠",
  selectors: ["button.a", "button.b"],
  studioIds: ["n_c"],
};

const newKindIssues: { kind: IssueKind; nodeId: string }[] = [
  { kind: "a11y-image-alt", nodeId: "n_img" },
  { kind: "a11y-control-name", nodeId: "n_control" },
  { kind: "a11y-link-name", nodeId: "n_link" },
  { kind: "a11y-heading-order", nodeId: "n_heading" },
  { kind: "seo-title", nodeId: "n_title" },
  { kind: "seo-description", nodeId: "n_description" },
  { kind: "seo-h1", nodeId: "n_h1" },
];

const newIssues: Issue[] = newKindIssues.map(({ kind, nodeId }) => ({
  kind,
  viewport: "desktop",
  severity: kind === "a11y-heading-order" || kind.startsWith("seo-") && kind !== "seo-title" ? "warn" : "error",
  message: ISSUE_KIND_LABELS[kind],
  selector: `[data-node-id="${nodeId}"]`,
  studioIds: [nodeId],
}));

describe("buildRepairRequest 文本", () => {
  it("列出每个问题的类型标签、视口与文案", () => {
    const { text } = buildRepairRequest({
      issues: [overflow, truncation, overlap],
      shotDataUrls: [],
    });
    expect(text).toContain("横向溢出");
    expect(text).toContain("文本截断");
    expect(text).toContain("元素重叠");
    expect(text).toContain("手机 390×844");
    expect(text).toContain("平板 1024×768");
    expect(text).toContain("桌面 1440×900");
    expect(text).toContain("页面在 mobile 视口出现横向滚动");
    expect(text).toContain("文本被截断");
    expect(text).toContain("两个可交互元素重叠");
    expect(text).toContain("3 个界面问题");
  });

  it("带上选择器：单选择器与重叠的两个选择器都出现", () => {
    const { text } = buildRepairRequest({ issues: [truncation, overlap], shotDataUrls: [] });
    expect(text).toContain("div.card > p");
    expect(text).toContain("button.a ↔ button.b");
  });

  it("按 error/warn 标注严重级别", () => {
    const { text } = buildRepairRequest({ issues: [overflow, truncation], shotDataUrls: [] });
    expect(text).toContain("[错误]");
    expect(text).toContain("[警告]");
  });

  it("声明只允许修改的节点，并禁止改 rootId", () => {
    const { text } = buildRepairRequest({ issues: [overflow, overlap], shotDataUrls: [] });
    expect(text).toContain("只允许修改这些 Schema 节点（共 2 个）");
    expect(text).toContain("n_a、n_c");
    expect(text).toContain("rootId");
  });

  it("问题无 studioIds：给出最小范围指引而非节点列表", () => {
    const unmapped: Issue = { ...overflow, studioIds: undefined };
    const { text, nodeIds } = buildRepairRequest({ issues: [unmapped], shotDataUrls: [] });
    expect(nodeIds).toEqual([]);
    expect(text).toContain("未能映射到具体 Schema 节点");
    expect(text).not.toContain("只允许修改这些 Schema 节点");
  });

  it("无选择器的问题标注（无选择器）而不是 undefined", () => {
    const { text } = buildRepairRequest({ issues: [overflow], shotDataUrls: [] });
    expect(text).toContain("（无选择器）");
    expect(text).not.toContain("undefined");
  });

  it("新增 a11y/SEO 类型使用统一标签、计数并保持节点范围", () => {
    const { text, nodeIds } = buildRepairRequest({ issues: newIssues, shotDataUrls: [] });
    for (const { kind, nodeId } of newKindIssues) {
      expect(text).toContain(`${ISSUE_KIND_LABELS[kind]}（1 项）`);
      expect(text).toContain(nodeId);
    }
    expect(text).toContain("本地质检发现的 7 个界面问题");
    expect(text).toContain("只允许修改这些 Schema 节点（共 7 个）");
    expect(nodeIds).toHaveLength(7);
  });
});

describe("buildRepairRequest nodeIds 与 images", () => {
  it("nodeIds 去重且保留首次出现顺序", () => {
    const { nodeIds } = buildRepairRequest({
      issues: [overflow, truncation, overlap],
      shotDataUrls: [],
    });
    expect(nodeIds).toEqual(["n_a", "n_b", "n_c"]);
  });

  it("空问题列表：nodeIds 为空数组", () => {
    const { nodeIds, images } = buildRepairRequest({ issues: [], shotDataUrls: [] });
    expect(nodeIds).toEqual([]);
    expect(images).toEqual([]);
  });

  it("images 原样带上传入的 data URL（拷贝，不共享引用）", () => {
    const urls = ["data:image/png;base64,AAA", "data:image/png;base64,BBB"];
    const { images } = buildRepairRequest({ issues: [overflow], shotDataUrls: urls });
    expect(images).toEqual(urls);
    expect(images).not.toBe(urls);
  });

  it("纯函数：不修改传入的 issues 与 shotDataUrls", () => {
    const issues = [overflow, truncation];
    const urls = ["data:image/png;base64,AAA"];
    buildRepairRequest({ issues, shotDataUrls: urls });
    expect(issues).toHaveLength(2);
    expect(urls).toEqual(["data:image/png;base64,AAA"]);
  });
});
