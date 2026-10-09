import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StudioDocument } from "@studio/schema-core";

// apps/server/src/codegen/kit.ts → repo root (kit.ts → codegen → src → server → apps → root)
const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");

export interface KitReadResult {
  /** type name (or "tokens") → raw file source */
  sources: Map<string, string>;
  /** Missing type files skipped, so a partially-known doc still generates */
  warnings: string[];
}

function kitComponentPath(type: string): string {
  return join(repoRoot, "packages", "ui-kit", "src", "components", `${type}.tsx`);
}

/**
 * Read ui-kit component sources + tokens.ts from the repo checkout.
 * Key "tokens" carries packages/ui-kit/src/tokens.ts. Missing files are
 * skipped with a warning instead of failing generation.
 */
export async function readKitSources(types: string[]): Promise<KitReadResult> {
  const sources = new Map<string, string>();
  const warnings: string[] = [];
  for (const type of types) {
    try {
      sources.set(type, await fs.readFile(kitComponentPath(type), "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      warnings.push(`ui-kit 组件源码缺失，已跳过: ${type}`);
    }
  }
  try {
    sources.set("tokens", await fs.readFile(join(repoRoot, "packages", "ui-kit", "src", "tokens.ts"), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    warnings.push("ui-kit tokens.ts 缺失，已跳过");
  }
  return { sources, warnings };
}

/** Distinct component types referenced anywhere in the document. */
export function collectDocTypes(doc: StudioDocument): string[] {
  return [...new Set(doc.pages.flatMap((page) => page.nodes.map((n) => n.type)))];
}
