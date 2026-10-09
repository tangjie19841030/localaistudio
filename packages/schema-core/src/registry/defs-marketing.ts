import { z } from "zod";
import type { ComponentCategory } from "./componentDefs.js";

/** P6 后扩编：marketing品类新组件的注册表定义。 */
export interface NewComponentDef {
  meta: { type: string; title: string; category: ComponentCategory };
  schema: z.ZodTypeAny;
}


export const MARKETING_DEFS: NewComponentDef[] = [
  {
    meta: { type: "Hero", title: "首屏区块", category: "marketing" },
    schema: z.object({ title: z.string().default("构建下一代产品"), subtitle: z.string().default("从想法到上线，一站式完成"), ctaText: z.string().default("立即开始") }),
  },
  {
    meta: { type: "FeatureGrid", title: "特性网格", category: "marketing" },
    schema: z.object({ features: z.array(z.object({ title: z.string(), description: z.string() })).default([{ title: "极速", description: "毫秒级响应" }, { title: "安全", description: "端到端加密" }, { title: "协作", description: "多人实时编辑" }]), columns: z.number().min(1).max(4).default(3) }),
  },
  {
    meta: { type: "PricingCard", title: "定价卡", category: "marketing" },
    schema: z.object({ plan: z.string().default("专业版"), price: z.string().default("¥99"), period: z.string().default("/月"), features: z.array(z.string()).default(["无限项目", "优先支持", "专属客服"]), ctaText: z.string().default("立即订阅"), featured: z.boolean().default(false) }),
  },
  {
    meta: { type: "Testimonial", title: "评价卡", category: "marketing" },
    schema: z.object({ quote: z.string().default("这个工具彻底改变了我们的工作方式。"), author: z.string().default("王小姐"), role: z.string().default("产品经理") }),
  },
  {
    meta: { type: "StatsBanner", title: "统计横幅", category: "marketing" },
    schema: z.object({ stats: z.array(z.object({ label: z.string(), value: z.string() })).default([{ label: "活跃用户", value: "10k+" }, { label: "企业客户", value: "500+" }, { label: "满意度", value: "99%" }]) }),
  },
  {
    meta: { type: "Footer", title: "页脚", category: "marketing" },
    schema: z.object({ columns: z.array(z.object({ title: z.string(), links: z.array(z.string()) })).default([{ title: "产品", links: ["功能", "定价"] }, { title: "公司", links: ["关于", "招聘"] }]), copyright: z.string().default("© 2026 Studio") }),
  },
];
