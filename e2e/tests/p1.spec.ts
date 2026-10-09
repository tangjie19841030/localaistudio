import { expect, test } from "@playwright/test";

/**
 * P1 验收：用户无需 AI，也能拼出并保存一个响应式后台页面。
 * 插入面板在"属性"页签、图层树在"图层"页签：每步插入后切图层页签选目标再切回。
 */
test("P1 验收：无 AI 拼出页面并保存", async ({ page }) => {
  const name = `P1验收-${Date.now()}`;
  await page.goto("/");

  // 新建项目
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill(name);
  await page.getByLabel("页面目标").fill("P1 无 AI 编辑验收");
  await page.getByRole("button", { name: "创建项目" }).click();

  // 等待 openProject 完成：文档名输入框填充服务端初值
  await expect(page.getByRole("complementary", { name: "需求" })).toBeVisible();
  const docName = page.getByLabel("文档名称");
  await expect(docName).toHaveValue(name);

  // 属性栏（插入面板宿主）在 medium 断点默认折叠，先展开；wide 断点本就打开。
  const openRightRail = page.getByRole("button", { name: "切换属性栏" });
  if (await openRightRail.isVisible().catch(() => false)) await openRightRail.click();

  const propsTab = page.getByRole("tab", { name: "属性" });
  const layersTab = page.getByRole("tab", { name: "图层" });
  const treeitem = (re: RegExp) => page.getByRole("treeitem", { name: re });
  // 插入目录在有选中节点时默认折叠（RightPanel: defaultOpen={!selected}），
  // 且节点切换会重挂载重置展开态——每次插入前按需展开。
  const insert = async (title: string) => {
    const toggle = page.getByRole("button", { name: "插入组件" });
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    await page.getByRole("button", { name: `插入 ${title}` }).click();
  };

  // 未选中时插入目标=根（Container）：插入 AppShell
  await insert("应用外壳");
  await layersTab.click();
  await expect(treeitem(/应用外壳/)).toBeVisible();

  // 选中 AppShell → 插入 Header 与 Section 到 AppShell 内
  await treeitem(/应用外壳/).click();
  await propsTab.click();
  await insert("页头");
  await insert("区块");

  // 选中 Section → 插入指标卡×2 与按钮
  await layersTab.click();
  await treeitem(/区块/).click();
  await propsTab.click();
  await insert("指标卡");
  await insert("指标卡");
  await insert("按钮");

  // 预览区出现插入的组件文本（预览=真实渲染）
  await expect(page.getByText("页面标题")).toBeVisible();
  await expect(page.getByText("指标").first()).toBeVisible();
  await expect(page.getByText("区块标题")).toBeVisible();

  // 点选预览里的指标卡 → 属性面板出现 label 控件 → 改文案
  await page.getByText("指标").first().click();
  const labelInput = page.getByLabel("label");
  await labelInput.fill("今日活跃");
  await expect(page.getByText("今日活跃").first()).toBeVisible();

  // Token 编辑：品牌色改动产生未保存态；撤销一次（色回退）；重做（色恢复）
  await page.getByRole("tab", { name: "Token" }).click();
  const brandInput = page.getByLabel("品牌色");
  const initialBrand = (await brandInput.inputValue()).toLowerCase();
  const changedBrand = initialBrand === "#2563eb" ? "#0f766e" : "#2563eb";
  await brandInput.fill(changedBrand);
  await expect(page.getByRole("status")).toHaveText("未保存更改");
  await page.keyboard.press("Control+Z");
  await expect(brandInput).toHaveValue(initialBrand);
  await page.keyboard.press("Control+Shift+Z");
  await expect(brandInput).toHaveValue(changedBrand);

  // 保存
  await page.keyboard.press("Control+S");
  await expect(page.getByRole("status")).toHaveText("已保存");

  // 刷新（模拟重启）→ 重开 → 结构仍在（数据来自磁盘）
  await page.reload();
  await page.getByRole("button", { name: `打开 ${name}` }).click();
  await expect(page.getByRole("status")).toHaveText("已保存");
  await expect(page.getByText("页面标题")).toBeVisible();
  await expect(page.getByText("今日活跃").first()).toBeVisible();

  // 版本历史：存一版命名版本
  await page.getByRole("tab", { name: "版本历史" }).click();
  await page.getByLabel("版本名称").fill("验收基线");
  await page.getByRole("button", { name: "存为版本" }).click();
  // P4 起版本名也出现在「版本对比」下拉的 option 里，断言收敛到版本列表区域
  await expect(
    page.getByRole("region", { name: "版本列表" }).getByText("验收基线"),
  ).toBeVisible();
});
