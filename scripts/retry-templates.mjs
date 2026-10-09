#!/usr/bin/env node
/**
 * Re-import specific template ids (post-fix retry for conversions that failed
 * in a previous batch). Usage: node scripts/retry-templates.mjs id1 id2 ...
 */
const BASE = "http://127.0.0.1:8787";
const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("usage: node scripts/retry-templates.mjs <id...>");
  process.exit(2);
}
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
      failed.push(`${id} (${body.error})`);
      console.log(`  FAIL ${id} — ${body.error}`);
    }
  } catch (err) {
    failed.push(`${id} (${err instanceof Error ? err.message : String(err)})`);
    console.log(`  ERR  ${id} — ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\nre-imported ${ok}/${ids.length}`);
if (failed.length) console.log(`failed:\n  ${failed.join("\n  ")}`);
process.exit(failed.length ? 1 : 0);
