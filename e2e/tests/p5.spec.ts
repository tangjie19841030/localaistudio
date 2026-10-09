import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * P5 验收：自由画布（Plan C 混合定位语义）。真实浏览器验证——
 * AI 空间指令只写惰性 frame（flow DOM 渲染，无 pin 盒）→
 * 拖拽顶层 flow 节点即 pin（pin 盒出现）→ 缩放/键盘微调/撤销/删除 →
 * 生成代码：pinned 节点在预览中绝对定位、未 pinned 遗留 frame 不产出定位包装。
 * 拖拽物理效果 jsdom 测不了，全部在此覆盖。
 */

/** Canvas 画布内拖动（pointer 事件序列，模拟真实手势）。坐标为屏幕坐标。 */
async function screenDrag(
  page: Page,
  from: { x: number; y: number },
  delta: { x: number; y: number },
  modifiers?: { shift?: boolean },
) {
  await page.mouse.move(from.x, from.y);
  if (modifiers?.shift) await page.keyboard.down("Shift");
  await page.mouse.down();
  // 三步拖动更接近真实手势，也给吸附逻辑生效的机会
  for (const step of [0.25, 0.5, 0.75, 1]) {
    await page.mouse.move(from.x + delta.x * step, from.y + delta.y * step);
  }
  await page.mouse.up();
  if (modifiers?.shift) await page.keyboard.up("Shift");
}

test("P5 验收：自由画布拖拽即 pin/缩放/撤销/生成", async ({ page }) => {
  test.setTimeout(600_000);
  const name = `P5验收-${Date.now()}`;
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

  // AI 空间指令：move:m_stat_1 → setFrame 闭环（只写 frame，不置 pinned）
  await page.getByLabel("AI 指令").fill("move:m_stat_1:320,80");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(planCard).toBeVisible({ timeout: 15_000 });
  // 确认卡里 frame 变更是人话（位置/尺寸），不是裸 JSON
  await expect(
    planCard.getByRole("listitem").filter({ hasText: /位置 .*→ \(320, 80\)/ }),
  ).toBeVisible();
  await planCard.getByRole("button", { name: "应用变更" }).click();
  await expect(page.getByText("今日活跃").first()).toBeVisible();

  // 切画布模式（Plan C 双模式）：未 pinned 的 m_stat_1 是 flow 真实 DOM——
  // data-studio-id 命中、无绝对定位 pin 盒（遗留 frame 惰性）。
  // NodeSubtree 的 display:contents 标记 div 带 data-studio-id 但无真实盒；
  // kit 元素带 data-component 但不带 data-studio-id（studioId 只在 codegen 注入）。
  // 用「标记 div 的直接 kit 子」收敛到有真实盒的元素。
  await page.getByRole("button", { name: "画布" }).click();
  const flowLayer = page.getByTestId("canvas-flow-layer");
  const flowStat = flowLayer.locator('[data-studio-id="m_stat_1"] > [data-component]');
  await expect(flowStat).toBeVisible();
  await expect(page.getByTestId("canvas-frame-m_stat_1")).toHaveCount(0);

  // 滚轮缩小 → 双重缩放回归的真实浏览器核验：flow 层与白纸在同一 scale(zoom)
  // 内容层内，getBoundingClientRect 宽相等且 ≈ 1440*zoom，不是 1440*zoom^2。
  // 注意：必须用 page.evaluate 在单次同步快照里读 transform + rect（Playwright
  // 的 boundingBox 会与 React 重渲提交竞态，量到旧帧）。同帧读两者天然一致。
  const surface = page.getByTestId("canvas-surface");
  const surfaceBox = await surface.boundingBox();
  expect(surfaceBox).toBeTruthy();
  await page.mouse.move(surfaceBox!.x + 400, surfaceBox!.y + 400);
  await page.mouse.wheel(0, 120); // 滚轮向下 ×3 → 明确 zoom<1（zoom^2 与 zoom 差异可辨）
  await page.mouse.wheel(0, 120);
  await page.mouse.wheel(0, 120);
  const zoomMeas = await page.evaluate(() => {
    const content = document.querySelector('[data-testid="canvas-page-content"]') as HTMLElement | null;
    const flow = document.querySelector('[data-testid="canvas-flow-layer"]') as HTMLElement | null;
    const overlay = document.querySelector('[data-testid="canvas-overlay-layer"]') as HTMLElement | null;
    if (!content || !flow || !overlay) throw new Error("canvas layers missing");
    const m = /^scale\(([\d.]+)\)$/.exec(content.style.transform);
    if (!m) throw new Error(`unexpected transform: ${content.style.transform}`);
    return {
      zoom: Number(m[1]),
      contentW: content.getBoundingClientRect().width,
      flowW: flow.getBoundingClientRect().width,
      overlayW: overlay.getBoundingClientRect().width,
      overlayPointerEvents: getComputedStyle(overlay).pointerEvents,
    };
  });
  expect(zoomMeas.zoom).toBeLessThan(1);
  expect(zoomMeas.contentW).toBeGreaterThan(0);
  // flow 层视觉宽 = 白纸视觉宽 = 1440*zoom（同一 scale，绝不二次缩放）
  expect(Math.abs(zoomMeas.flowW - zoomMeas.contentW)).toBeLessThan(1);
  expect(Math.abs(zoomMeas.contentW - 1440 * zoomMeas.zoom)).toBeLessThan(1);
  expect(Math.abs(zoomMeas.flowW - 1440 * zoomMeas.zoom)).toBeLessThan(1);
  // 覆盖 wrapper 放行交互（阻塞项修复的 DOM 证明）
  expect(zoomMeas.overlayPointerEvents).toBe("none");
  expect(Math.abs(zoomMeas.overlayW - 1440 * zoomMeas.zoom)).toBeLessThan(1);
  // 还原视口（100% + 原点）——后续拖拽基准按 zoom=1/pan=0 计算
  await page.getByTitle("重置视口（100% 并回到原点）").click();
  await expect(page.getByTestId("canvas-zoom")).toHaveText("100%");

  // 拖拽顶层 flow 节点 m_section 即 pin：量出 flow DOM 的页面坐标作为 pin 基准。
  // viewport 已重置 zoom=1/pan=0，页面坐标 = 元素屏幕坐标 - surface 屏幕原点。
  const flowSection = flowLayer.locator('[data-studio-id="m_section"] > [data-component]');
  const sectionBox = await flowSection.boundingBox();
  expect(sectionBox).toBeTruthy();
  const baseLeft = sectionBox!.x - surfaceBox!.x;
  const baseTop = sectionBox!.y - surfaceBox!.y;
  // 抓取点避开子节点（点进子节点会命中深层 flow 节点，不可拖——R7）：
  // Section 左上角内侧落在 Section 自身 padding/标题区。
  await screenDrag(
    page,
    { x: sectionBox!.x + 12, y: sectionBox!.y + 8 },
    { x: 100, y: 40 },
  );

  // pin 盒出现：pinned && frame → 绝对定位盒，left/top = 测量 rect + 拖动增量
  // （本场景无任何 pinned 吸附目标，落点精确；测量值含亚像素，容差 1px）。
  const frame = page.getByTestId("canvas-frame-m_section");
  await expect(frame).toBeVisible({ timeout: 5_000 });
  await expect(frame).toHaveCSS("position", "absolute");
  const pinnedGeo = await frame.evaluate((element) => ({
    left: Number.parseFloat((element as HTMLElement).style.left),
    top: Number.parseFloat((element as HTMLElement).style.top),
  }));
  expect(Math.abs(pinnedGeo.left - (baseLeft + 100))).toBeLessThanOrEqual(1);
  expect(Math.abs(pinnedGeo.top - (baseTop + 40))).toBeLessThanOrEqual(1);
  // flow 层不再渲染 m_section（NodeSubtree 跳过 pin-box 子树）
  await expect(flowSection).toHaveCount(0);

  // Shift 等比缩放：节点右边缘超出当前浏览器视口，因此使用可见的 nw
  // 手柄向右缩小 60px，验证真实指针命中、宽高同比变化和后续代码生成。
  const handle = frame.locator('[data-handle="nw"]');
  const hBox = await handle.boundingBox();
  const fBox = await frame.boundingBox();
  expect(hBox).toBeTruthy();
  expect(fBox).toBeTruthy();
  const oldRatio = fBox!.height / fBox!.width;
  await page.mouse.move(hBox!.x + 3, hBox!.y + 3);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(hBox!.x + 3 + 60, hBox!.y + 3);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const fBox2 = await frame.boundingBox();
  const newRatio = fBox2!.height / fBox2!.width;
  expect(Math.abs(newRatio - oldRatio)).toBeLessThan(0.05); // 等比保持
  expect(fBox2!.width - fBox!.width).toBeLessThan(-30); // 宽度确实变了
  const resizedLeft = await frame.evaluate((element) => Number.parseFloat((element as HTMLElement).style.left));
  const resizedTop = await frame.evaluate((element) => Number.parseFloat((element as HTMLElement).style.top));

  // 键盘微调：选中节点（拖动已选中）→ 方向键 1px
  const leftBefore = fBox2!.x;
  await page.keyboard.press("ArrowRight");
  const fBox3 = await frame.boundingBox();
  expect(fBox3!.x).toBe(leftBefore + 1);

  // 撤销一笔：应回到「键盘微调前」（一次手势 = 一条撤销）
  await page.keyboard.press("Control+Z");
  const fBox4 = await frame.boundingBox();
  expect(fBox4!.x).toBe(leftBefore);

  // Delete 删除节点 → 画布上消失
  await page.keyboard.press("Delete");
  await expect(frame).toHaveCount(0);

  // 撤销恢复
  await page.keyboard.press("Control+Z");
  await expect(frame).toBeVisible();

  // 回 flow 预览：旧渲染不回归（P5 向后兼容契约）
  await page.getByRole("button", { name: "Schema 预览" }).click();
  await expect(page.getByText("今日活跃").first()).toBeVisible();

  // 生成代码（Diff 页签）→ 项目预览 iframe
  await page.getByRole("tab", { name: "Diff" }).click();
  await page.getByRole("button", { name: "生成代码" }).click();
  const fileList = page.getByRole("list", { name: "生成文件列表" });
  await expect(fileList).toBeVisible({ timeout: 60_000 });
  await fileList.getByText(/pages/).first().click();

  await page.getByRole("button", { name: "项目预览" }).click();
  await page.getByRole("button", { name: "启动预览" }).click();
  const iframe = page.getByTestId("project-preview-frame");
  await expect(iframe).toBeVisible({ timeout: 120_000 });
  // 注意不能走 page.evaluate + contentDocument：外层页是 localhost:5173，预览
  // iframe 是 127.0.0.1:5180，host 不同即跨源，contentDocument 恒为 null。
  // Playwright 的 frame 定位器走独立的注入通道，不受同源限制。
  const previewFrame = page.frameLocator(
    '[data-testid="project-preview-frame"]',
  );

  // Plan C codegen 双模式核验：
  // (a) pinned 的 m_section → 绝对定位包装 div（left/top 来自 frame 页面坐标）。
  //     包装 div 无 data-component、内部 Section kit 元素有——以此区分两者。
  const sectionNode = previewFrame.locator('[data-studio-id="m_section"]:not([data-component])');
  await expect(sectionNode).toBeVisible({ timeout: 30_000 });
  const sectionInline = await sectionNode.evaluate((el) => {
    const style = (el as HTMLElement).style;
    return { left: style.left, top: style.top, position: style.position };
  });
  expect(sectionInline.position).toBe("absolute");
  expect(Number.parseFloat(sectionInline.left)).toBe(resizedLeft);
  expect(Number.parseFloat(sectionInline.top)).toBe(resizedTop);

  // (b) 未 pinned 的 m_stat_1（遗留 frame 惰性）→ flow 渲染，无内联定位。
  //     它位于 pinned 的 m_section 子树内，自身只命中 kit 元素一次。
  const statNode = previewFrame.locator('[data-component][data-studio-id="m_stat_1"]');
  await expect(statNode).toBeVisible({ timeout: 30_000 });
  const statNodeInline = await statNode.evaluate((el) => {
    const style = (el as HTMLElement).style;
    return { left: style.left, top: style.top, position: style.position };
  });
  expect(statNodeInline).toEqual({ left: "", top: "", position: "" });

  // 保存后磁盘侧核验：document/document.json 里 m_section pinned + frame
  // （生成走内存文档，磁盘是保存时的真值——先保存再断言，三者一致）
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("status")).toHaveText("已保存");
  const projectsDir = join(import.meta.dirname, "..", ".data", "projects");
  // 全套 E2E 会有多个项目目录（每个 spec 建一个）——按项目名找本项目；
  // 注意文档 name 会被 AI 生成改写（「运营工作台」），只能用 project.json 的 meta.name。
  const projectId = readdirSync(projectsDir).find((id) => {
    const metaFile = join(projectsDir, id, "project.json");
    if (!existsSync(metaFile)) return false;
    return (JSON.parse(readFileSync(metaFile, "utf8")) as { name?: string }).name === name;
  });
  expect(projectId).toBeTruthy();
  const envelope = JSON.parse(
    readFileSync(join(projectsDir, projectId as string, "document", "document.json"), "utf8"),
  ) as { document: { nodes: { id: string; pinned?: boolean; frame?: { x: number } }[] } };
  const section = envelope.document.nodes.find((n: { id: string }) => n.id === "m_section");
  expect(section?.pinned).toBe(true);
  expect(section?.frame?.x).toBe(resizedLeft);
  // 未 pinned 的遗留 frame 仍在文档里（setFrame 写的元数据，unpin 才会清）
  const stat = envelope.document.nodes.find((n: { id: string }) => n.id === "m_stat_1");
  expect(stat?.pinned).toBeUndefined();
  expect(stat?.frame?.x).toBe(320);
});
