import type { NodeRecord, StudioDocument } from "../document.js";
import { docOf, node } from "./types.js";

/** Four KPI cards; ids are deterministic so tests and diffs stay stable. */
function statCards(): NodeRecord[] {
  return [
    node("dash-stat-1", "StatCard", { label: "总用户", value: "12,345", delta: "+3.2%", tone: "brand" }),
    node("dash-stat-2", "StatCard", { label: "本月收入", value: "¥86,400", delta: "+1.8%", tone: "success" }),
    node("dash-stat-3", "StatCard", { label: "待处理", value: "37", delta: "-4", tone: "warning" }),
    node("dash-stat-4", "StatCard", { label: "异常告警", value: "2", delta: "+2", tone: "danger" }),
  ];
}

/** Dashboard: shell + header + KPI grid + recent-data table. */
export function buildDashboard(docName: string): StudioDocument {
  return docOf(docName, "dash-root", [
    node("dash-root", "AppShell", { title: docName, sidebar: true }, [
      "dash-header",
      "dash-metrics",
      "dash-table-section",
    ]),
    node("dash-header", "Header", { title: "运营概览", subtitle: "核心指标与最新数据" }),
    node("dash-metrics", "Section", { title: "核心指标", description: "" }, ["dash-grid"]),
    node("dash-grid", "MetricGrid", { columns: 4 }, [
      "dash-stat-1",
      "dash-stat-2",
      "dash-stat-3",
      "dash-stat-4",
    ]),
    ...statCards(),
    node("dash-table-section", "Section", { title: "最新数据", description: "近 7 天记录" }, [
      "dash-table",
    ]),
    node("dash-table", "Table", {
      columns: ["日期", "渠道", "转化", "状态"],
      rows: [
        ["09-01", "自然流量", "312", "正常"],
        ["09-02", "投放", "268", "正常"],
        ["09-03", "合作", "94", "关注"],
      ],
    }),
  ]);
}
