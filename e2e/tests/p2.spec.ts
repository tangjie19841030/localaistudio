import { expect, test } from "@playwright/test";

/**
 * P2 验收冒烟（mock provider，无网络）：
 * 需求生成单页 → 确认应用 → 选中卡片局部修改（只有该卡片变化）→ 撤销回退。
 * 注意：AI 对话历史里会回显含相同文案的 JSON，预览断言必须限定 preview-frame。
 */
test("P2 验收：mock 生成单页 + 局部修改 + 回退", async ({ page }) => {
  const name = `P2验收-${Date.now()}`;
  await page.goto("/");

  // 新建项目
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill(name);
  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(page.getByRole("complementary", { name: "需求" })).toBeVisible();
  await expect(page.getByLabel("文档名称")).toHaveValue(name);

  // 预览内容都限定在 preview-frame 内断言/点选
  const preview = page.getByTestId("preview-frame");

  // 整页生成（mock 关键词"生成"）
  const chatInput = page.getByLabel("AI 指令");
  await chatInput.fill("生成一个运营工作台");
  await page.getByRole("button", { name: "发送" }).click();

  // 流式结束后出现确认卡（三要素齐备）
  const planCard = page.getByRole("region", { name: "变更计划确认卡" });
  await expect(planCard).toBeVisible({ timeout: 15000 });
  await expect(planCard.getByRole("button", { name: "应用变更" })).toBeEnabled();

  // 应用：预览出现生成的页面文本
  await planCard.getByRole("button", { name: "应用变更" }).click();
  await expect(preview.getByText("今日活跃")).toBeVisible();
  await expect(preview.getByText("转化率")).toBeVisible();

  // 局部修改：选中第一张指标卡（预览点选）
  await preview.getByText("今日活跃").click();

  // patch 模式：消息自动拼 target:<选中id>
  await chatInput.fill("修改成紧凑样式");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(planCard).toBeVisible({ timeout: 15000 });
  await planCard.getByRole("button", { name: "应用变更" }).click();

  // 只有目标卡片变化：label 变为 mock 的"更新后的指标"；其他文本不变
  await expect(preview.getByText("更新后的指标")).toBeVisible();
  await expect(preview.getByText("转化率")).toBeVisible();

  // 回退：撤销一步（applyOp 入栈）恢复修改前
  await page.keyboard.press("Control+Z");
  await expect(preview.getByText("今日活跃")).toBeVisible();

  // 保存
  await page.keyboard.press("Control+S");
  await expect(page.getByRole("status")).toHaveText("已保存");
});
