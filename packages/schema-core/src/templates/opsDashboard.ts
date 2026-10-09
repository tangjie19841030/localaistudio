import type { NodeRecord, StudioDocument } from "../document.js";
import { docOfPages, node } from "./types.js";

// ============================================================
// Ops Dashboard — 运营看板组合（概览 overview + 订单 orders）
// ============================================================

/** Overview top: shell, header, range tabs, KPI cards. */
function overviewTop(docName: string): NodeRecord[] {
  return [
    node("od-overview-root", "AppShell", { title: docName, sidebar: true }, [
      "od-overview-header", "od-overview-tabs", "od-overview-kpi",
      "od-overview-charts", "od-overview-top", "od-overview-alert",
    ]),
    node("od-overview-header", "Header", {
      title: "运营概览",
      subtitle: "2026-09-01 ~ 09-17 · 对比上一周期",
    }),
    node("od-overview-tabs", "Tabs", { items: ["近 7 天", "近 30 天", "本季度"], activeIndex: 1 }),
    node("od-overview-kpi", "MetricGrid", { columns: 4 }, [
      "od-overview-s1", "od-overview-s2", "od-overview-s3", "od-overview-s4",
    ]),
    node("od-overview-s1", "StatCard", { label: "GMV", value: "¥128.4 万", delta: "+18.2%", tone: "success" }),
    node("od-overview-s2", "StatCard", { label: "订单数", value: "8,432", delta: "+6.4%", tone: "brand" }),
    node("od-overview-s3", "StatCard", { label: "客单价", value: "¥152", delta: "-3.1%", tone: "warning" }),
    node("od-overview-s4", "StatCard", { label: "退款率", value: "1.8%", delta: "-0.4%", tone: "success" }),
  ];
}

/** Overview charts: daily GMV trend line + channel donut. */
function overviewCharts(): NodeRecord[] {
  return [
    node("od-overview-charts", "Grid", { columns: 2, gap: 4 }, [
      "od-overview-trend", "od-overview-channel",
    ]),
    node("od-overview-trend", "Card", { title: "销售趋势（日 GMV / 万元）", padded: true }, [
      "od-overview-line",
    ]),
    node("od-overview-line", "LineChart", {
      data: [
        { label: "09-11", value: 6.8 },
        { label: "09-12", value: 7.4 },
        { label: "09-13", value: 8.1 },
        { label: "09-14", value: 7.6 },
        { label: "09-15", value: 8.9 },
        { label: "09-16", value: 9.4 },
        { label: "09-17", value: 10.2 },
      ],
    }),
    node("od-overview-channel", "Card", { title: "渠道构成", padded: true }, ["od-overview-donut"]),
    node("od-overview-donut", "DonutChart", {
      data: [
        { label: "小程序商城", value: 46 },
        { label: "App", value: 32 },
        { label: "网页商城", value: 22 },
      ],
    }),
  ];
}

/** Overview tail: top products table and stock alert. */
function overviewTail(): NodeRecord[] {
  return [
    node("od-overview-top", "Section", { title: "热销商品 TOP 3", description: "" }, [
      "od-overview-table",
    ]),
    node("od-overview-table", "Table", {
      columns: ["排名", "商品", "销量", "GMV", "环比"],
      rows: [
        ["1", "87 键三模机械键盘", "1,204", "¥48.0 万", "+22%"],
        ["2", "27 英寸 4K 专业显示器", "412", "¥94.7 万", "+15%"],
        ["3", "人体工学垂直鼠标", "388", "¥9.7 万", "+9%"],
      ],
    }),
    node("od-overview-alert", "Alert", {
      tone: "warning",
      title: "库存预警",
      description: "「87 键三模机械键盘」库存低于安全水位，按当前销量预计 3 天后售罄。",
    }),
  ];
}

/** Orders top: shell, header, filter toolbar and status tabs. */
function ordersTop(docName: string): NodeRecord[] {
  return [
    node("od-orders-root", "AppShell", { title: docName, sidebar: true }, [
      "od-orders-header", "od-orders-filters", "od-orders-tabs",
      "od-orders-table", "od-orders-page",
    ]),
    node("od-orders-header", "Header", {
      title: "订单管理",
      subtitle: "共 8,432 笔订单 · 今日新增 216 笔",
    }),
    node("od-orders-filters", "Grid", { columns: 3, gap: 4 }, [
      "od-orders-search", "od-orders-status", "od-orders-date",
    ]),
    node("od-orders-search", "SearchInput", { placeholder: "搜索订单号或买家昵称…", value: "" }),
    node("od-orders-status", "Select", {
      options: ["全部状态", "待付款", "待发货", "已发货", "已完成", "售后中"],
      placeholder: "全部状态",
    }),
    node("od-orders-date", "DatePicker", { value: "2026-09-17", placeholder: "下单日期" }),
    node("od-orders-tabs", "Tabs", {
      items: ["全部", "待付款", "待发货", "已发货", "已完成", "售后中"],
      activeIndex: 0,
    }),
  ];
}

/** Orders tail: order table and pagination. */
function ordersTail(): NodeRecord[] {
  return [
    node("od-orders-table", "Table", {
      columns: ["订单号", "买家", "金额", "状态", "下单时间"],
      rows: [
        ["SO-20260917-0841", "数码控老周", "¥2,548", "待发货", "09-17 20:41"],
        ["SO-20260917-0840", "MoonRiver", "¥399", "已完成", "09-17 20:32"],
        ["SO-20260917-0839", "阿白", "¥249", "待付款", "09-17 20:18"],
        ["SO-20260917-0838", "静水深流", "¥2,299", "已发货", "09-17 19:55"],
        ["SO-20260917-0837", "Kira", "¥648", "售后中", "09-17 19:40"],
      ],
    }),
    node("od-orders-page", "Pagination", { page: 1, pageCount: 844 }),
  ];
}

/** Builds the two-page ops dashboard: overview + orders. */
export function buildOpsDashboard(docName: string): StudioDocument {
  return docOfPages(docName, [
    {
      id: "od-overview",
      name: "运营概览",
      rootId: "od-overview-root",
      nodes: [...overviewTop(docName), ...overviewCharts(), ...overviewTail()],
    },
    {
      id: "od-orders",
      name: "订单管理",
      rootId: "od-orders-root",
      nodes: [...ordersTop(docName), ...ordersTail()],
    },
  ]);
}
