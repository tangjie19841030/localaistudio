import type { NodeRecord, StudioDocument } from "../document.js";
import { docOfPages, node } from "./types.js";

// ============================================================
// SaaS Site — 营销官网组合（首页 landing + 定价 pricing）
// ============================================================

/** Home top: container root, nav, hero, trust stats. */
function homeTop(docName: string): NodeRecord[] {
  return [
    node("ss-home-root", "Container", { maxWidth: "lg" }, [
      "ss-home-nav", "ss-home-hero", "ss-home-stats", "ss-home-features",
      "ss-home-quote", "ss-home-cta", "ss-home-footer",
    ]),
    node("ss-home-nav", "Nav", { items: ["首页", "产品", "定价", "文档", "博客"] }),
    node("ss-home-hero", "Hero", {
      title: docName,
      subtitle: "把需求、原型与真实代码放进同一个工作台，从想法到上线只要一个下午。",
      ctaText: "免费试用 14 天",
    }),
    node("ss-home-stats", "StatsBanner", {
      stats: [
        { label: "服务团队", value: "2,400+" },
        { label: "累计生成页面", value: "180 万+" },
        { label: "服务可用性", value: "99.99%" },
      ],
    }),
  ];
}

/** Home body: feature grid and testimonial. */
function homeBody(): NodeRecord[] {
  return [
    node("ss-home-features", "Section", { title: "为什么选择我们", description: "为中小团队打磨的完整工作流" }, [
      "ss-home-features-grid",
    ]),
    node("ss-home-features-grid", "FeatureGrid", {
      columns: 3,
      features: [
        { title: "语义画布", description: "组件即语义节点，改文案不破坏版式。" },
        { title: "设计令牌", description: "一处换色，全站主题同步更新。" },
        { title: "真实代码导出", description: "一键导出可运行的 React + Tailwind 工程。" },
        { title: "三视图预览", description: "桌面、平板、手机像素级同步预览。" },
        { title: "本地优先", description: "数据不出本机，断网也能继续工作。" },
        { title: "AI 助手", description: "一句话描述需求，自动生成可编辑页面。" },
      ],
    }),
    node("ss-home-quote", "Section", { title: "客户评价", description: "" }, ["ss-home-quote-card"]),
    node("ss-home-quote-card", "Testimonial", {
      quote: "上线第一个月，我们的原型评审周期从三天缩短到了半天。",
      author: "陈晓婷",
      role: "电商平台前端负责人",
    }),
  ];
}

/** Home close: CTA card and footer. */
function homeClose(): NodeRecord[] {
  return [
    node("ss-home-cta", "Card", { title: "准备好开始了吗？", padded: true }, ["ss-home-cta-stack"]),
    node("ss-home-cta-stack", "Stack", { gap: 3, align: "center" }, [
      "ss-home-cta-text", "ss-home-cta-btn",
    ]),
    node("ss-home-cta-text", "Text", { content: "无需信用卡，注册即用，随时导出全部代码。", muted: true }),
    node("ss-home-cta-btn", "Button", { label: "立即免费试用", variant: "primary", size: "lg" }),
    node("ss-home-footer", "Footer", {
      columns: [
        { title: "产品", links: ["功能", "定价", "更新日志"] },
        { title: "资源", links: ["文档", "博客", "社区"] },
        { title: "公司", links: ["关于我们", "加入我们", "联系我们"] },
      ],
      copyright: "© 2026 云枢科技 · 保留所有权利",
    }),
  ];
}

/** Home page assembly. */
function homeNodes(docName: string): NodeRecord[] {
  return [...homeTop(docName), ...homeBody(), ...homeClose()];
}

/** Pricing top: nav, header, billing tabs, three plan cards. */
function pricingTop(docName: string): NodeRecord[] {
  return [
    node("ss-pricing-root", "Container", { maxWidth: "lg" }, [
      "ss-pricing-nav", "ss-pricing-header", "ss-pricing-tabs", "ss-pricing-plans",
      "ss-pricing-compare", "ss-pricing-faq", "ss-pricing-footer",
    ]),
    node("ss-pricing-nav", "Nav", { items: ["首页", "产品", "定价", "文档", "博客"] }),
    node("ss-pricing-header", "Header", { title: docName, subtitle: "简单透明，随团队规模平滑扩展" }),
    node("ss-pricing-tabs", "Tabs", { items: ["按月付费", "按年付费（省 20%）"], activeIndex: 0 }),
    node("ss-pricing-plans", "Grid", { columns: 3, gap: 4 }, [
      "ss-pricing-plan-free", "ss-pricing-plan-pro", "ss-pricing-plan-ent",
    ]),
    node("ss-pricing-plan-free", "PricingCard", {
      plan: "入门版",
      price: "¥0",
      period: "/月",
      features: ["3 个项目", "基础组件库", "单视图导出", "社区支持"],
      ctaText: "免费开始",
      featured: false,
    }),
    node("ss-pricing-plan-pro", "PricingCard", {
      plan: "专业版",
      price: "¥79",
      period: "/月",
      features: ["不限项目数", "全部 58 个组件", "AI 页面生成", "三视图预览", "邮件支持"],
      ctaText: "开通专业版",
      featured: true,
    }),
    node("ss-pricing-plan-ent", "PricingCard", {
      plan: "企业版",
      price: "定制",
      period: "",
      features: ["私有化部署", "SSO 单点登录", "专属客户成功", "SLA 可用性保障"],
      ctaText: "联系销售",
      featured: false,
    }),
  ];
}

/** Pricing bottom: comparison table, FAQ accordion, footer. */
function pricingBottom(): NodeRecord[] {
  return [
    node("ss-pricing-compare", "Section", { title: "功能对比", description: "" }, ["ss-pricing-compare-table"]),
    node("ss-pricing-compare-table", "Table", {
      columns: ["功能", "入门版", "专业版", "企业版"],
      rows: [
        ["项目数量", "3 个", "不限", "不限"],
        ["组件库", "基础组件", "全部组件", "全部组件 + 定制"],
        ["AI 页面生成", "—", "支持", "支持"],
        ["部署方式", "本地", "本地", "私有化"],
      ],
    }),
    node("ss-pricing-faq", "Section", { title: "常见问题", description: "" }, ["ss-pricing-faq-list"]),
    node("ss-pricing-faq-list", "Accordion", {
      openIndex: 0,
      items: [
        { title: "可以随时更换套餐吗？", content: "可以。升级立即生效，降级在当前计费周期结束后生效。" },
        { title: "支持哪些付款方式？", content: "支持对公转账、支付宝与微信支付，企业版可开具增值税专用发票。" },
        { title: "导出的代码可以商用吗？", content: "可以。导出代码归你所有，不限商用场景。" },
      ],
    }),
    node("ss-pricing-footer", "Footer", {
      columns: [
        { title: "产品", links: ["功能", "定价", "更新日志"] },
        { title: "支持", links: ["文档", "状态页", "联系我们"] },
      ],
      copyright: "© 2026 云枢科技 · 保留所有权利",
    }),
  ];
}

/** Builds the two-page SaaS marketing site: home + pricing. */
export function buildSaasSite(docName: string): StudioDocument {
  return docOfPages(docName, [
    { id: "ss-home", name: "首页", rootId: "ss-home-root", nodes: homeNodes(docName) },
    {
      id: "ss-pricing",
      name: "定价方案",
      rootId: "ss-pricing-root",
      nodes: [...pricingTop(docName), ...pricingBottom()],
    },
  ]);
}
