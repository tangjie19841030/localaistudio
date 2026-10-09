import { z } from "zod";
import type { ComponentCategory } from "./componentDefs.js";

/** P6 后扩编：form品类新组件的注册表定义。 */
export interface NewComponentDef {
  meta: { type: string; title: string; category: ComponentCategory };
  schema: z.ZodTypeAny;
}


export const FORMS_DEFS: NewComponentDef[] = [
  {
    meta: { type: "Switch", title: "开关", category: "form" },
    schema: z.object({ checked: z.boolean().default(true), label: z.string().default("通知") }),
  },
  {
    meta: { type: "Radio", title: "单选组", category: "form" },
    schema: z.object({ items: z.array(z.string()).default(["选项一", "选项二", "选项三"]), value: z.string().default("选项一") }),
  },
  {
    meta: { type: "SearchInput", title: "搜索框", category: "form" },
    schema: z.object({ placeholder: z.string().default("搜索…"), value: z.string().default("") }),
  },
  {
    meta: { type: "Slider", title: "滑块", category: "form" },
    schema: z.object({ value: z.number().min(0).max(100).default(40), min: z.number().default(0), max: z.number().default(100) }),
  },
  {
    meta: { type: "InputNumber", title: "数字输入", category: "form" },
    schema: z.object({ value: z.number().default(1), min: z.number().default(0), max: z.number().default(99), step: z.number().default(1) }),
  },
  {
    meta: { type: "DatePicker", title: "日期选择", category: "form" },
    schema: z.object({ value: z.string().default("2026-09-10"), placeholder: z.string().default("选择日期") }),
  },
  {
    meta: { type: "Upload", title: "上传", category: "form" },
    schema: z.object({ hint: z.string().default("点击或拖拽文件到此处上传") }),
  },
];
