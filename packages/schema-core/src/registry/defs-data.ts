import { z } from "zod";
import type { ComponentCategory } from "./componentDefs.js";

/** P6 后扩编：data品类新组件的注册表定义。 */
export interface NewComponentDef {
  meta: { type: string; title: string; category: ComponentCategory };
  schema: z.ZodTypeAny;
}


export const DATA_DEFS: NewComponentDef[] = [
  {
    meta: { type: "Avatar", title: "头像", category: "data" },
    schema: z.object({ name: z.string().default("张三"), src: z.string().default(""), size: z.enum(["sm", "md", "lg"]).default("md") }),
  },
  {
    meta: { type: "AvatarGroup", title: "头像组", category: "data" },
    schema: z.object({ names: z.array(z.string()).default(["张三", "李四", "王五"]), overflowCount: z.number().default(5) }),
  },
  {
    meta: { type: "List", title: "列表", category: "data" },
    schema: z.object({ items: z.array(z.object({ title: z.string(), description: z.string().optional(), meta: z.string().optional() })).default([{ title: "列表项一", description: "描述文本", meta: "3 分钟前" }, { title: "列表项二", description: "描述文本", meta: "1 小时前" }]) }),
  },
  {
    meta: { type: "KeyValList", title: "键值对", category: "data" },
    schema: z.object({ items: z.array(z.object({ key: z.string(), value: z.string() })).default([{ key: "订单编号", value: "SO-0041" }, { key: "客户", value: "李文昊" }]) }),
  },
  {
    meta: { type: "Timeline", title: "时间线", category: "data" },
    schema: z.object({ items: z.array(z.object({ title: z.string().optional(), description: z.string().optional(), time: z.string().optional() })).default([{ title: "订单创建", time: "09:00" }, { title: "支付完成", time: "09:05" }]) }),
  },
  {
    meta: { type: "CodeBlock", title: "代码块", category: "data" },
    schema: z.object({ code: z.string().default("const x = 1;"), language: z.string().default("ts") }),
  },
  {
    meta: { type: "Calendar", title: "日历", category: "data" },
    schema: z.object({ month: z.string().default("2026-09") }),
  },
];
