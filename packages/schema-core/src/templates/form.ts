import type { NodeRecord, StudioDocument } from "../document.js";
import { docOf, node } from "./types.js";

/** One labelled field: FormField wrapper + its control node. */
function field(
  id: string,
  label: string,
  required: boolean,
  helpText: string,
  control: NodeRecord,
): NodeRecord[] {
  return [node(id, "FormField", { label, required, helpText }, [control.id]), control];
}

/** Form: a single-column form card with text/select/textarea fields and actions. */
export function buildForm(docName: string): StudioDocument {
  return docOf(docName, "form-root", [
    node("form-root", "Container", { maxWidth: "md" }, ["form-header", "form-main"]),
    node("form-header", "Header", { title: "新建工单", subtitle: "请填写以下信息后提交" }),
    node("form-main", "Form", { title: "工单信息" }, [
      "form-f-title",
      "form-f-owner",
      "form-f-priority",
      "form-f-desc",
      "form-f-notify",
      "form-actions",
    ]),

    ...field("form-f-title", "标题", true, "简要描述问题", node("form-title", "Input", { placeholder: "请输入标题", type: "text" })),
    ...field("form-f-owner", "负责人邮箱", true, "", node("form-owner", "Input", { placeholder: "name@example.com", type: "email" })),
    ...field("form-f-priority", "优先级", false, "默认中等", node("form-priority", "Select", { options: ["低", "中", "高"], placeholder: "请选择优先级" })),
    ...field("form-f-desc", "详细说明", false, "最多 500 字", node("form-desc", "Textarea", { placeholder: "请输入详细说明", rows: 5 })),
    ...field("form-f-notify", "通知设置", false, "", node("form-notify", "Checkbox", { label: "处理进度变更时通知我", checked: true })),

    node("form-actions", "Stack", { gap: 2, align: "start" }, ["form-submit", "form-cancel"]),
    node("form-submit", "Button", { label: "提交", variant: "primary", size: "md" }),
    node("form-cancel", "Button", { label: "取消", variant: "ghost", size: "md" }),
  ]);
}
