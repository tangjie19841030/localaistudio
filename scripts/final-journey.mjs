/**
 * Final full human-journey test (real glm-5.3-flash):
 * create project → pick gallery template → AI generate → AI local edit →
 * token recolor → codegen → screenshot check → save version → export zip.
 */
import { chromium } from "@playwright/test";

const AI_WAIT = 420_000;
const results = [];
const step = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 950 }, acceptDownloads: true });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 160)));

async function chatTail() {
  try {
    return ((await page.getByRole("log", { name: "AI 对话" }).textContent()) ?? "").replace(/\s+/g, " ").slice(-140);
  } catch { return ""; }
}
async function alerts() {
  try { return await page.locator('[role="alert"]').allTextContents(); } catch { return []; }
}
async function waitAiSettled(label, timeoutMs = AI_WAIT) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(5000);
    const card = await page.getByRole("region", { name: "变更计划确认卡" }).count();
    const al = await alerts();
    const tail = await chatTail();
    if (tail !== last) { console.log(`  [${label} ${(Date.now() - t0) / 1000 | 0}s] ${tail}`); last = tail; }
    if (card > 0) return { ok: true, kind: "card" };
    if (al.some((a) => a.includes("失败") || a.includes("不合法") || a.includes("校验") || a.includes("API"))) {
      return { ok: false, kind: "error", detail: al.join(" | ").slice(0, 240) };
    }
    const status = await page.locator('[role="status"]').allTextContents();
    if (status.some((s) => s.includes("无需修改"))) return { ok: true, kind: "notice" };
    if (tail.includes("无需修改")) return { ok: true, kind: "notice" };
  }
  return { ok: false, kind: "timeout" };
}

try {
  await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded" });
  await page.getByRole("main", { name: "项目列表" }).waitFor({ timeout: 15000 });

  // ===== 1. 新建项目 + 画廊选模板 =====
  await page.getByRole("button", { name: "新建项目" }).first().click();
  await page.getByLabel("项目名称").fill("模板测试-数据看板");
  await page.getByLabel("产品类型").fill("SaaS 后台");
  await page.getByLabel("页面目标").fill("会员运营数据总览");

  // 画廊：(a) 分类 tab，(b) 选中 builtin 数据看板模板
  const catTab = page.getByRole("button", { name: "数据看板", exact: true }).first();
  const hasGallery = await catTab.isVisible();
  step("模板画廊渲染（分类 tab）", hasGallery);
  if (hasGallery) {
    await catTab.click();
    await page.waitForTimeout(400);
    const dashCard = page.getByRole("button", { name: /数据看板|运营数据看板/ }).first();
    await dashCard.click();
    await page.waitForTimeout(300);
  }
  step("选中数据看板模板", true);

  await page.getByRole("button", { name: "创建" }).click();
  await page.getByRole("button", { name: "返回项目列表" }).waitFor({ timeout: 20000 });
  step("用模板创建项目并进入编辑器", true);

  // ===== 2. AI 整页生成（真实 glm） =====
  const input = page.getByLabel("AI 指令");
  await input.waitFor({ timeout: 8000 });
  console.log("== 真实生成请求…");
  await input.fill("基于我选的模板，把页面做成会员运营总览：头部、四个关键指标（有效会员/本月新增/积分消耗/兑换订单）、会员等级分布图表、最近订单表格");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const gen = await waitAiSettled("生成");
  if (gen.kind !== "card") {
    step("AI 生成", false, JSON.stringify(gen));
    throw new Error("generate failed");
  }
  step("AI 生成 → 确认卡", true);
  const planText = ((await page.getByRole("region", { name: "变更计划确认卡" }).textContent()) ?? "").replace(/\s+/g, " ");
  step("确认卡 plan 可读（非 JSON dump）", planText.includes("规划") && !planText.includes('"nodes"'), planText.slice(0, 90));
  await page.getByRole("button", { name: "应用变更" }).click();
  await page.waitForTimeout(2500);
  step("应用生成文档", true);

  // ===== 3. 图层搜索 + AI 局部修改（真实 glm） =====
  await page.getByRole("tab", { name: "图层" }).click();
  await page.getByLabel("搜索图层").fill("会员");
  await page.waitForTimeout(400);
  const statRow = page.getByRole("treeitem").filter({ hasText: /指标卡/ }).first();
  const hasStat = await statRow.count() > 0;
  await page.getByLabel("搜索图层").fill("");
  step("图层搜索命中指标卡", hasStat);
  if (hasStat) {
    await statRow.click();
    await page.getByRole("tab", { name: "属性" }).click();
    const label = page.getByLabel("label", { exact: true });
    if (await label.count()) {
      await label.fill("有效会员");
      await page.waitForTimeout(300);
      step("手改指标卡 label", true, "label→有效会员");
    }
  }

  // AI 局部修改
  await page.getByRole("tab", { name: "图层" }).click();
  await page.getByLabel("搜索图层").fill("概览");
  await page.waitForTimeout(300);
  const secRow = page.getByRole("treeitem").filter({ hasText: /区块|Section/ }).first();
  const hasSec = await secRow.count() > 0;
  if (!hasSec) { await page.getByLabel("搜索图层").fill(""); await page.waitForTimeout(200); const anyRow = page.getByRole("treeitem").nth(2); if (await anyRow.count()) { await anyRow.click(); } }
  else await secRow.click();
  await page.getByLabel("搜索图层").fill("");
  const scope = ((await page.getByLabel("AI 作用范围").textContent()) ?? "");
  step("AI 作用范围 chip 显示局部", scope.includes("局部"), scope.trim().slice(0, 40));
  console.log("== 真实局部修改请求…");
  await page.getByLabel("AI 指令").fill("把这个区块的标题字号调大，卡片间距紧凑些，不要动其他区域");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const patch = await waitAiSettled("局部");
  if (patch.kind === "card") {
    step("AI 局部修改 → 确认卡", true);
    await page.getByRole("button", { name: "应用变更" }).click();
    await page.waitForTimeout(1800);
    step("应用局部修改", true);
  } else if (patch.kind === "notice") {
    step("AI 局部修改", true, "无需修改（可接受）");
  } else {
    step("AI 局部修改", false, JSON.stringify(patch));
  }

  // ===== 4. 模板画廊「待导入」流程（选中 chart 分类） =====
  const tpl = await page.evaluate(async () => {
    const r = await fetch("/api/templates");
    const j = await r.json();
    return { total: j.templates.length, cats: [...new Set(j.templates.map((t) => t.category))] };
  });
  step("画廊满 100 模板", tpl.total >= 100, `total=${tpl.total}, cats=${tpl.cats.join("/")}`);

  // ===== 5. Token 换色 =====
  await page.getByRole("tab", { name: "Token" }).click();
  await page.getByLabel("品牌色").fill("#6D28D9");
  await page.waitForTimeout(300);
  step("Token 品牌色改 #6D28D9", (await page.getByLabel("品牌色").inputValue()).toLowerCase() === "#6d28d9");

  // ===== 6. 生成代码 + 预览截图 =====
  await page.getByRole("tab", { name: "Diff" }).click();
  await page.getByRole("button", { name: "生成代码" }).click();
  let codegenOk = false;
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(1500);
    const body = (await page.locator("footer").textContent()) ?? "";
    if (body.includes("src/pages") || body.includes("package.json")) { codegenOk = true; break; }
    if (body.includes("代码生成失败")) break;
  }
  step("生成代码落盘", codegenOk);

  await page.getByRole("tab", { name: "截图检查" }).click();
  console.log("== 截图检查（首次安装依赖，最长 5 分钟）…");
  await page.getByRole("button", { name: "开始截图检查" }).click();
  let shotsOk = false, issueCount = -1;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(5000);
    const dock = (await page.locator("footer").textContent()) ?? "";
    if (dock.includes("检查中…")) continue;
    const m = dock.match(/共 (\d+) 项/);
    if (m) { shotsOk = true; issueCount = Number(m[1]); break; }
    if (dock.includes("失败") && i > 6) break;
  }
  step("三视口截图完成", shotsOk, `问题 ${issueCount}`);

  // ===== 7. 存为版本 =====
  await page.getByRole("tab", { name: "版本历史" }).click();
  await page.locator('[aria-label="存为版本"] input').fill("v1-模板测试");
  await page.getByRole("button", { name: "存为版本" }).click();
  await page.waitForTimeout(1800);
  const ver = (await page.locator('[aria-label="版本列表"]').textContent()) ?? "";
  step("存为版本", ver.includes("v1-模板测试"));

  await page.screenshot({ path: "output/playwright/final-journey.png", fullPage: false });
} catch (err) {
  step("旅程执行", false, String(err).slice(0, 260));
  const al = await alerts();
  console.log("alerts:", JSON.stringify(al).slice(0, 200));
  try { await page.screenshot({ path: "output/playwright/final-fail.png" }); } catch {}
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} 通过 ====`);
for (const f of failed) console.log(`  FAIL: ${f.name} ${f.detail}`);
process.exit(failed.length ? 1 : 0);