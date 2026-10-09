import { z } from "zod";
import type { ComponentCategory } from "./componentDefs.js";

/** P6 后扩编：navigation品类新组件的注册表定义。 */
export interface NewComponentDef {
  meta: { type: string; title: string; category: ComponentCategory };
  schema: z.ZodTypeAny;
}


export const NAVIGATION_DEFS: NewComponentDef[] = [
  {
    meta: { type: "Tabs", title: "页签", category: "navigation" },
    schema: z.object({ items: z.array(z.union([z.string(), z.object({ key: z.string().optional(), label: z.string().optional() })])).default(["全部", "进行中", "已完成"]), activeIndex: z.number().min(0).default(0) }),
  },
  {
    meta: { type: "Breadcrumb", title: "面包屑", category: "navigation" },
    schema: z.object({ items: z.array(z.union([z.string(), z.object({ label: z.string().optional() })])).default(["首页", "列表", "详情"]) }),
  },
  {
    meta: { type: "Pagination", title: "分页", category: "navigation" },
    schema: z.object({ page: z.number().min(1).default(1), pageCount: z.number().min(1).default(12) }),
  },
  {
    meta: { type: "Steps", title: "步骤条", category: "navigation" },
    schema: z.object({ items: z.array(z.union([z.string(), z.object({ label: z.string().optional(), description: z.string().optional() })])).default(["提交", "审核", "完成"]), current: z.number().min(0).default(1) }),
  },
  {
    meta: { type: "BottomNav", title: "底部导航", category: "navigation" },
    schema: z.object({ items: z.array(z.union([z.string(), z.object({ key: z.string().optional(), label: z.string().optional() })])).default(["首页", "发现", "消息", "我的"]), activeIndex: z.number().min(0).default(0) }),
  },
];
