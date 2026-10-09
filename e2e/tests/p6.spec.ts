import { expect, test } from "@playwright/test";

/**
 * P6 验收：agent harness。真实浏览器验证——
 * mock 走工具管道后用户可见的三件事：
 * 1. 对话里出现「工具进度」行（tool-call/tool-result 帧）；
 * 2. 确认卡出现「工具轨迹摘要」（经 N 步：成功 X · 失败 Y）；
 * 3. 空间指令（move:）闭环仍通（P5 语义零回归）。
 */
test("P6 验收：agent 工具循环进度与确认卡轨迹", async ({ page }) => {
  test.setTimeout(300_000);
  const name = `P6验收-${Date.now()}`;
  await page.goto("/");

  // 建项目 + mock AI 生成一页（generate 走 propose_document 工具）
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill(name);
  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(page.getByRole("complementary", { name: "需求" })).toBeVisible();

  await page.getByLabel("AI 指令").fill("生成一个运营工作台");
  await page.getByRole("button", { name: "发送" }).click();
  // 执行过程卡片：agent loop 的 tool-call/tool-result 帧渲染为对话内时间线
  // （旧断言用的 aria-label「工具进度」已随 UI 改名为「AI 执行过程」；
  //   进行中/已完成两个态都含该文案，first() 避免 strict 冲突）
  await expect(page.getByRole("group", { name: /AI 执行过程/ }).first()).toBeVisible({ timeout: 15_000 });
  const planCard = page.getByRole("region", { name: "变更计划确认卡" });
  await expect(planCard).toBeVisible({ timeout: 15_000 });
  // 确认卡轨迹摘要：generate 走 propose_document 1 步成功
  await expect(planCard.getByLabel("工具轨迹摘要")).toContainText("经 1 步：成功 1 · 失败 0");
  await planCard.getByRole("button", { name: "应用变更" }).click();

  // patch 模式走多步工具（ensure insert + update/set_frame）
  await page.getByLabel("AI 指令").fill("把标题改成新版标题 target:m_header");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(planCard).toBeVisible({ timeout: 15_000 });
  await planCard.getByRole("button", { name: "应用变更" }).click();

  // 空间指令闭环（P5 语义，P6 管道）：move: → setFrame 工具
  await page.getByLabel("AI 指令").fill("move:m_stat_1:320,80");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(planCard).toBeVisible({ timeout: 15_000 });
  await expect(
    planCard.getByRole("listitem").filter({ hasText: /位置 .*→ \(320, 80\)/ }),
  ).toBeVisible();
  await planCard.getByRole("button", { name: "应用变更" }).click();
  await expect(page.getByText("今日活跃").first()).toBeVisible({ timeout: 15_000 });

  // 画布核验（Plan C 双模式语义）：setFrame 只写 frame、不置 pinned，
  // 遗留 frame 是惰性元数据——m_stat_1 仍在 flow 层以真实 DOM 渲染，且不出现
  // 绝对定位 pin 盒。
  // 定位口径：flow 层里 data-studio-id 只在 NodeSubtree 的 display:contents 标记
  // div 上（它自身无盒），kit 元素只有 data-component（studioId 仅 codegen 注入到
  // 导出代码里），因此用「标记 div 的直接 kit 子」拿到有真实盒的元素。
  await page.getByRole("button", { name: "画布" }).click();
  const flowLayer = page.getByTestId("canvas-flow-layer");
  await expect(flowLayer.locator('[data-studio-id="m_stat_1"] > [data-component]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("canvas-frame-m_stat_1")).toHaveCount(0);
});
