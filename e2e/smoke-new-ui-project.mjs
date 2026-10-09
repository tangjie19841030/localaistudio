import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:5173/");
await page.waitForTimeout(2500);
await page.screenshot({ path: "e2e/smoke-01-project-list.png", fullPage: true });
console.log("title:", await page.title());
const btns = await page.$$("button");
console.log("buttons found:", btns.length);
for (const b of btns.slice(0, 10)) {
  console.log("  btn:", await b.textContent());
}
await browser.close();
