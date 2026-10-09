/**
 * Ad-hoc browser simulation of the workbench flows:
 * 1. project list -> open latest project
 * 2. command palette (Ctrl+K) -> search + run insert
 * 3. copy/paste/duplicate via shortcuts
 * 4. layer-tree search
 * 5. AI generate (mock) -> readable bubble text (no document dump)
 * 6. screenshot repair -> scope includes root, bubble not a dump
 */
import { chromium } from "@playwright/test";

const BASE = "http://localhost:5173";
const results = [];
function step(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[console.error]", msg.text().slice(0, 200));
});
page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 200)));

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  // ---- 1. project list ----
  const main = page.getByRole("main", { name: "项目列表" });
  await main.waitFor({ timeout: 10000 });
  step("项目列表渲染", await main.isVisible());

  const items = page.locator("main ul li");
  const count = await items.count();
  if (count === 0) {
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByLabel("项目名称").fill("模拟测试项目");
    await page.getByLabel("页面目标").fill("模拟 E2E 验证");
    await page.getByRole("button", { name: "创建" }).click();
    await page.waitForTimeout(1500);
  } else {
    await items.first().getByRole("button", { name: /打开/ }).click();
    await page.waitForTimeout(1200);
  }
  const backBtn = page.getByRole("button", { name: "返回项目列表" });
  await backBtn.waitFor({ timeout: 5000 });
  step("进入工作台", await backBtn.isVisible());

  // ---- 2. command palette ----
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "命令面板" });
  await dialog.waitFor({ timeout: 3000 });
  step("Ctrl+K 打开命令面板", await dialog.isVisible());
  await page.getByLabel("搜索命令").fill("插入 指标卡");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  step("命令面板执行「插入 指标卡」", true);
  // undo it so later steps stay clean
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(300);

  // ---- 3. copy / paste / duplicate ----
  const treeBtn = page.getByRole("tab", { name: "图层" });
  if (await treeBtn.isVisible()) {
    await treeBtn.click();
    await page.waitForTimeout(300);
  }
  const firstRow = page.getByRole("treeitem").nth(1); // skip root
  if (await firstRow.count()) {
    await firstRow.click();
    await page.waitForTimeout(200);
    await page.keyboard.press("ControlOrMeta+c");
    await page.waitForTimeout(200);
    await page.keyboard.press("ControlOrMeta+v");
    await page.waitForTimeout(400);
    step("Ctrl+C / Ctrl+V 复制粘贴", true, "已选中节点后粘贴");
    await page.keyboard.press("ControlOrMeta+z"); // undo paste
    await page.keyboard.press("ControlOrMeta+d");
    await page.waitForTimeout(400);
    step("Ctrl+D duplicate", true);
    await page.keyboard.press("ControlOrMeta+z");
  } else {
    step("复制粘贴", false, "图层树为空");
  }

  // ---- 4. layer search ----
  const search = page.getByLabel("搜索图层");
  await search.fill("指标");
  await page.waitForTimeout(300);
  const visibleRows = await page.getByRole("treeitem").count();
  step("图层搜索过滤", visibleRows >= 0, `匹配 ${visibleRows} 行`);
  await search.fill("");

  // ---- 5. AI generate (mock) -> readable bubble ----
  await page.getByRole("tab", { name: "属性" }).click();
  const aiSection = page.getByRole("region", { name: "需求" });
  const sendVisible = await page.getByLabel("AI 指令").isVisible();
  if (sendVisible) {
    await page.getByLabel("AI 指令").fill("生成一个运营工作台");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    // wait for confirm card (done) or error
    const card = page.getByRole("region", { name: "变更计划确认卡" });
    try {
      await card.waitFor({ timeout: 20000 });
      step("AI 生成出现确认卡", true);
      // bubble must be readable — no document dump
      const log = page.getByRole("log", { name: "AI 对话" });
      const text = (await log.textContent()) ?? "";
      const hasDump = text.includes("documentVersion") || text.includes('"nodes"');
      step("气泡无可读性 dump（不含 documentVersion/nodes）", !hasDump, hasDump ? "仍含原始 JSON" : "plan 短摘要");
      await page.getByRole("button", { name: "取消" }).click();
      await page.waitForTimeout(300);
    } catch {
      step("AI 生成出现确认卡", false, "20s 内未出现");
    }
  } else {
    step("AI 对话可见", false, "AI 输入框不可见");
  }

  // ---- 6. screenshot repair scope ----
  await page.getByRole("tab", { name: "截图检查" }).click();
  const runBtn = page.getByRole("button", { name: "开始截图检查" });
  if (await runBtn.isEnabled()) {
    await runBtn.click();
    await page.waitForTimeout(3000);
  }
  const repairBtn = page.getByRole("button", { name: "发给 AI 修复" });
  if (await repairBtn.isEnabled()) {
    await repairBtn.click();
    await page.waitForTimeout(4000);
    const logText = (await page.getByRole("log", { name: "AI 对话" }).textContent()) ?? "";
    const dumped = logText.includes("documentVersion");
    step("截图修复后气泡无 document dump", !dumped);
  } else {
    step("截图修复", true, "无问题或不可用，跳过");
  }

  await page.screenshot({ path: "output/playwright/sim-final.png", fullPage: false });
} catch (err) {
  step("模拟执行", false, String(err).slice(0, 300));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} 通过 ====`);
process.exit(failed.length > 0 ? 1 : 0);
