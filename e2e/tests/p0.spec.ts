import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("P0 验收：新建 → 编辑 → 保存 → 刷新后仍在", async ({ page }) => {
  const name = `验收-${Date.now()}`;
  await page.goto("/");

  // 新建项目
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill(name);
  await page.getByLabel("页面目标").fill("P0 验收");
  await page.getByRole("button", { name: "创建项目" }).click();

  // 进入工作台并改名。先等 openProject 的 fetch 把服务端文档名填进输入框，
  // 否则 fill 触发的 setDocumentName 会被 document=null 丢弃，随后又被 fetch 结果覆盖
  await expect(page.getByRole("complementary", { name: "需求" })).toBeVisible();
  const docName = page.getByLabel("文档名称");
  await expect(docName).toHaveValue(name);
  await docName.fill("运营工作台");
  await expect(page.getByRole("status")).toHaveText("未保存更改");

  // Ctrl+S 保存
  await page.keyboard.press("Control+S");
  await expect(page.getByRole("status")).toHaveText("已保存");

  // 返回导航（Task 13 审查采纳）：store 重置、列表复现
  await page.getByRole("button", { name: "返回项目列表" }).click();
  await expect(page.getByRole("main", { name: "项目列表" })).toBeVisible();

  // 重新打开：数据来自磁盘
  await page.getByRole("button", { name: `打开 ${name}` }).click();
  await expect(page.getByRole("status")).toHaveText("已保存");
  await expect(page.getByLabel("文档名称")).toHaveValue("运营工作台");

  // Task 4 审查采纳：确认数据落盘在 <repo>/e2e/.data/projects（而非 apps/server 下）。
  // 从测试文件位置定位（<repo>/e2e/tests → 上两级 = e2e/），不受测试进程 cwd 影响。
  const e2eProjects = resolve(import.meta.dirname, "..", ".data", "projects");
  expect(existsSync(e2eProjects), `数据应落在 ${e2eProjects}`).toBe(true);
  expect(readdirSync(e2eProjects).length).toBeGreaterThan(0);
});
