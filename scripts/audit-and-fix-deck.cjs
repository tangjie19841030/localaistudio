#!/usr/bin/env node
/**
 * One-off doctor for the imported 卡通PPT deck (mirrors layering.ts).
 *
 * Old importers dropped <a:alpha> and emitted pastel background panels /
 * decorative edge stripes AFTER the content they belong behind. We stably
 * partition each slide: pale page-aligned shapes that cover lower-layer
 * images/text move to a background group (order preserved), everything
 * else keeps its exact relative order. Idempotent.
 *
 * Also reports missing asset files, out-of-bounds geometry, empty text,
 * and duplicate ids (read-only checks).
 *
 * Usage: node scripts/audit-and-fix-deck.cjs [projectId] [--write]
 */
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const PROJECT_ID = args.find((arg) => !arg.startsWith("-")) || process.env.STUDIO_PROJECT_ID;
if (!PROJECT_ID) throw new Error("projectId is required (pass it as the first argument or STUDIO_PROJECT_ID)");
const WRITE = args.includes("--write");

const root = path.resolve(__dirname, "..");
const projDir = path.join(root, "data", "projects", PROJECT_ID);
const docPath = path.join(projDir, "document", "document.json");
const assetsDir = path.join(projDir, "assets");

const raw = JSON.parse(fs.readFileSync(docPath, "utf8"));
const doc = raw.document;
const assetFiles = fs.existsSync(assetsDir) ? new Set(fs.readdirSync(assetsDir)) : new Set();

const EDGE_TOLERANCE = 0.01;
const PALE_LUMINANCE = 0.78;
const LARGE_AREA = 0.45;
const STRIPE_SPAN = 0.75;
const STRIPE_THIN = 0.08;
const TILE_AREA = 0.005;
const BAND_AREA = 0.1;
const BAND_SPAN = 0.9;
const W = 1280;
const H = 720;

function luminance(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

const overlaps = (a, b) =>
  a.rect.x < b.rect.x + b.rect.w &&
  a.rect.x + a.rect.w > b.rect.x &&
  a.rect.y < b.rect.y + b.rect.h &&
  a.rect.y + a.rect.h > b.rect.y;

function isBackgroundShape(obj) {
  if (obj.kind !== "shape" || !obj.fill) return false;
  if (luminance(obj.fill) < PALE_LUMINANCE) return false;
  const { x, y, w, h } = obj.rect;
  const area = (w * h) / (W * H);
  const onSideEdge = x <= 8 || x + w >= W - 8;
  const flushSideEdge = x <= EDGE_TOLERANCE || Math.abs(x + w - W) <= EDGE_TOLERANCE;
  const onTopBottom = y <= 8 || y + h >= H - 8;
  if (area >= LARGE_AREA && onSideEdge && onTopBottom) return true;
  if (w / W <= STRIPE_THIN && h / H >= STRIPE_SPAN && flushSideEdge) return true;
  if (h / H <= STRIPE_THIN && w / W >= STRIPE_SPAN && onTopBottom) return true;
  if (area >= BAND_AREA && w / W >= BAND_SPAN && onTopBottom) return true;
  if (area >= TILE_AREA && area < BAND_AREA && (onSideEdge || onTopBottom)) return true;
  return false;
}

const report = [];
let moved = 0;

for (const slide of doc.slides) {
  const objects = slide.objects;
  const seen = new Set();
  for (const obj of objects) {
    if (seen.has(obj.id)) report.push(`slide ${slide.id}: duplicate id ${obj.id}`);
    seen.add(obj.id);
    if (obj.kind === "image") {
      const file = String(obj.src).split("/assets/")[1];
      if (file && !assetFiles.has(file)) report.push(`slide ${slide.id}: missing image ${file}`);
      if (obj.rect.x < -1 || obj.rect.y < -1 || obj.rect.x + obj.rect.w > W + 1 || obj.rect.y + obj.rect.h > H + 1) {
        report.push(`slide ${slide.id}: out-of-bounds image ${obj.id}`);
      }
    }
    if (obj.kind === "text" && obj.paragraphs.every((p) => p.runs.every((r) => !r.text))) {
      report.push(`slide ${slide.id}: empty text ${obj.id}`);
    }
  }

  const moveSet = new Set();
  objects.forEach((obj, idx) => {
    if (!isBackgroundShape(obj)) return;
    const covers = objects.some(
      (o, oIdx) => oIdx < idx && (o.kind === "image" || o.kind === "text") && overlaps(obj, o),
    );
    if (covers) moveSet.add(obj.id);
  });

  if (moveSet.size > 0) {
    const background = objects.filter((o) => moveSet.has(o.id));
    const foreground = objects.filter((o) => !moveSet.has(o.id));
    slide.objects = [...background, ...foreground];
    moved += background.length;
    report.push(`slide ${slide.id}: sank ${background.length} bg shape(s): ${background.map((o) => o.id).join(", ")}`);
  }
}

console.log(`Audited ${doc.slides.length} slides.`);
if (moved > 0) console.log(`Background shapes moved: ${moved}`);
if (report.length) {
  console.log("\nFindings:");
  for (const line of report) console.log(" -", line);
} else {
  console.log("No problems found.");
}

if (WRITE && moved > 0) {
  fs.writeFileSync(docPath, JSON.stringify(raw, null, 2) + "\n");
  console.log(`\nWrote ${docPath}`);
} else if (!WRITE && moved > 0) {
  console.log("\nDry run — re-run with --write to apply.");
}
