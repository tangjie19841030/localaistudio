import { listComponentDefs } from "@studio/schema-core";
import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Codegen guardrail (deep-sim finding): every registry component MUST have a
 * ui-kit source file — otherwise generateFiles emits references without a
 * module and the export project crashes at runtime ("X is not defined").
 *
 * NON_KIT_TYPES: the documented exceptions. SvgBox renders via a native <div>
 * in both the renderer and the codegen path (W5 §2.4/§2.5) — it has no kit
 * component by design, and generateFiles filters it out of the kit copy scan.
 * Exempting it here keeps this scan about real kit-backed components instead of
 * reporting a by-design absence as a missing module.
 */
const kitDir = resolve(fileURLToPath(import.meta.url), "../../../..", "packages/ui-kit/src/components");

const NON_KIT_TYPES = new Set<string>(["SvgBox"]);

describe("注册表 ↔ ui-kit 一致性（代码生成护栏）", () => {
  it("每个注册组件都有对应的 ui-kit 源文件（NON_KIT_TYPES 例外除外）", async () => {
    const files = new Set(await fs.readdir(kitDir));
    const registered = new Set(listComponentDefs().map((d) => d.type));
    // The exemption set must not rot: a stale entry would silently exempt a
    // future component that DOES need a kit source.
    for (const type of NON_KIT_TYPES) {
      expect(registered.has(type), `NON_KIT_TYPES 含未注册类型: ${type}`).toBe(true);
    }
    const missing = listComponentDefs()
      .map((d) => d.type)
      .filter((type) => !NON_KIT_TYPES.has(type))
      .filter((type) => !files.has(`${type}.tsx`));
    expect(missing, `缺少 ui-kit 源码: ${missing.join(", ")}`).toEqual([]);
  });
});
