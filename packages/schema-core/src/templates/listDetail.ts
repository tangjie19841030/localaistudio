import type { StudioDocument } from "../document.js";
import { docOf, node } from "./types.js";

/** List-detail: left list (search + table) beside a right detail card. */
export function buildListDetail(docName: string): StudioDocument {
  return docOf(docName, "ld-root", [
    node("ld-root", "AppShell", { title: docName, sidebar: true }, ["ld-header", "ld-body"]),
    node("ld-header", "Header", { title: "记录管理", subtitle: "左侧筛选，右侧查看详情" }),
    node("ld-body", "Grid", { columns: 2, gap: 6 }, ["ld-list-card", "ld-detail-card"]),

    node("ld-list-card", "Card", { title: "记录列表", padded: true }, ["ld-filter", "ld-table"]),
    node("ld-filter", "Stack", { gap: 2, align: "stretch" }, ["ld-search", "ld-status"]),
    node("ld-search", "Input", { placeholder: "搜索名称或编号", type: "text" }),
    node("ld-status", "Select", { options: ["全部状态", "进行中", "已完成"], placeholder: "全部状态" }),
    node("ld-table", "Table", {
      columns: ["编号", "名称", "状态"],
      rows: [
        ["R-1001", "季度复盘", "进行中"],
        ["R-1002", "渠道对账", "已完成"],
        ["R-1003", "客户回访", "进行中"],
      ],
    }),

    node("ld-detail-card", "Card", { title: "详情", padded: true }, [
      "ld-detail-heading",
      "ld-detail-badge",
      "ld-detail-text",
      "ld-detail-actions",
    ]),
    node("ld-detail-heading", "Heading", { text: "季度复盘", level: 3 }),
    node("ld-detail-badge", "Badge", { label: "进行中", tone: "brand" }),
    node("ld-detail-text", "Text", { content: "负责人：李雷；截止：09-30；当前进度 60%。", muted: false }),
    node("ld-detail-actions", "Stack", { gap: 2, align: "start" }, ["ld-save", "ld-delete"]),
    node("ld-save", "Button", { label: "保存", variant: "primary", size: "md" }),
    node("ld-delete", "Button", { label: "删除", variant: "danger", size: "md" }),
  ]);
}
