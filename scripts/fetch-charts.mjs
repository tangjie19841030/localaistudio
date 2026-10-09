#!/usr/bin/env node
/**
 * Fetch shadcn/ui chart examples into data/templates/source/charts/ as raw
 * page bundles (each wraps one recharts variant in a Card — convertible to a
 * "数据可视化页" template by the import pipeline).
 *
 * Usage: node scripts/fetch-charts.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chartsDir = join(root, "data", "templates", "source", "charts");
const RAW = "https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/charts";

const CHART_NAMES = [
  "chart-area-default", "chart-area-gradient", "chart-area-legend", "chart-area-linear",
  "chart-area-stacked", "chart-area-stacked-expand", "chart-area-step", "chart-area-axes",
  "chart-area-icons", "chart-area-interactive",
  "chart-bar-default", "chart-bar-horizontal", "chart-bar-mixed", "chart-bar-multiple",
  "chart-bar-negative", "chart-bar-stacked", "chart-bar-label", "chart-bar-label-custom",
  "chart-bar-active", "chart-bar-interactive",
  "chart-line-default", "chart-line-dots", "chart-line-dots-colors", "chart-line-dots-custom",
  "chart-line-interactive", "chart-line-label", "chart-line-label-custom", "chart-line-linear",
  "chart-line-multiple", "chart-line-step",
  "chart-pie-donut", "chart-pie-donut-active", "chart-pie-donut-text", "chart-pie-interactive",
  "chart-pie-label", "chart-pie-label-custom", "chart-pie-label-list", "chart-pie-legend",
  "chart-pie-separator-none", "chart-pie-simple", "chart-pie-stacked",
  "chart-radar-default", "chart-radar-dots", "chart-radar-grid-circle",
  "chart-radar-grid-circle-fill", "chart-radar-grid-circle-no-lines", "chart-radar-grid-custom",
  "chart-radar-grid-fill", "chart-radar-grid-none", "chart-radar-icons", "chart-radar-label-custom",
  "chart-radar-legend", "chart-radar-lines-only", "chart-radar-multiple", "chart-radar-radius",
  "chart-radial-grid", "chart-radial-label", "chart-radial-shape", "chart-radial-simple",
  "chart-radial-stacked", "chart-radial-text",
  "chart-tooltip-advanced", "chart-tooltip-default", "chart-tooltip-formatter",
  "chart-tooltip-icons", "chart-tooltip-indicator-line", "chart-tooltip-indicator-none",
  "chart-tooltip-label-custom", "chart-tooltip-label-formatter", "chart-tooltip-label-none",
];

async function main() {
  await mkdir(chartsDir, { recursive: true });
  let ok = 0;
  const failed = [];
  for (const name of CHART_NAMES) {
    try {
      const res = await fetch(`${RAW}/${name}.tsx`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      // Registry-style bundle: single file = page.tsx.
      const bundle = {
        name,
        files: [{ path: "chart.tsx", type: "registry:page", content: body }],
      };
      await writeFile(join(chartsDir, `${name}.json`), JSON.stringify(bundle, null, 2), "utf8");
      ok += 1;
    } catch (err) {
      failed.push(`${name} (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  console.log(`charts fetched ${ok}/${CHART_NAMES.length} → data/templates/source/charts/`);
  if (failed.length) console.log(`failed: ${failed.join(", ")}`);
  process.exit(failed.length ? 1 : 0);
}

main();