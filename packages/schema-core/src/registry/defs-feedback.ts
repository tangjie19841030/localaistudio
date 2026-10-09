import { z } from "zod";
import type { ComponentCategory } from "./componentDefs.js";

/** P6 后扩编：feedback品类新组件的注册表定义。 */
export interface NewComponentDef {
  meta: { type: string; title: string; category: ComponentCategory };
  schema: z.ZodTypeAny;
}


export const FEEDBACK_DEFS: NewComponentDef[] = [
  {
    meta: { type: "Alert", title: "警告条", category: "feedback" },
    schema: z.object({ tone: z.enum(["info", "success", "warning", "danger"]).default("info"), title: z.string().default("提示标题"), description: z.string().default("说明文本") }),
  },
  {
    meta: { type: "Progress", title: "进度条", category: "feedback" },
    schema: z.object({ value: z.number().min(0).max(100).default(68), label: z.string().default("") }),
  },
  {
    meta: { type: "ProgressRing", title: "环形进度", category: "feedback" },
    schema: z.object({ value: z.number().min(0).max(100).default(72), size: z.number().min(48).max(240).default(96) }),
  },
  {
    meta: { type: "Skeleton", title: "骨架屏", category: "feedback" },
    schema: z.object({ variant: z.enum(["text", "card", "avatar"]).default("text"), rows: z.number().min(1).max(8).default(3) }),
  },
  {
    meta: { type: "Toast", title: "消息提示", category: "feedback" },
    schema: z.object({ tone: z.enum(["info", "success", "warning", "danger"]).default("success"), text: z.string().default("已保存") }),
  },
  {
    meta: { type: "Tooltip", title: "气泡提示", category: "feedback" },
    schema: z.object({ text: z.string().default("提示内容"), anchor: z.string().default("悬停查看") }),
  },
];
