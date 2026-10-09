/** Browser reproduction for "PPT 跑完一片空白". Drives the real running workbench. */
import { chromium } from "@playwright/test";

const BASE = "http://localhost:5173";
const SHOT = (name) => `gui-test-screenshots/browser-repro-${name}.png`;
const logs = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

page.on("console", (msg) => {
  const text = `[console.${msg.type()}] ${msg.text()}`;
  logs.push(text);
  if (msg.type() === "error" || msg.type() === "warning") console.log(text.slice(0, 400));
});
page.on("pageerror", (err) => logs.push(`[pageerror] ${err.stack || err.message}`));
page.on("requestfailed", (req) => {
  if (req.url().includes("/api/")) logs.push(`[requestfailed] ${req.url()} :: ${req.failure()?.errorText}`);
});

// 1. fresh PPT project
await page.goto(BASE);
await page.getByRole("button", { name: "新建项目" }).click();
const name = `浏览器复现PPT-${Date.now()}`;
await page.getByLabel("项目名称").fill(name);
await page.getByRole("radio", { name: "PPT 演示" }).check();
await page.getByRole("button", { name: "创建项目" }).click();
await page.getByLabel("PPT 编辑器").waitFor();
console.log("project opened:", name);

const slideCount = () => page.locator('ol[aria-label="幻灯片列表"] > *').count();
console.log("initial slides:", await slideCount());
await page.screenshot({ path: SHOT("01-initial"), fullPage: false });

// 2. send an AI instruction (file scope is the default)
await page.getByLabel("AI 指令").fill("做一页关于季度营收的汇报封面，标题用「2026 Q3 营收汇报」，备注写「封面页」，完成后把默认空白页删掉");
await page.getByRole("button", { name: "发送" }).click();
console.log("sent, streaming…");

// 3. wait until the composer leaves streaming state (or timeout)
const deadline = Date.now() + 360_000;
let lastCount = -1;
let sawCancel = false;
let lastLiveSignature = "";
let liveShotTaken = false;
let sawLiveCard = false;
const startedAt = Date.now();
while (Date.now() < deadline) {
  await page.waitForTimeout(2000);
  const count = await slideCount();
  if (count !== lastCount) {
    console.log(`  t+${Math.round((Date.now() - startedAt) / 1000)}s slides=${count}`);
    lastCount = count;
  }
  // Timeline sampling: log the live activity card as its step list grows.
  const liveCard = page.getByRole("group", { name: "AI 执行过程（进行中）" });
  if (await liveCard.count()) {
    sawLiveCard = true;
    const liveText = (await liveCard.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const signature = liveText.slice(0, 300);
    if (signature && signature !== lastLiveSignature) {
      console.log(`  t+${Math.round((Date.now() - startedAt) / 1000)}s live card: ${signature}`);
      lastLiveSignature = signature;
      if (!liveShotTaken) {
        await page.screenshot({ path: SHOT("timeline-live"), fullPage: false });
        liveShotTaken = true;
      }
    }
  }
  const cancelVisible = await page.getByRole("button", { name: "取消" }).isVisible().catch(() => false);
  if (cancelVisible) sawCancel = true;
  const errorBanner = await page.locator('[aria-label="编辑错误"]').count();
  if (errorBanner) { console.log("error banner appeared"); break; }
  // 取消 button is rendered only while streaming; finish once it was seen and is gone.
  if (sawCancel && !cancelVisible && Date.now() - startedAt > 8000) {
    await page.waitForTimeout(2000);
    const stillBusy = await page.getByRole("button", { name: "取消" }).isVisible().catch(() => false);
    if (!stillBusy) break;
  }
}

await page.waitForTimeout(1000);
console.log("FINAL slides:", await slideCount());

// 3b. archived timeline card: collapsed one-liner, then expandable history
const archived = page.getByRole("group", { name: "AI 执行过程" });
await archived.first().waitFor({ timeout: 30_000 });
const collapsed = (await archived.first().innerText()).replace(/\s+/g, " ").trim();
console.log("=== timeline saw live card:", sawLiveCard);
console.log("=== archived card collapsed:", collapsed.slice(0, 300));
if (!/已完成|已全部应用|已取消|执行中断|变更计划已生成|文档已生成|无需修改/.test(collapsed)) {
  throw new Error(`archived timeline title unexpected: ${collapsed.slice(0, 120)}`);
}
await page.screenshot({ path: SHOT("timeline-collapsed"), fullPage: false });
const expandBtn = archived.first().getByRole("button", { name: /展开 ⌄/ });
if (await expandBtn.count()) {
  await expandBtn.click();
  await page.waitForTimeout(400);
  const expanded = (await archived.first().innerText()).replace(/\s+/g, " ").trim();
  console.log("=== archived card expanded:", expanded.slice(0, 800));
  await page.screenshot({ path: SHOT("timeline-expanded"), fullPage: false });
}

// 4. capture all visible state: slide titles, canvas text, errors, notices
const state = await page.evaluate(() => {
  const q = (sel) => Array.from(document.querySelectorAll(sel)).map((el) => el.textContent?.trim()).filter(Boolean);
  return {
    slideButtons: q('ol[aria-label="幻灯片列表"] button'),
    errors: q('[aria-label="编辑错误"]'),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((e) => e.textContent?.trim()),
    chatText: q('[aria-label="AI 对话"]'),
    canvasTitle: document.querySelector('h1,h2')?.textContent ?? null,
    bodyText: document.body.innerText.slice(0, 2000),
  };
});
console.log("=== slide buttons:", JSON.stringify(state.slideButtons));
console.log("=== errors:", JSON.stringify(state.errors));
console.log("=== alerts:", JSON.stringify(state.alerts));
console.log("=== canvas has 2026 Q3:", state.bodyText.includes("2026 Q3"));
await page.screenshot({ path: SHOT("02-after-ai"), fullPage: false });

// 5. 运行日志 tab (BottomDock) — click if present
const logTab = page.getByRole("button", { name: /运行日志/ });
if (await logTab.count()) {
  await logTab.first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOT("03-run-log"), fullPage: false });
}

// 6. wait for auto-save, then verify the PERSISTED document via API
const projectId = await page.locator('[aria-label="PPT 编辑器"]').getAttribute("data-project-id");
await page.waitForTimeout(4000); // settleToolkit auto-save
const dirty = await page.getByText("未保存更改").isVisible().catch(() => false);
console.log("dirty after settle:", dirty, "projectId:", projectId);
try {
  const docRes = await fetch(`http://127.0.0.1:8787/api/projects/${projectId}`);
  if (docRes.ok) {
    const payload = await docRes.json();
    const deck = payload?.document?.document ?? payload?.document;
    console.log("PERSISTED slides:", (deck?.slides ?? []).map((s) => s.title).join(" | "));
  } else {
    console.log("document fetch status:", docRes.status);
  }
} catch (err) {
  console.log("document fetch failed:", err.message);
}

console.log("\n=== browser logs (" + logs.length + ") ===");
for (const line of logs) console.log(line.slice(0, 500));

await browser.close();
console.log("DONE");
