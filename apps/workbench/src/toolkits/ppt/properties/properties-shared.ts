import type { PptSlideObject } from "@studio/ppt-toolkit";

export const kindLabel: Record<PptSlideObject["kind"], string> = {
  text: "文本", shape: "形状", image: "图片", video: "视频", table: "表格", chart: "图表", group: "分组", placeholder: "占位符",
};

export function objectText(object: PptSlideObject): string {
  if (object.kind === "text") {
    return object.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
  }
  return "";
}
