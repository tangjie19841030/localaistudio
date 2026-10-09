import type { NodeRecord, StudioDocument } from "../document.js";
import { docOf, node } from "./types.js";

// ============================================================
// Landing — 产品落地页
// ============================================================
export function buildLanding(docName: string): StudioDocument {
  return docOf(docName, "landing-root", [
    node("landing-root", "Container", { maxWidth: "lg" }, [
      "landing-hero", "landing-features", "landing-testimonial", "landing-stats", "landing-footer",
    ]),
    node("landing-hero", "Hero", {
      title: docName,
      subtitle: "一款为效率而生的工具——从需求到原型，只需一句话。",
      ctaText: "立即开始",
      secondaryText: "了解更多",
    }),
    node("landing-features", "Section", { title: "核心能力", description: "" }, ["landing-fg"]),
    node("landing-fg", "FeatureGrid", {
      features: [
        { icon: "⚡", title: "极速生成", description: "AI 一句话出完整页面，秒级响应。" },
        { icon: "🎨", title: "品牌一致", description: "设计令牌驱动，换色不破坏结构。" },
        { icon: "📦", title: "一键导出", description: "React + TypeScript + Tailwind 完整项目。" },
        { icon: "📱", title: "多端适配", description: "桌面 / 平板 / 手机三视口实时预览。" },
        { icon: "🔒", title: "本地运行", description: "数据不出本机，隐私零妥协。" },
        { icon: "🤖", title: "智能修复", description: "截图审计自动发现排版问题并修复。" },
      ],
      columns: 3,
    }),
    node("landing-testimonial", "Section", { title: "用户评价", description: "" }, ["landing-testimonials"]),
    node("landing-testimonials", "FeatureGrid", {
      features: [
        { icon: "张", title: "独立开发者", description: "十分钟搭完了一个管理后台的雏形。" },
        { icon: "李", title: "产品经理", description: "不用等设计师了，自己先出个方案验证。" },
      ],
      columns: 2,
    }),
    node("landing-stats", "StatsBanner", {
      stats: [
        { label: "用户", value: "12,000+" },
        { label: "页面生成", value: "58,000+" },
        { label: "满意度", value: "96%" },
      ],
    }),
    node("landing-footer", "Footer", {
      columns: [
        { title: "产品", links: ["功能", "定价", "更新日志"] },
        { title: "支持", links: ["文档", "FAQ", "社区"] },
      ],
      copyright: "© 2026 Local AI UI Studio",
    }),
  ]);
}

// ============================================================
// Login — 登录页
// ============================================================
export function buildLogin(docName: string): StudioDocument {
  return docOf(docName, "login-root", [
    node("login-root", "Container", { maxWidth: "sm" }, [
      "login-header", "login-card", "login-hint",
    ]),
    node("login-header", "Heading", { text: docName, level: 1 }),
    node("login-card", "Card", { title: "登录", padded: true }, [
      "login-form", "login-alt",
    ]),
    node("login-form", "Form", { title: "" }, [
      "login-f-email", "login-f-pass", "login-actions",
    ]),
    node("login-f-email", "FormField", { label: "邮箱", required: true, helpText: "" }, ["login-email"]),
    node("login-email", "Input", { placeholder: "name@example.com", type: "email" }),
    node("login-f-pass", "FormField", { label: "密码", required: true, helpText: "至少 6 位" }, ["login-pass"]),
    node("login-pass", "Input", { placeholder: "请输入密码", type: "password" }),
    node("login-actions", "Stack", { gap: 2, align: "stretch" }, ["login-submit"]),
    node("login-alt", "Stack", { gap: 3, align: "center" }, ["login-alt-divider", "login-alt-text"]),
    node("login-alt-divider", "Divider", { label: "或" }),
    node("login-alt-text", "Text", { content: "支持邮箱注册与 SSO 登录。", muted: true, center: true }),
    node("login-submit", "Button", { label: "登录", variant: "primary", size: "lg" }),
    node("login-hint", "Text", { content: "还没有账号？联系我们开通。", muted: true }),
  ]);
}

// ============================================================
// Settings — 设置页
// ============================================================
export function buildSettings(docName: string): StudioDocument {
  return docOf(docName, "settings-root", [
    node("settings-root", "AppShell", { title: docName, sidebar: true }, [
      "settings-header", "settings-notif", "settings-account", "settings-danger",
    ]),
    node("settings-header", "Header", { title: "设置", subtitle: "管理偏好与安全" }),
    node("settings-notif", "Section", { title: "通知", description: "" }, ["settings-notif-stack"]),
    node("settings-notif-stack", "Stack", { gap: 3, align: "stretch" }, [
      "settings-notif-s1", "settings-notif-s2", "settings-notif-s3",
    ]),
    node("settings-notif-s1", "Switch", { label: "邮件通知", checked: true }),
    node("settings-notif-s2", "Switch", { label: "桌面通知", checked: false }),
    node("settings-notif-s3", "Switch", { label: "周报推送", checked: true }),

    node("settings-account", "Section", { title: "账号信息", description: "" }, ["settings-account-grid"]),
    node("settings-account-grid", "Grid", { columns: 2, gap: 4 }, [
      "settings-acc-name-f", "settings-acc-lang-f",
      "settings-acc-theme-f", "settings-acc-tz-f",
    ]),
    node("settings-acc-name-f", "FormField", { label: "显示名称", required: false, helpText: "" }, ["settings-acc-name"]),
    node("settings-acc-name", "Input", { placeholder: "你的名字", type: "text" }),
    node("settings-acc-lang-f", "FormField", { label: "语言", required: false, helpText: "" }, ["settings-acc-lang"]),
    node("settings-acc-lang", "Select", { options: ["中文", "English", "日本語"], placeholder: "中文" }),
    node("settings-acc-theme-f", "FormField", { label: "主题", required: false, helpText: "" }, ["settings-acc-theme"]),
    node("settings-acc-theme", "Select", { options: ["浅色", "深色", "跟随系统"], placeholder: "深色" }),
    node("settings-acc-tz-f", "FormField", { label: "时区", required: false, helpText: "" }, ["settings-acc-tz"]),
    node("settings-acc-tz", "Select", { options: ["UTC+8 北京", "UTC+0 伦敦", "UTC-5 纽约"], placeholder: "UTC+8" }),

    node("settings-danger", "Section", { title: "危险区", description: "以下操作不可撤销" }, [
      "settings-danger-stack",
    ]),
    node("settings-danger-stack", "Stack", { gap: 3, align: "stretch" }, [
      "settings-danger-alert", "settings-danger-btn",
    ]),
    node("settings-danger-alert", "Alert", {
      tone: "warning",
      title: "删除后所有数据不可恢复",
      description: "请确认已备份重要信息。",
    }),
    node("settings-danger-btn", "Button", { label: "删除账号", variant: "danger", size: "md" }),
  ]);
}

// ============================================================
// Profile — 个人主页
// ============================================================
export function buildProfile(docName: string): StudioDocument {
  return docOf(docName, "profile-root", [
    node("profile-root", "Container", { maxWidth: "md" }, [
      "profile-header", "profile-stats", "profile-activity", "profile-skills",
    ]),
    node("profile-header", "Header", { title: docName, subtitle: "全栈工程师 · 北京" }),
    node("profile-stats", "MetricGrid", { columns: 3 }, [
      "profile-s1", "profile-s2", "profile-s3",
    ]),
    node("profile-s1", "StatCard", { label: "项目", value: "24", delta: "+3 本月", tone: "brand" }),
    node("profile-s2", "StatCard", { label: "贡献", value: "1,208", delta: "+86", tone: "success" }),
    node("profile-s3", "StatCard", { label: "获赞", value: "3,520", delta: "+120", tone: "warning" }),

    node("profile-activity", "Section", { title: "最近动态", description: "" }, ["profile-timeline"]),
    node("profile-timeline", "Timeline", {
      rows: [
        { time: "10-01", title: "发布组件库 v2.0", description: "58 个组件全量上线" },
        { time: "09-28", title: "加入开源社区", description: "贡献了 12 个 PR" },
        { time: "09-20", title: "完成 AI 工作台", description: "从设计到开发 3 天" },
      ],
    }),

    node("profile-skills", "Section", { title: "技能", description: "" }, ["profile-skill-grid"]),
    node("profile-skill-grid", "FeatureGrid", {
      features: [
        { icon: "⚛", title: "React / Next.js", description: "3 年经验" },
        { icon: "TS", title: "TypeScript", description: "3 年经验" },
        { icon: "🎨", title: "设计系统", description: "2 年经验" },
        { icon: "🤖", title: "AI 应用", description: "1 年经验" },
      ],
      columns: 2,
    }),
  ]);
}

// ============================================================
// Analytics — 数据分析
// ============================================================
export function buildAnalytics(docName: string): StudioDocument {
  return docOf(docName, "ana-root", [
    node("ana-root", "AppShell", { title: docName, sidebar: true }, [
      "ana-header", "ana-kpi", "ana-charts", "ana-detail",
    ]),
    node("ana-header", "Header", { title: "数据分析", subtitle: "最近 30 天趋势" }),
    node("ana-kpi", "MetricGrid", { columns: 4 }, [
      "ana-s1", "ana-s2", "ana-s3", "ana-s4",
    ]),
    node("ana-s1", "StatCard", { label: "访问量", value: "48.2K", delta: "+12.3%", tone: "success" }),
    node("ana-s2", "StatCard", { label: "转化率", value: "3.6%", delta: "+0.4%", tone: "brand" }),
    node("ana-s3", "StatCard", { label: "平均时长", value: "4m 12s", delta: "-8s", tone: "warning" }),
    node("ana-s4", "StatCard", { label: "跳出率", value: "32.1%", delta: "-2.1%", tone: "danger" }),

    node("ana-charts", "Section", { title: "趋势图表", description: "" }, ["ana-chart-grid"]),
    node("ana-chart-grid", "Grid", { columns: 2, gap: 4 }, [
      "ana-bar", "ana-line", "ana-donut", "ana-spark",
    ]),
    node("ana-bar", "Card", { title: "渠道分布", padded: true }, ["ana-bar-chart"]),
    node("ana-bar-chart", "BarChart", {
      data: [
        { label: "自然", value: 420 },
        { label: "投放", value: 310 },
        { label: "合作", value: 180 },
        { label: "社交", value: 260 },
      ],
      height: 180,
    }),
    node("ana-line", "Card", { title: "访问趋势", padded: true }, ["ana-line-chart"]),
    node("ana-line-chart", "LineChart", {
      points: [120, 180, 160, 240, 200, 310, 280, 350],
      height: 180,
    }),
    node("ana-donut", "Card", { title: "用户构成", padded: true }, ["ana-donut-chart"]),
    node("ana-donut-chart", "DonutChart", {
      segments: [
        { label: "新用户", value: 35 },
        { label: "回访", value: 45 },
        { label: "流失", value: 20 },
      ],
      size: 160,
    }),
    node("ana-spark", "Card", { title: "实时活跃", padded: true }, ["ana-spark-chart"]),
    node("ana-spark-chart", "Sparkline", { points: [10, 14, 12, 18, 16, 22, 20, 26], width: 200, height: 60 }),

    node("ana-detail", "Section", { title: "明细", description: "" }, ["ana-table"]),
    node("ana-table", "Table", {
      columns: ["日期", "PV", "UV", "转化"],
      rows: [
        ["10-01", "12,480", "3,240", "128"],
        ["10-02", "11,890", "3,120", "112"],
        ["10-03", "13,200", "3,480", "142"],
      ],
    }),
  ]);
}

// ============================================================
// Pricing — 定价页
// ============================================================
export function buildPricing(docName: string): StudioDocument {
  return docOf(docName, "pricing-root", [
    node("pricing-root", "Container", { maxWidth: "lg" }, [
      "pricing-header", "pricing-cards", "pricing-testimonials", "pricing-footer",
    ]),
    node("pricing-header", "Header", { title: docName, subtitle: "选择适合你的方案" }),
    node("pricing-cards", "Grid", { columns: 3, gap: 4 }, [
      "pricing-free", "pricing-pro", "pricing-team",
    ]),
    node("pricing-free", "PricingCard", {
      plan: "免费",
      price: "¥0",
      period: "/月",
      features: ["5 个项目", "基础组件", "社区支持"],
      ctaText: "开始使用",
      featured: false,
    }),
    node("pricing-pro", "PricingCard", {
      plan: "专业",
      price: "¥29",
      period: "/月",
      features: ["无限制项目", "全部 58 组件", "AI 生成", "优先支持"],
      ctaText: "立即开通",
      featured: true,
    }),
    node("pricing-team", "PricingCard", {
      plan: "团队",
      price: "¥99",
      period: "/月",
      features: ["所有专业功能", "多人协作", "私有部署", "专属客服"],
      ctaText: "联系我们",
      featured: false,
    }),

    node("pricing-testimonials", "Section", { title: "用户怎么说", description: "" }, ["pricing-testimonial"]),
    node("pricing-testimonial", "Testimonial", {
      quote: "用了一个月，页面原型产出速度至少翻了一倍。",
      author: "王明",
      role: "独立开发者",
      rating: 5,
    }),

    node("pricing-footer", "Footer", {
      columns: [
        { title: "产品", links: ["功能", "定价", "文档"] },
        { title: "支持", links: ["帮助", "FAQ", "联系"] },
      ],
      copyright: "© 2026",
    }),
  ]);
}

// ============================================================
// Messages — 消息中心
// ============================================================
export function buildMessages(docName: string): StudioDocument {
  return docOf(docName, "msg-root", [
    node("msg-root", "AppShell", { title: docName, sidebar: true }, [
      "msg-header", "msg-search", "msg-table", "msg-empty-hint",
    ]),
    node("msg-header", "Header", { title: "消息中心", subtitle: "系统通知与任务提醒" }),
    node("msg-search", "SearchInput", { placeholder: "搜索消息…" }),
    node("msg-table", "Section", { title: "最近消息", description: "" }, ["msg-list"]),
    node("msg-list", "Table", {
      columns: ["时间", "类型", "内容", "状态"],
      rows: [
        ["09:30", "系统", "每日备份完成", "已读"],
        ["09:15", "任务", "工单 #1024 已分配给你", "未读"],
        ["08:50", "告警", "CPU 使用率超过 80%", "未读"],
        ["08:00", "通知", "新成员加入团队", "已读"],
      ],
    }),
    node("msg-empty-hint", "EmptyState", {
      title: "全部已读",
      description: "没有更多未处理消息",
      actionText: "刷新",
    }),
  ]);
}

// ============================================================
// Blog — 博客列表
// ============================================================
export function buildBlog(docName: string): StudioDocument {
  return docOf(docName, "blog-root", [
    node("blog-root", "Container", { maxWidth: "md" }, [
      "blog-hero", "blog-list", "blog-pagination",
    ]),
    node("blog-hero", "Hero", {
      title: docName,
      subtitle: "记录技术与思考",
      ctaText: "订阅",
      secondaryText: "",
    }),
    node("blog-list", "Section", { title: "最新文章", description: "" }, ["blog-posts"]),
    node("blog-posts", "List", {
      rows: [
        { title: "本地 AI 代码生成的实践", description: "如何用 Ollama 构建离线编程助手", meta: "10-01" },
        { title: "设计系统的演进之路", description: "从 0 到 58 个组件", meta: "09-28" },
        { title: "Tailwind v4 新特性解析", description: "CSS 变量驱动的主题系统", meta: "09-20" },
        { title: "React 19 并发渲染", description: "useTransition 的正确用法", meta: "09-15" },
      ],
    }),
    node("blog-pagination", "Pagination", { current: 1, total: 8 }),
  ]);
}

// ============================================================
// E-commerce — 商品展示
// ============================================================
export function buildEcommerce(docName: string): StudioDocument {
  return docOf(docName, "ecom-root", [
    node("ecom-root", "Container", { maxWidth: "lg" }, [
      "ecom-hero", "ecom-products", "ecom-detail", "ecom-footer",
    ]),
    node("ecom-hero", "Hero", {
      title: docName,
      subtitle: "精选商品，品质保证",
      ctaText: "浏览全部",
      secondaryText: "查看新品",
    }),
    node("ecom-products", "Section", { title: "热门商品", description: "" }, ["ecom-grid"]),
    node("ecom-grid", "Grid", { columns: 3, gap: 4 }, [
      "ecom-p1", "ecom-p2", "ecom-p3",
    ]),
    node("ecom-p1", "Card", { title: "机械键盘", padded: true }, ["ecom-p1-price", "ecom-p1-btn"]),
    node("ecom-p1-price", "Badge", { label: "¥399", tone: "brand" }),
    node("ecom-p1-btn", "Button", { label: "加入购物车", variant: "primary", size: "sm" }),
    node("ecom-p2", "Card", { title: "无线鼠标", padded: true }, ["ecom-p2-price", "ecom-p2-btn"]),
    node("ecom-p2-price", "Badge", { label: "¥199", tone: "brand" }),
    node("ecom-p2-btn", "Button", { label: "加入购物车", variant: "primary", size: "sm" }),
    node("ecom-p3", "Card", { title: "显示器", padded: true }, ["ecom-p3-price", "ecom-p3-btn"]),
    node("ecom-p3-price", "Badge", { label: "¥1,899", tone: "brand" }),
    node("ecom-p3-btn", "Button", { label: "加入购物车", variant: "primary", size: "sm" }),

    node("ecom-detail", "Section", { title: "库存明细", description: "" }, ["ecom-table"]),
    node("ecom-table", "Table", {
      columns: ["商品", "库存", "单价", "状态"],
      rows: [
        ["机械键盘", "45", "¥399", "有货"],
        ["无线鼠标", "120", "¥199", "有货"],
        ["显示器", "12", "¥1,899", "低库存"],
      ],
    }),
    node("ecom-footer", "Footer", {
      columns: [
        { title: "帮助", links: ["配送", "退换", "客服"] },
      ],
      copyright: "© 2026",
    }),
  ]);
}

// ============================================================
// Onboarding — 引导页
// ============================================================
export function buildOnboarding(docName: string): StudioDocument {
  return docOf(docName, "ob-root", [
    node("ob-root", "Container", { maxWidth: "sm" }, [
      "ob-header", "ob-steps", "ob-progress", "ob-form", "ob-actions",
    ]),
    node("ob-header", "Heading", { text: docName, level: 2 }),
    node("ob-steps", "Steps", {
      steps: [
        { title: "创建账号", description: "已完成" },
        { title: "设置偏好", description: "当前步骤" },
        { title: "开始使用", description: "" },
      ],
      current: 1,
    }),
    node("ob-progress", "ProgressRing", { value: 33, size: 64 }),
    node("ob-form", "Form", { title: "偏好设置" }, [
      "ob-f-role", "ob-f-size", "ob-f-notify",
    ]),
    node("ob-f-role", "FormField", { label: "你的角色", required: true, helpText: "帮我们推荐模板" }, ["ob-role"]),
    node("ob-role", "Select", { options: ["开发者", "设计师", "产品经理", "运营"], placeholder: "请选择" }),
    node("ob-f-size", "FormField", { label: "团队规模", required: false, helpText: "" }, ["ob-size"]),
    node("ob-size", "Select", { options: ["个人", "2-10", "11-50", "50+"], placeholder: "个人" }),
    node("ob-f-notify", "FormField", { label: "", required: false, helpText: "" }, ["ob-notify"]),
    node("ob-notify", "Checkbox", { label: "接收产品更新通知", checked: true }),
    node("ob-actions", "Stack", { gap: 2, align: "stretch" }, ["ob-next"]),
    node("ob-next", "Button", { label: "下一步", variant: "primary", size: "lg" }),
  ]);
}

// ============================================================
// Calendar — 日程页
// ============================================================
export function buildCalendar(docName: string): StudioDocument {
  return docOf(docName, "cal-root", [
    node("cal-root", "AppShell", { title: docName, sidebar: true }, [
      "cal-header", "cal-grid",
    ]),
    node("cal-header", "Header", { title: "日程", subtitle: "10月" }),
    node("cal-grid", "Grid", { columns: 3, gap: 4 }, [
      "cal-month", "cal-today", "cal-upcoming",
    ]),
    node("cal-month", "Card", { title: "10月日历", padded: true }, ["cal-calendar"]),
    node("cal-calendar", "Calendar", { month: "2026-10" }),
    node("cal-today", "Card", { title: "今日", padded: true }, ["cal-today-list"]),
    node("cal-today-list", "KeyValList", {
      rows: [
        { key: "09:00", value: "每日站会" },
        { key: "11:00", value: "评审设计稿" },
        { key: "15:00", value: "1v1 沟通" },
        { key: "17:00", value: "写周报" },
      ],
    }),
    node("cal-upcoming", "Card", { title: "本周待办", padded: true }, ["cal-upcoming-timeline"]),
    node("cal-upcoming-timeline", "Timeline", {
      items: [
        { time: "10-15", title: "版本发布", description: "v2.0 全量上线" },
        { time: "10-18", title: "用户访谈", description: "5 位种子用户反馈" },
        { time: "10-22", title: "季度复盘", description: "Q4 OKR 对齐" },
      ],
    }),
  ]);
}
