#!/usr/bin/env node
/**
 * Fetch external template sources (shadcn/ui blocks) into data/templates/source/.
 * Each source file is the canonical registry JSON (page.tsx + components + data).
 * Re-run anytime to refresh or add blocks. Idempotent.
 *
 * Usage: node scripts/fetch-templates.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "data", "templates", "source");

const BLOCK_NAMES = [
  "dashboard-01",
  "login-01", "login-02", "login-03", "login-04", "login-05",
  "signup-01", "signup-02", "signup-03", "signup-04", "signup-05",
  "sidebar-01", "sidebar-02", "sidebar-03", "sidebar-04", "sidebar-05",
  "sidebar-06", "sidebar-07", "sidebar-08", "sidebar-09", "sidebar-10",
  "sidebar-11", "sidebar-12", "sidebar-13", "sidebar-14", "sidebar-15",
  "sidebar-16",
];

const REGISTRY_URL = (name) =>
  `https://ui.shadcn.com/r/styles/new-york-v4/${name}.json`;

async function main() {
  await mkdir(sourceDir, { recursive: true });
  let ok = 0;
  const failed = [];
  for (const name of BLOCK_NAMES) {
    try {
      const res = await fetch(REGISTRY_URL(name));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      await writeFile(join(sourceDir, `${name}.json`), body, "utf8");
      ok += 1;
      console.log(`  ok  ${name}`);
    } catch (err) {
      failed.push(`${name} (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  console.log(`\nfetched ${ok}/${BLOCK_NAMES.length} → data/templates/source/`);
  if (failed.length) console.log(`failed: ${failed.join(", ")}`);
  process.exit(failed.length ? 1 : 0);
}

main();