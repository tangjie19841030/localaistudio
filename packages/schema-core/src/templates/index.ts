import { buildDashboard } from "./dashboard.js";
import { buildForm } from "./form.js";
import { buildListDetail } from "./listDetail.js";
import {
  buildLanding,
  buildLogin,
  buildSettings,
  buildProfile,
  buildAnalytics,
  buildPricing,
  buildMessages,
  buildBlog,
  buildEcommerce,
  buildOnboarding,
  buildCalendar,
} from "./gallery.js";
import { buildSaasSite } from "./saasSite.js";
import { buildBlogSite } from "./blogSite.js";
import { buildShopFlow } from "./shopFlow.js";
import { buildAccountCenter } from "./accountCenter.js";
import { buildOpsDashboard } from "./opsDashboard.js";
import { buildAuthFlow } from "./authFlow.js";
import type { StudioTemplate } from "./types.js";

export type { StudioTemplate } from "./types.js";
export * from "./tokenPresets.js";

/** Fixed declaration order — the template picker renders this sequence. */
export const TEMPLATES: StudioTemplate[] = [
  // 数据看板
  {
    id: "dashboard",
    name: "数据看板",
    description: "应用外壳 + 四个指标卡 + 最新数据表格，适合运营概览页。",
    category: "数据看板",
    suggestedPreset: "default",
    build: buildDashboard,
  },
  {
    id: "analytics",
    name: "数据分析",
    description: "折线图 + 环形图 + 指标卡 + 时间筛选，适合数据分析与报表页。",
    category: "数据看板",
    suggestedPreset: "slate",
    build: buildAnalytics,
  },
  // 管理后台
  {
    id: "list-detail",
    name: "列表详情",
    description: "左侧筛选列表 + 右侧详情卡与操作按钮，适合记录管理页。",
    category: "管理后台",
    suggestedPreset: "slate",
    build: buildListDetail,
  },
  {
    id: "form",
    name: "表单页",
    description: "单列表单，含输入框、下拉、多行输入与提交操作，适合创建/编辑页。",
    category: "管理后台",
    suggestedPreset: "default",
    build: buildForm,
  },
  {
    id: "settings",
    name: "设置页",
    description: "分组表单、密码修改、通知开关、危险操作区，适合系统设置。",
    category: "管理后台",
    suggestedPreset: "slate",
    build: buildSettings,
  },
  {
    id: "profile",
    name: "个人中心",
    description: "头像 + 基本信息 + 账户安全 + 活动记录，适合用户个人页。",
    category: "管理后台",
    suggestedPreset: "default",
    build: buildProfile,
  },
  {
    id: "messages",
    name: "消息中心",
    description: "左侧消息列表 + 右侧消息详情 + 快捷操作，适合站内信/通知页。",
    category: "管理后台",
    suggestedPreset: "default",
    build: buildMessages,
  },
  // 认证
  {
    id: "login",
    name: "登录注册",
    description: "居中卡片式登录表单 + 第三方登录入口 + 注册切换，适合认证页。",
    category: "认证",
    suggestedPreset: "default",
    build: buildLogin,
  },
  {
    id: "onboarding",
    name: "引导流程",
    description: "分步引导 + 进度指示 + 步骤表单，适合新手引导/初始化配置。",
    category: "认证",
    suggestedPreset: "default",
    build: buildOnboarding,
  },
  // 营销
  {
    id: "landing",
    name: "产品落地页",
    description: "Hero + 特性网格 + 用户评价 + 数据指标 + 页脚，适合 SaaS 产品首页。",
    category: "营销",
    suggestedPreset: "default",
    build: buildLanding,
  },
  {
    id: "pricing",
    name: "定价方案",
    description: "三档定价卡 + 月/年切换 + FAQ + CTA 区域，适合价格与套餐页。",
    category: "营销",
    suggestedPreset: "default",
    build: buildPricing,
  },
  {
    id: "blog",
    name: "博客列表",
    description: "文章卡片网格 + 分类筛选 + 搜索框 + 分页，适合内容展示页。",
    category: "营销",
    suggestedPreset: "slate",
    build: buildBlog,
  },
  {
    id: "ecommerce",
    name: "电商商品",
    description: "商品卡片网格 + 筛选侧边栏 + 排序 + 分页，适合商品列表/商城页。",
    category: "营销",
    suggestedPreset: "default",
    build: buildEcommerce,
  },
  {
    id: "calendar",
    name: "日程日历",
    description: "月视图日历 + 日程列表 + 新增按钮，适合日程管理与预约页。",
    category: "管理后台",
    suggestedPreset: "default",
    build: buildCalendar,
  },
  // 多页组合（W1-C）：每个模板产出多页 StudioDocument
  {
    id: "saas-site",
    name: "营销官网组合",
    description: "首页 + 定价两页组合：Hero、特性网格、客户评价、CTA、三档定价、功能对比与 FAQ，适合 SaaS 官网。",
    category: "营销",
    suggestedPreset: "default",
    build: buildSaasSite,
  },
  {
    id: "blog-site",
    name: "博客站点组合",
    description: "博客列表 + 文章详情两页组合：分类筛选、精选文章、正文排版与相关阅读，适合内容站。",
    category: "营销",
    suggestedPreset: "slate",
    build: buildBlogSite,
  },
  {
    id: "shop-flow",
    name: "电商购物流程",
    description: "商品列表 + 购物车 + 结账三页组合：商品卡片、订单明细、收货与支付表单，适合电商演示。",
    category: "营销",
    suggestedPreset: "warm",
    build: buildShopFlow,
  },
  {
    id: "account-center",
    name: "账号中心组合",
    description: "个人中心 + 账号设置两页组合：资料、动态、安全与通知偏好，适合用户系统。",
    category: "管理后台",
    suggestedPreset: "slate",
    build: buildAccountCenter,
  },
  {
    id: "ops-dashboard",
    name: "运营看板组合",
    description: "运营概览 + 订单管理两页组合：指标卡、趋势图表、热销榜与订单表格，适合电商运营。",
    category: "数据看板",
    suggestedPreset: "teal",
    build: buildOpsDashboard,
  },
  {
    id: "auth-flow",
    name: "认证流程组合",
    description: "登录 + 注册两页组合：账号密码、验证码与 SSO 登录、条款确认，适合认证闭环。",
    category: "认证",
    suggestedPreset: "default",
    build: buildAuthFlow,
  },
];

export function templateById(id: string): StudioTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** All template ids in declaration order. */
export function listTemplateIds(): string[] {
  return TEMPLATES.map((t) => t.id);
}

