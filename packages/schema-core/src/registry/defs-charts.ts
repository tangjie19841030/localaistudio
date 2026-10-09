import { z } from "zod";
import type { ComponentCategory } from "./componentDefs.js";

/** P6 后扩编：chart品类新组件的注册表定义。 */
export interface NewComponentDef {
  meta: { type: string; title: string; category: ComponentCategory };
  schema: z.ZodTypeAny;
}


export const CHARTS_DEFS: NewComponentDef[] = [
  {
    meta: { type: "BarChart", title: "柱状图", category: "chart" },
    schema: z.object({ data: z.array(z.object({ label: z.string(), value: z.number() })).default([{ label: "周一", value: 32 }, { label: "周二", value: 48 }, { label: "周三", value: 26 }, { label: "周四", value: 60 }, { label: "周五", value: 44 }]), showValues: z.boolean().default(true) }),
  },
  {
    meta: { type: "LineChart", title: "折线图", category: "chart" },
    schema: z.object({ data: z.array(z.object({ label: z.string(), value: z.number() })).default([{ label: "1 月", value: 20 }, { label: "2 月", value: 38 }, { label: "3 月", value: 30 }, { label: "4 月", value: 52 }]) }),
  },
  {
    meta: { type: "DonutChart", title: "环形图", category: "chart" },
    schema: z.object({ data: z.array(z.object({ label: z.string(), value: z.number() })).default([{ label: "直接访问", value: 40 }, { label: "搜索引擎", value: 35 }, { label: "社交媒体", value: 25 }]) }),
  },
  {
    meta: { type: "Sparkline", title: "迷你趋势图", category: "chart" },
    schema: z.object({ values: z.array(z.number()).default([3, 7, 4, 9, 6, 10]), tone: z.enum(["brand", "success", "danger"]).default("brand") }),
  },
];
