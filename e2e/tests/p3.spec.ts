import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * P3 验收：mock 生成 → 落盘 → 项目预览 iframe → 导出 zip → 独立目录 install+build 成功。
 */
test("P3 验收：生成代码/预览/导出独立构建", async ({ page }) => {
  // Real work, not UI latency: preview install + export checks (install/tsc/build) +
  // a second offline install & build in the extracted dir. Far past the 120s default.
  test.setTimeout(900_000);
  const name = `P3验收-${Date.now()}`;
  await page.goto("/");

  // 新建项目并用 mock AI 生成一页
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill(name);
  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(page.getByRole("complementary", { name: "需求" })).toBeVisible();
  await expect(page.getByLabel("文档名称")).toHaveValue(name);

  await page.getByLabel("AI 指令").fill("生成一个运营工作台");
  await page.getByRole("button", { name: "发送" }).click();
  const planCard = page.getByRole("region", { name: "变更计划确认卡" });
  await expect(planCard).toBeVisible({ timeout: 15000 });
  await planCard.getByRole("button", { name: "应用变更" }).click();

  // 生成代码（底部坞 Diff 页签）
  await page.getByRole("tab", { name: "Diff" }).click();
  await page.getByRole("button", { name: "生成代码" }).click();
  const fileList = page.getByRole("list", { name: "生成文件列表" });
  await expect(fileList).toBeVisible({ timeout: 30000 });
  // 落盘清单包含页面与 kit 拷贝（first 避免 strict mode 多命中）
  await expect(fileList.getByText(/pages/).first()).toBeVisible();
  await expect(fileList.getByText(/ui-studio/).first()).toBeVisible();

  // 项目预览 iframe
  await page.getByRole("button", { name: "项目预览" }).click();
  await page.getByRole("button", { name: "启动预览" }).click();
  const iframe = page.getByTestId("project-preview-frame");
  await expect(iframe).toBeVisible({ timeout: 60_000 });
  const src = await iframe.getAttribute("src");
  expect(src ?? "").toMatch(/127\.0\.0\.1:51\d\d/);

  // 导出 zip：checks 跑 install/tsc/build，很慢——先等检查阶段结束再决定是否确认
  await page.getByRole("tab", { name: "Diff" }).click();
  const downloadPromise = page.waitForEvent("download", { timeout: 600_000 });
  const exportBtn = page.getByRole("button", { name: /导出 zip|检查中…|导出中…/ });
  await exportBtn.click();
  // checks 未通过时停在 confirm 态并露出「仍然导出」；通过则直接下载
  await expect(exportBtn).not.toHaveText("检查中…", { timeout: 600_000 });
  const stillExport = page.getByRole("button", { name: "仍然导出" });
  if (await stillExport.isVisible().catch(() => false)) await stillExport.click();
  const download = await downloadPromise;

  // 保存 zip 并解压到独立临时目录。必须与仓库同盘：pnpm 的 store 是按盘选的
  // （D: → D:\.pnpm-store），落到 C:\Temp 会命中另一个冷 store 而 --offline 失败。
  const outDir = join(process.cwd(), "..", `p3-export-${Date.now()}`);
  const zipPath = join(outDir, "export.zip");
  mkdirSync(outDir, { recursive: true });
  await download.saveAs(zipPath);
  expect(existsSync(zipPath)).toBe(true);

  // 独立环境安装依赖并构建（P3 硬验收）
  const extractDir = join(outDir, "project");
  mkdirSync(extractDir, { recursive: true });
  // 直接使用 .NET ZipFile，避免受 PowerShell.Archive 模块是否可加载影响。
  execFileSync("powershell", [
    "-Command",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
      `[System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath}', '${extractDir}')`,
  ]);

  // 独立环境安装依赖并构建（P3 硬验收）。Node 拒绝 execFile .cmd，且 shell 拼接不稳——
  // 直接用当前 node 跑 pnpm.cjs（与 server 预览进程同一条路径）。
  const pnpmEnv = { ...process.env, npm_config_proxy: "", npm_config_https_proxy: "", NO_COLOR: "1" };
  const pnpmCjs = join(process.env.USERPROFILE ?? "", ".local", "pnpm", "package", "bin", "pnpm.cjs");
  const runPnpm = (args: string[]): void => {
    try {
      execFileSync(process.execPath, [pnpmCjs, ...args], {
        cwd: extractDir, stdio: "pipe", env: pnpmEnv, timeout: 600_000,
      });
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
      throw new Error(
        `pnpm ${args.join(" ")} 失败:\n${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`,
      );
    }
  };
  runPnpm(["install", "--offline", "--config.proxy=", "--config.https-proxy="]);
  runPnpm(["exec", "vite", "build"]);
  // 构建产物存在
  expect(existsSync(join(extractDir, "dist", "index.html"))).toBe(true);

  rmSync(outDir, { recursive: true, force: true });
});
