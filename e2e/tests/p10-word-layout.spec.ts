import { expect, test } from "@playwright/test";

test("Word 窄屏交付条不挤压画布且两侧入口真实可点击", async ({ page }) => {
  const name = `Word窄屏布局-${Date.now()}`;
  await page.goto("/");

  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill(name);
  await page.getByRole("radio", { name: "Word 文档" }).check();
  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(page.getByLabel("Word 编辑器")).toBeVisible();

  await page.setViewportSize({ width: 320, height: 720 });
  const layout = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>('[aria-label="Word 编辑器"]');
    const content = editor?.querySelector<HTMLElement>('[data-word-editor-content]');
    const delivery = editor?.querySelector<HTMLElement>('[data-word-delivery-footer]');
    const auxiliaryToggle = editor?.querySelector<HTMLButtonElement>('[aria-label="切换辅助栏"]');
    if (!editor || !content || !delivery || !auxiliaryToggle) {
      throw new Error("Word 窄屏布局节点缺失");
    }
    const rect = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom };
    };
    const toggleRect = rect(auxiliaryToggle);
    const hit = document.elementFromPoint(
      toggleRect.x + toggleRect.width / 2,
      toggleRect.y + toggleRect.height / 2,
    );
    return {
      viewportWidth: window.innerWidth,
      bodyWidth: document.body.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      content: rect(content),
      delivery: rect(delivery),
      toggle: toggleRect,
      hit: hit?.closest("button")?.getAttribute("aria-label") ?? null,
    };
  });

  expect(layout.viewportWidth).toBe(320);
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.delivery.height).toBeLessThanOrEqual(72);
  expect(layout.content.height).toBeGreaterThanOrEqual(layout.toggle.height);
  expect(layout.toggle.bottom).toBeLessThanOrEqual(layout.content.bottom);
  expect(layout.hit).toBe("切换辅助栏");

  const canvas = page.getByLabel("文档画布");
  const canvasMetrics = await canvas.evaluate((element) => {
    const node = element as HTMLElement;
    const pageSurface = node.querySelector<HTMLElement>('[aria-label="第 1 页"]');
    if (!pageSurface) throw new Error("Word 页面节点缺失");
    return {
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      pageWidth: pageSurface.getBoundingClientRect().width,
    };
  });
  expect(canvasMetrics.pageWidth).toBeGreaterThan(590);
  expect(canvasMetrics.scrollWidth).toBeGreaterThan(canvasMetrics.clientWidth);
  const rightEdge = await canvas.evaluate((element) => {
    const node = element as HTMLElement;
    node.scrollLeft = node.scrollWidth;
    const pageSurface = node.querySelector<HTMLElement>('[aria-label="第 1 页"]');
    if (!pageSurface) throw new Error("Word 页面节点缺失");
    const canvasRect = node.getBoundingClientRect();
    return { pageRight: pageSurface.getBoundingClientRect().right, canvasRight: canvasRect.right };
  });
  expect(rightEdge.pageRight).toBeLessThanOrEqual(rightEdge.canvasRight + 1);

  await page.getByRole("button", { name: "切换辅助栏" }).click();
  await expect(page.getByRole("dialog", { name: "辅助栏" })).toBeVisible();

  await page.getByRole("button", { name: "关闭辅助栏" }).click();
  await page.getByRole("button", { name: "打开打印预览" }).click();
  await expect(page.getByRole("dialog", { name: "打印预览" })).toBeVisible();
  await expect(page.getByTestId("print-preview-pages")).toBeVisible();
  await page.getByRole("button", { name: "关闭打印预览" }).click();
  await expect(page.getByRole("dialog", { name: "打印预览" })).toHaveCount(0);
});
