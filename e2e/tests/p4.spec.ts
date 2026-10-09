import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * P4 验收：模板建项 → mock 生成 → 生成代码 → 三视口真实截图 →
 * 问题清单 → 视口切换 → snapshots 落盘核对 → 版本对比可用。
 *
 * 用真实 chromium 截三个视口 + 首次预览要装依赖，远超默认 120s 预算。
 */
test("P4 验收：三视口截图/问题清单/版本对比", async ({ page }) => {
  test.setTimeout(900_000);
  const name = `P4验收-${Date.now()}`;
  await page.goto("/");

  // 起始模板建项（P4-5）：选「数据看板」而不是空白
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill(name);
  // 起始模板现在是可键盘操作的卡片画廊；用卡片内的名称定位，
  // 避免与同名的“数据看板”分类按钮混淆。
  const dashboardTemplate = page
    .locator('[role="button"][aria-pressed]')
    .filter({ has: page.locator("p", { hasText: "数据看板" }) })
    .first();
  await expect(dashboardTemplate).toBeVisible({ timeout: 15_000 });
  await dashboardTemplate.click();
  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(page.getByRole("complementary", { name: "需求" })).toBeVisible();
  await expect(page.getByLabel("文档名称")).toHaveValue(name);

  // mock AI 生成一页并应用
  await page.getByLabel("AI 指令").fill("生成一个运营工作台");
  await page.getByRole("button", { name: "发送" }).click();
  const planCard = page.getByRole("region", { name: "变更计划确认卡" });
  await expect(planCard).toBeVisible({ timeout: 15_000 });
  await planCard.getByRole("button", { name: "应用变更" }).click();

  // 生成代码（截图检查要求项目已落盘）
  await page.getByRole("tab", { name: "Diff" }).click();
  await page.getByRole("button", { name: "生成代码" }).click();
  await expect(page.getByRole("list", { name: "生成文件列表" })).toBeVisible({
    timeout: 60_000,
  });

  // 截图检查：真实 Playwright 三视口
  await page.getByRole("tab", { name: "截图检查" }).click();
  await page.getByRole("button", { name: "开始截图检查" }).click();
  // 首次要 pnpm install + 起 vite + 起 chromium 截三张，给足预算
  const desktopShot = page.getByRole("img", { name: "桌面 截图" });
  await expect(desktopShot).toBeVisible({ timeout: 600_000 });
  await expect(page.getByRole("button", { name: "开始截图检查" })).toBeEnabled();

  // 问题清单渲染（可能 0 条问题，此时展示「无问题」）
  const issueList = page.getByRole("list", { name: "问题清单" });
  const noIssues = page.getByText("无问题");
  await expect(issueList.or(noIssues).first()).toBeVisible();

  // 视口切换换图
  await page.getByRole("tab", { name: "手机" }).click();
  await expect(page.getByRole("img", { name: "手机 截图" })).toBeVisible();
  await page.getByRole("tab", { name: "平板" }).click();
  await expect(page.getByRole("img", { name: "平板 截图" })).toBeVisible();

  // 落盘核对：design/snapshots/<runId>/ 三张 PNG + issues.json（P4 硬验收）
  const projectsDir = join(import.meta.dirname, "..", ".data", "projects");
  const projectId = readdirSync(projectsDir).find((id) => {
    const metaFile = join(projectsDir, id, "project.json");
    if (!existsSync(metaFile) || !existsSync(join(projectsDir, id, "design", "snapshots"))) {
      return false;
    }
    return (JSON.parse(readFileSync(metaFile, "utf8")) as { name?: string }).name === name;
  });
  expect(projectId, "应有项目产出 snapshots 目录").toBeTruthy();
  const snapshotsDir = join(projectsDir, projectId as string, "design", "snapshots");
  const runs = readdirSync(snapshotsDir);
  expect(runs.length).toBeGreaterThan(0);
  const runDir = join(snapshotsDir, runs[0] as string);
  for (const file of ["desktop.png", "tablet.png", "mobile.png", "issues.json"]) {
    expect(existsSync(join(runDir, file)), `${file} 应已落盘`).toBe(true);
  }
  const record = JSON.parse(readFileSync(join(runDir, "issues.json"), "utf8")) as {
    runId: string;
    url: string;
    issues: { kind: string; viewport: string }[];
    summary: { total: number };
    shots: { viewport: string; file: string }[];
  };
  expect(record.runId).toBe(runs[0]);
  expect(record.url).toMatch(/127\.0\.0\.1:51\d\d/);
  expect(record.shots.map((s) => s.viewport)).toEqual(["desktop", "tablet", "mobile"]);
  expect(record.summary.total).toBe(record.issues.length);

  // 版本对比：AI 应用变更时已自动存「AI 回退点」，对比视图应可用
  await page.getByRole("tab", { name: "版本历史" }).click();
  const compare = page.getByRole("region", { name: "版本对比" });
  await expect(compare).toBeVisible();
  await expect(compare.getByLabel("对比基准版本")).toBeVisible();
  // 目标侧默认「当前文档」（useVersionDocs 的 CURRENT_DOC 哨兵值）
  await expect(compare.getByLabel("对比目标版本")).toHaveValue("__current__");
});
