import { describe, expect, it } from "vitest";
import { ToolKitRegistry, parseDocumentEnvelope, createDocumentEnvelope, type ToolKit } from "@studio/studio-core";
import { PPT_TOOLKIT } from "@studio/ppt-toolkit";
import { WORD_TOOLKIT } from "@studio/word-toolkit";
import { UI_TOOLKIT } from "@studio/schema-core";

/**
 * P11 cross-toolkit contract gate: the invariants every builtin toolkit must
 * satisfy so the shared shell (registry, project store, AI pipeline, save
 * path) can treat them uniformly. A toolkit breaking any of these breaks the
 * platform, not just its own project type.
 */

const ALL: ToolKit[] = [UI_TOOLKIT, PPT_TOOLKIT, WORD_TOOLKIT];

describe("toolkit platform contract (P11)", () => {
  it("三个内置工具包在共享注册表中共存，projectType 互不冲突", () => {
    const registry = new ToolKitRegistry(ALL);
    expect(registry.getForProjectType("ui").id).toBe(UI_TOOLKIT.id);
    expect(registry.getForProjectType("ppt").id).toBe(PPT_TOOLKIT.id);
    expect(registry.getForProjectType("word").id).toBe(WORD_TOOLKIT.id);
  });

  it.each(ALL)("aiTools 的 commandIds 必须全部存在（$id）", (toolkit: ToolKit) => {
    const commandIds = new Set(toolkit.commands.map((c) => c.id));
    for (const ai of toolkit.aiTools) {
      expect(ai.commandIds.length).toBeGreaterThan(0);
      for (const id of ai.commandIds) {
        expect(commandIds.has(id)).toBe(true);
      }
    }
  });

  it.each(ALL)("createEmpty → parse 往返稳定（$id）", (toolkit: ToolKit) => {
    const envelope = toolkit.document.createEmpty("契约文档");
    const reparsed = toolkit.document.parse(envelope);
    expect(reparsed).toEqual(envelope);
  });

  it.each(ALL)("envelope 头部与工具包身份一致（$id）", (toolkit: ToolKit) => {
    const envelope = toolkit.document.createEmpty("身份检查");
    const parsed = parseDocumentEnvelope(envelope);
    expect(parsed.projectType).toBe(toolkit.projectType);
    expect(parsed.toolkitId).toBe(toolkit.id);
    expect(parsed.toolkitVersion).toBe(toolkit.version);
    expect(parsed.format).toBe("studio-document");
    expect(parsed.coreVersion).toBe(1);
  });

  it("工具包 adapter 拒绝身份不符的信封（ppt 信封喂给 word adapter）", () => {
    const pptEnvelope = PPT_TOOLKIT.document.createEmpty("身份不符");
    expect(() => WORD_TOOLKIT.document.parse(pptEnvelope)).toThrow();
  });
});
