import { promises as fs } from "node:fs";
import { join } from "node:path";

const TEMPLATE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class TemplatePathError extends Error {}

/** Template ids form file names, so only simple kebab-case ids may reach storage. */
export function assertSafeTemplateId(id: string): string {
  if (!TEMPLATE_ID_RE.test(id)) {
    throw new TemplatePathError(`非法模板 ID: "${id}"`);
  }
  return id;
}

/** Template registry dirs live under the app data dir (gitignored). */
export const SOURCE_DIR = (dataDir: string) => join(dataDir, "templates", "source");
export const REGISTRY_DIR = (dataDir: string) => join(dataDir, "templates", "registry");

/** One converted template: the PageDocument plus gallery metadata. */
export interface TemplateRecord {
  id: string;
  name: string;
  /** Gallery grouping ("数据看板" | "认证" | "管理后台" | ...). */
  category: string;
  description: string;
  /** Source attribution (upstream project + license). */
  source: string;
  /** The Schema page document — validated by convertBlock before persisting. */
  document: unknown;
  /** When the template was converted (epoch ms). */
  importedAt: number;
}

/**
 * Read one downloaded block registry JSON (shadcn format): returns the
 * concatenated source (page.tsx first, then components/data) plus the block id.
 * Sources may live in the root source dir OR its charts/ subdir (chart bundles
 * are single-file; their paths differ only in location).
 */
export async function readBlockSource(dataDir: string, id: string): Promise<{ id: string; bundle: string }> {
  const safeId = assertSafeTemplateId(id);
  const candidates = [
    join(SOURCE_DIR(dataDir), `${safeId}.json`),
    join(SOURCE_DIR(dataDir), "charts", `${safeId}.json`),
  ];
  let raw = "";
  for (const path of candidates) {
    try {
      raw = await fs.readFile(path, "utf8");
      break;
    } catch {
      // try next candidate
    }
  }
  if (!raw) throw new Error(`source ${id} not found`);
  const parsed = JSON.parse(raw) as { name?: string; files?: { path: string; content: string }[] };
  const files = parsed.files ?? [];
  const page = files.find((f) => f.path.endsWith("page.tsx"));
  const rest = files.filter((f) => f.path !== page?.path);
  const bundle = [page?.content, ...rest.map((f) => `// === ${f.path} ===\n${f.content}`)]
    .filter((s) => typeof s === "string" && s.length > 0)
    .join("\n\n");
  return { id: parsed.name ?? id, bundle };
}

/** All downloaded source ids (root + charts subdir; sorted, deterministic). */
export async function listSourceIds(dataDir: string): Promise<string[]> {
  await fs.mkdir(SOURCE_DIR(dataDir), { recursive: true });
  const names = await fs.readdir(SOURCE_DIR(dataDir));
  const root = names.filter((n) => n.endsWith(".json")).map((n) => n.replace(/\.json$/, ""));
  const chartDir = join(SOURCE_DIR(dataDir), "charts");
  let charts: string[] = [];
  try {
    charts = (await fs.readdir(chartDir)).filter((n) => n.endsWith(".json")).map((n) => n.replace(/\.json$/, ""));
  } catch {
    // charts dir absent → no chart sources
  }
  return [...root, ...charts].sort();
}

/** Persist one converted template into the registry. */
export async function writeTemplateRecord(dataDir: string, record: TemplateRecord): Promise<void> {
  const safeId = assertSafeTemplateId(record.id);
  await fs.mkdir(REGISTRY_DIR(dataDir), { recursive: true });
  await fs.writeFile(join(REGISTRY_DIR(dataDir), `${safeId}.json`), JSON.stringify(record, null, 2), "utf8");
}

/** All converted templates, oldest first. Corrupt records are skipped, never thrown. */
export async function listTemplateRecords(dataDir: string): Promise<TemplateRecord[]> {
  await fs.mkdir(REGISTRY_DIR(dataDir), { recursive: true });
  const names = (await fs.readdir(REGISTRY_DIR(dataDir)))
    .filter((n) => n.endsWith(".json"))
    .sort();
  const out: TemplateRecord[] = [];
  for (const name of names) {
    try {
      const rec = JSON.parse(await fs.readFile(join(REGISTRY_DIR(dataDir), name), "utf8")) as TemplateRecord;
      if (rec && typeof rec.id === "string" && rec.document !== undefined) out.push(rec);
    } catch {
      // skip corrupt record
    }
  }
  return out.sort((a, b) => a.importedAt - b.importedAt);
}

export async function readTemplateRecord(dataDir: string, id: string): Promise<TemplateRecord | null> {
  try {
    return JSON.parse(await fs.readFile(join(REGISTRY_DIR(dataDir), `${id}.json`), "utf8")) as TemplateRecord;
  } catch {
    return null;
  }
}