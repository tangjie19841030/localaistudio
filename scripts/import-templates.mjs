#!/usr/bin/env node
/**
 * Batch-import all downloaded source templates into the registry via the
 * server's conversion endpoint. The server must be running (it owns the AI
 * provider + validation). Deterministic seeds cover the offline/mock cases;
 * the configured provider converts the rest with one retry each.
 *
 * Usage: node scripts/import-templates.mjs [--all]
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const BASE = "http://127.0.0.1:8787";
const sourceDir = join(process.cwd(), "data", "templates", "source");
const chartsDir = join(sourceDir, "charts");

const rootIds = (await readdir(sourceDir)).filter((n) => n.endsWith(".json")).map((n) => n.replace(/\.json$/, ""));
let chartIds = [];
try {
  chartIds = (await readdir(chartsDir)).filter((n) => n.endsWith(".json")).map((n) => n.replace(/\.json$/, ""));
} catch {
  // no charts dir
}
const ids = [...rootIds, ...chartIds].sort();
console.log(`found ${ids.length} source templates (${rootIds.length} blocks + ${chartIds.length} charts)`);

let ok = 0;
const failed = [];
for (const id of ids) {
  try {
    const res = await fetch(`${BASE}/api/templates/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const body = await res.json();
    if (res.ok) {
      ok += 1;
      console.log(`  ok  [${body.template.category}] ${id} → ${body.template.name}`);
    } else {
      failed.push(`${id} (${body.error}: ${body.message ?? ""})`);
      console.log(`  FAIL ${id} — ${body.error}: ${body.message ?? ""}`);
    }
  } catch (err) {
    failed.push(`${id} (${err instanceof Error ? err.message : String(err)})`);
    console.log(`  ERR  ${id} — ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\nimported ${ok}/${ids.length}`);
if (failed.length) console.log(`failed:\n  ${failed.join("\n  ")}`);
process.exit(failed.length ? 1 : 0);