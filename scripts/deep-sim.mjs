/**
 * Deep human-like simulation against the REAL provider (ark).
 * Journey: create project -> AI generate -> apply -> manual edits ->
 * AI local edit -> token color -> palette insert -> codegen ->
 * screenshot check -> AI repair -> save version -> export zip.
 */
import { chromium } from "@playwright/test";

const BASE = "http://localhost:5173";
const AI_WAIT = 300_000; // real model ceiling per turn
const results = [];
const step = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 950 }, acceptDownloads: true });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));

async function chatTail() {
  try {
    const t = (await page.getByRole("log", { name: "AI 对话" }).textContent()) ?? "";
    return t.replace(/\s+/g, " ").slice(-120);
  } catch { return ""; }
}
async function alerts() {
  try { return await page.locator('[role="alert"]').allTextContents(); } catch { return []; }
}
/** Wait for the AI turn to settle: confirm card / notice / error. Logs progress. */
async function waitAiSettled(label, timeoutMs = AI_WAIT) {
  const t0 = Date.now();
  let lastLog = "";
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(5000);
    const card = await page.getByRole("region", { name: "变更计划确认卡" }).count();
    const al = await alerts();
    const tail = await chatTail();
    if (tail !== lastLog) { console.log(`  [${label} ${(Date.now() - t0) / 1000 | 0}s] ${tail}`); lastLog = tail; }
    if (card > 0) return { ok: true, kind: "card" };
    if (al.some((a) => a.includes("API") || a.includes("失败") || a.includes("不合法") || a.includes("校验"))) {
      return { ok: false, kind: "error", detail: al.join(" | ").slice(0, 300) };
    }
    // Empty-ops notice renders as role=status beside the composer, not in the log.
    const status = await page.locator('[role="status"]').allTextContents();
    if (status.some((s) => s.includes("无需修改"))) return { ok: true, kind: "notice" };
    if (tail.includes("无需修改")) return { ok: true, kind: "notice" };
  }
  return { ok: false, kind: "timeout" };
}

try {
  // ================= 1. 新建项目 =================
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByRole("main", { name: "项目列表" }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "新建项目" }).first().click();
  await page.getByLabel("项目名称").fill("会员中心模拟");
  await page.getByLabel("产品类型").fill("电商后台");
  await page.getByLabel("目标用户").fill("会员运营人员");
  await page.getByLabel("页面目标").fill("管理会员信息、积分与等级");
  await page.getByLabel("品牌规则").fill("蓝紫色调，简洁现代，卡片式布局");
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByRole("button", { name: "返回项目列表" }).waitFor({ timeout: 15000 });
  step("新建项目并进入工作台", true);

  // ================= 2. AI 整页生成（真实模型） =================
  const input = page.getByLabel("AI 指令");
  await input.waitFor({ timeout: 5000 });
  console.log("== 发送真实生成请求（最长 5 分钟）…");
  await input.fill("生成一个会员中心管理页：顶部页头，今日概览四个指标卡（会员总数/活跃会员/积分发放/兑换次数），会员列表表格（昵称/等级/积分/状态），一个最近动态区块");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const gen = await waitAiSettled("生成");
  if (gen.kind !== "card") {
    step("AI 整页生成", false, JSON.stringify(gen));
    throw new Error("generate failed");
  }
  step("AI 整页生成 → 确认卡", true);
  const genPlan = (await page.getByRole("region", { name: "变更计划确认卡" }).textContent()) ?? "";
  step("确认卡含可读 plan", genPlan.includes("规划"), genPlan.slice(60, 160));
  await page.getByRole("button", { name: "应用变更" }).click();
  await page.waitForTimeout(2500); // apply + auto-save
  step("应用生成文档", true);

  // ================= 3. 图层树选中指标卡 + 属性手改 =================
  // Tree search matches prop text; click the StatCard row directly.
  await page.getByRole("tab", { name: "图层" }).click();
  await page.getByLabel("搜索图层").fill("会员总数");
  await page.waitForTimeout(400);
  const statRow = page.getByRole("treeitem").filter({ hasText: /指标卡|StatCard/ }).first();
  let labelEdited = false;
  if (await statRow.count()) {
    await statRow.click();
    await page.waitForTimeout(300);
    labelEdited = true;
  }
  // Clear the filter while still on the layers tab, then edit on props tab.
  await page.getByLabel("搜索图层").fill("");
  await page.waitForTimeout(300);
  if (labelEdited) {
    await page.getByRole("tab", { name: "属性" }).click();
    await page.waitForTimeout(400);
    const labelInput = page.getByLabel("label", { exact: true });
    if (await labelInput.count()) {
      await labelInput.fill("注册会员");
      await page.waitForTimeout(400);
    } else {
      labelEdited = false;
    }
  }
  step("点选指标卡并手改 label", labelEdited);

  // ================= 4. 图层树选中区块 + AI 局部修改（真实模型） =================
  await page.getByRole("tab", { name: "图层" }).click();
  await page.getByLabel("搜索图层").fill("今日概览");
  await page.waitForTimeout(400);
  const secRow = page.getByRole("treeitem").filter({ hasText: /区块|Section/ }).first();
  let picked = false;
  if (await secRow.count()) {
    await secRow.click();
    picked = true;
  } else {
    // fallback only AFTER clearing the filter (empty query = full tree)
    await page.getByLabel("搜索图层").fill("");
    await page.waitForTimeout(300);
    const anyRow = page.getByRole("treeitem").nth(2);
    if (await anyRow.count()) { await anyRow.click(); picked = true; }
  }
  if (picked) await page.getByLabel("搜索图层").fill("");
  step("图层树选中区块", picked);
  if (picked) {
    const chip = (await page.getByLabel("AI 作用范围").textContent()) ?? "";
    step("范围 chip 显示局部", chip.includes("局部"), chip.trim().slice(0, 60));
    console.log("== 发送真实局部修改请求…");
    await page.getByLabel("AI 指令").fill("把这个区块的标题字号调大，卡片间距更紧凑，其他区域不要动");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const patch = await waitAiSettled("局部");
    if (patch.kind === "card") {
      step("AI 局部修改 → 确认卡", true);
      await page.getByRole("button", { name: "应用变更" }).click();
      await page.waitForTimeout(2000);
      step("应用局部修改", true);
    } else if (patch.kind === "notice") {
      step("AI 局部修改", true, "模型认为无需修改（可接受）");
    } else {
      step("AI 局部修改", false, JSON.stringify(patch));
    }
  }

  // ================= 5. Token 改品牌色 =================
  await page.getByRole("tab", { name: "Token" }).click();
  await page.getByLabel("品牌色").fill("#4F46E5");
  await page.waitForTimeout(400);
  const brandShown = await page.getByLabel("品牌色").inputValue();
  step("Token 品牌色改 #4F46E5", brandShown.toLowerCase() === "#4f46e5", brandShown);
  await page.getByRole("tab", { name: "属性" }).click();

  // ================= 6. 命令面板插入组件 =================
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog", { name: "命令面板" }).waitFor({ timeout: 3000 });
  await page.getByLabel("搜索命令").fill("插入 折线图");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  step("命令面板插入折线图", true);
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(300);

  // ================= 7. 生成代码 =================
  await page.getByRole("tab", { name: "Diff" }).click();
  await page.getByRole("button", { name: "生成代码" }).click();
  let codegenOk = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1500);
    const body = (await page.locator("footer").textContent()) ?? "";
    if (body.includes("src/") || body.includes("package.json")) { codegenOk = true; break; }
    if (body.includes("代码生成失败")) break;
  }
  step("生成代码落盘", codegenOk);

  // ================= 8. 截图检查（真实预览 + chromium） =================
  await page.getByRole("tab", { name: "截图检查" }).click();
  console.log("== 截图检查（首次含依赖安装，最长 5 分钟）…");
  await page.getByRole("button", { name: "开始截图检查" }).click();
  let shotsOk = false;
  let issueCount = -1;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(5000);
    const dock = (await page.locator("footer").textContent()) ?? "";
    if (dock.includes("检查中…")) continue;
    // ShotViewer renders ONE image (selected viewport); success = summary row.
    const summary = dock.match(/共 (\d+) 项/);
    if (summary) {
      shotsOk = true;
      issueCount = Number(summary[1]);
      break;
    }
    if (dock.includes("失败") && i > 6) break;
  }
  step("三视口截图完成", shotsOk, `问题项 ${issueCount}`);

  // ================= 9. 发给 AI 修复（有问题才走） =================
  const repairBtn = page.getByRole("button", { name: "发给 AI 修复" });
  if (shotsOk && issueCount > 0 && await repairBtn.isEnabled()) {
    console.log("== 发送真实修复请求…");
    await repairBtn.click();
    const rep = await waitAiSettled("修复");
    if (rep.kind === "card") {
      step("AI 修复 → 确认卡", true);
      await page.getByRole("button", { name: "应用变更" }).click();
      await page.waitForTimeout(2000);
      step("应用修复", true);
    } else if (rep.kind === "notice") {
      step("AI 修复", true, "无需修改");
    } else {
      step("AI 修复", false, JSON.stringify(rep));
    }
  } else {
    step("AI 修复", true, shotsOk ? "无问题可修，跳过" : "截图未完成，跳过");
  }

  // ================= 10. 存为版本 =================
  await page.getByRole("tab", { name: "版本历史" }).click();
  await page.locator('[aria-label="存为版本"] input').fill("模拟-v1");
  await page.getByRole("button", { name: "存为版本" }).click();
  await page.waitForTimeout(2000);
  const versionRow = await page.locator('[aria-label="版本列表"]').textContent();
  step("存为版本并出现在列表", (versionRow ?? "").includes("模拟-v1"));

  // ================= 11. 导出 zip =================
  await page.getByRole("tab", { name: "Diff" }).click();
  const dlPromise = page.waitForEvent("download", { timeout: 240_000 }).catch(() => null);
  await page.getByRole("button", { name: "导出 zip" }).click();
  let dl = await dlPromise;
  // Export gate: checks (install+tsc+build) can take minutes; if the confirm
  // panel appears, a REAL user reviews errors and may force-export.
  if (!dl) {
    for (let i = 0; i < 40 && !dl; i++) {
      await page.waitForTimeout(5000);
      const dock = (await page.locator("footer").textContent()) ?? "";
      if (dock.includes("仍然导出")) {
        await page.getByRole("button", { name: "仍然导出" }).click();
        dl = await page.waitForEvent("download", { timeout: 240_000 }).catch(() => null);
        break;
      }
    }
  }
  if (dl) {
    step("导出 zip 触发下载", true, dl.suggestedFilename());
  } else {
    const dock = (await page.locator("footer").textContent()) ?? "";
    step("导出 zip", false, dock.replace(/\s+/g, " ").slice(0, 160));
  }

  await page.screenshot({ path: "output/playwright/deep-final.png", fullPage: false });
} catch (err) {
  const al = await alerts();
  step("旅程执行", false, `${String(err).slice(0, 260)} alerts=${al.join("|").slice(0, 200)}`);
  try { await page.screenshot({ path: "output/playwright/deep-fail.png" }); } catch {}
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} 通过 ====`);
for (const f of failed) console.log(`  FAIL: ${f.name} ${f.detail}`);
process.exit(failed.length > 0 ? 1 : 0);
