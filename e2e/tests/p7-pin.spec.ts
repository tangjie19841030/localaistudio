import { expect, test } from "@playwright/test";

/**
 * P7 验收：pin/unpin 全链路（Plan C 混合定位）。真实浏览器验证——
 * 画布内键盘微调顶层 flow 节点即 pin（拖拽→pin 的指针路径已由 p5 覆盖，
 * 这里走等价的键盘路径，规避长链路里 pointer 事件链的不稳定）→ pin 盒出现 →
 * 项目预览中该节点绝对定位（left/top 来自 frame）→ PropsForm unpin →
 * 画布回 flow、再生成代码时预览同步回 flow（无定位包装、无内联定位）。
 */
test("P7 验收：nudge 即 pin → 预览绝对定位 → unpin 回 flow", async ({ page }) => {
  test.setTimeout(600_000);
  const name = `P7验收-${Date.now()}`;
  await page.goto("/");

  // 建项目 + mock 生成一页
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill(name);
  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(page.getByRole("complementary", { name: "需求" })).toBeVisible();

  await page.getByLabel("AI 指令").fill("生成一个运营工作台");
  await page.getByRole("button", { name: "发送" }).click();
  const planCard = page.getByRole("region", { name: "变更计划确认卡" });
  await expect(planCard).toBeVisible({ timeout: 15_000 });
  await planCard.getByRole("button", { name: "应用变更" }).click();
  await expect(page.getByText("今日活跃").first()).toBeVisible();

  // 画布模式：m_header 初始是 flow 真实 DOM（无 pin 盒）。
  // 定位口径：flow 层里 data-studio-id 只挂在 NodeSubtree 的 display:contents
  // 标记 div 上（自身无盒），kit 元素只有 data-component（studioId 仅 codegen
  // 注入导出代码），因此用「标记 div 的直接 kit 子」拿到有真实盒的元素。
  await page.getByRole("button", { name: "画布" }).click();
  const flowLayer = page.getByTestId("canvas-flow-layer");
  const flowHeader = flowLayer.locator('[data-studio-id="m_header"] > [data-component]');
  await expect(flowHeader).toBeVisible();
  await expect(page.getByTestId("canvas-frame-m_header")).toHaveCount(0);

  // 量出 flow DOM 的页面坐标作为 pin 基准（初始 zoom=1/pan=0：
  // 页面坐标 = 元素屏幕坐标 - surface 屏幕原点；页面 1440 宽于可视区，
  // 因此下面点选/拖动都贴着节点左缘取点，避免落在可见区之外）。
  const surface = page.getByTestId("canvas-surface");
  const surfaceBox = await surface.boundingBox();
  const headerBox = await flowHeader.boundingBox();
  expect(surfaceBox).toBeTruthy();
  expect(headerBox).toBeTruthy();
  const baseLeft = headerBox!.x - surfaceBox!.x;
  const baseTop = headerBox!.y - surfaceBox!.y;

  // 点选 flow 节点：点击无位移不 pin（R5「拖就走」只认位移/微调）
  await flowHeader.click({ position: { x: 12, y: 8 } });
  await expect(page.getByTestId("canvas-frame-m_header")).toHaveCount(0);

  // 方向键微调 1px：顶层 flow 节点在测量 rect 处 pin 并同 op 移动（单一 undo 步）
  await page.keyboard.press("ArrowRight");

  // pin 盒出现：left = 测量 x + 1、top = 测量 y；flow 层不再渲染 m_header
  // （NodeSubtree 跳过 pin-box 子树；测量值含亚像素，容差 1px）。
  const frame = page.getByTestId("canvas-frame-m_header");
  await expect(frame).toBeVisible({ timeout: 5_000 });
  await expect(frame).toHaveCSS("position", "absolute");
  const pinnedGeo = await frame.evaluate((element) => ({
    left: Number.parseFloat((element as HTMLElement).style.left),
    top: Number.parseFloat((element as HTMLElement).style.top),
  }));
  expect(Math.abs(pinnedGeo.left - (baseLeft + 1))).toBeLessThanOrEqual(1);
  expect(Math.abs(pinnedGeo.top - baseTop)).toBeLessThanOrEqual(1);
  await expect(flowHeader).toHaveCount(0);

  // 项目预览：启动时按当前文档重新生成，pinned 节点应绝对定位。
  await page.getByRole("button", { name: "项目预览" }).click();
  await page.getByRole("button", { name: "启动预览" }).click();
  const iframe = page.getByTestId("project-preview-frame");
  await expect(iframe).toBeVisible({ timeout: 120_000 });
  const previewFrame = page.frameLocator('[data-testid="project-preview-frame"]');
  // codegen 的定位包装 div 无 data-component，内部 Header kit 元素有——以此区分：
  // 包装是页面坐标绝对层（left/top 来自 frame），kit 元素只有 studioId。
  const pinnedNode = previewFrame.locator('[data-studio-id="m_header"]:not([data-component])');
  await expect(pinnedNode).toBeVisible({ timeout: 30_000 });
  const pinnedInline = await pinnedNode.evaluate((el) => {
    const style = (el as HTMLElement).style;
    return { left: style.left, top: style.top, position: style.position };
  });
  expect(pinnedInline.position).toBe("absolute");
  expect(Math.abs(Number.parseFloat(pinnedInline.left) - (baseLeft + 1))).toBeLessThanOrEqual(1);
  expect(Math.abs(Number.parseFloat(pinnedInline.top) - baseTop)).toBeLessThanOrEqual(1);

  // 停止预览 → 回画布 → 打开属性栏 → PropsForm unpin（节点仍处于选中态）。
  // 右栏在 medium 断点默认折叠，先点开；wide 断点本来就开着，故条件点击。
  await page.getByRole("button", { name: "停止预览" }).click();
  await page.getByRole("button", { name: "画布" }).click();
  await expect(frame).toBeVisible();
  const openRightRail = page.getByRole("button", { name: "切换属性栏" });
  if (await openRightRail.isVisible().catch(() => false)) await openRightRail.click();
  await expect(page.getByTestId("props-positioning")).toHaveAttribute("data-positioning", "pinned");
  await page.getByTestId("props-unpin").click();

  // unpin 后：pin 盒消失（pinned 与 frame 一并清除），flow DOM 回来
  await expect(page.getByTestId("canvas-frame-m_header")).toHaveCount(0);
  await expect(flowHeader).toBeVisible();
  await expect(page.getByTestId("props-positioning")).toHaveAttribute("data-positioning", "flow");

  // 重新生成代码 → m_header 回 flow：无绝对定位包装，kit 元素无内联定位
  await page.getByRole("button", { name: "项目预览" }).click();
  await page.getByRole("button", { name: "启动预览" }).click();
  await expect(iframe).toBeVisible({ timeout: 120_000 });
  await expect(
    previewFrame.locator('[data-studio-id="m_header"]:not([data-component])'),
  ).toHaveCount(0);
  const flowNode = previewFrame.locator('[data-component][data-studio-id="m_header"]');
  await expect(flowNode).toBeVisible({ timeout: 30_000 });
  const flowInline = await flowNode.evaluate((el) => {
    const style = (el as HTMLElement).style;
    return { left: style.left, top: style.top, position: style.position };
  });
  expect(flowInline).toEqual({ left: "", top: "", position: "" });
});
