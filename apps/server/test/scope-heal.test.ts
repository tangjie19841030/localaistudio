import { describe, expect, it } from "vitest";
import type { DocumentEnvelope, SelectionScope } from "@studio/studio-core";
import { createScopeHealer } from "../src/ai/scope-heal.js";

/** Healers only read envelope.document; a document-only cast keeps fixtures tiny. */
function envelopeOf(document: unknown): DocumentEnvelope {
  return { document } as DocumentEnvelope;
}

const pptInitial = envelopeOf({
  slides: [
    { id: "slide-1", objects: [{ id: "slide-1-title-1" }, { id: "slide-1-subtitle-1" }] },
    { id: "slide-2", objects: [{ id: "slide-2-body-1" }] },
  ],
});

describe("createScopeHealer (ppt)", () => {
  it("selection 目标仍存在：scope 原样返回", () => {
    const healer = createScopeHealer("ppt", pptInitial, { kind: "selection", targetIds: ["slide-1-subtitle-1"] });
    const healed = healer.heal(
      envelopeOf({ slides: [{ id: "slide-1", objects: [{ id: "slide-1-subtitle-1" }] }] }),
    );
    expect(healed).toEqual({ kind: "selection", targetIds: ["slide-1-subtitle-1"] });
  });

  it("selection 对象在本轮被删除：自愈为所属幻灯片的 container 范围（live repro）", () => {
    const healer = createScopeHealer("ppt", pptInitial, { kind: "selection", targetIds: ["slide-1-subtitle-1"] });
    // The live failure: scratch no longer contains the selected placeholder.
    const healed = healer.heal(
      envelopeOf({ slides: [{ id: "slide-1", objects: [{ id: "slide-1-title-1" }] }] }),
    );
    expect(healed).toEqual({ kind: "container", targetIds: ["slide-1"] });
  });

  it("自愈为 container 后是单调的：下一轮继续按 container 解析，页被删才失效", () => {
    const healer = createScopeHealer("ppt", pptInitial, { kind: "selection", targetIds: ["slide-1-subtitle-1"] });
    healer.heal(envelopeOf({ slides: [{ id: "slide-1", objects: [] }] }));
    expect(healer.heal(envelopeOf({ slides: [{ id: "slide-1", objects: [{ id: "new-text" }] }] }))).toEqual({
      kind: "container",
      targetIds: ["slide-1"],
    });
    expect(healer.heal(envelopeOf({ slides: [{ id: "slide-2", objects: [] }] }))).toBeNull();
  });

  it("多对象选择部分被删：整个 scope 升级为去重后的所属页集合", () => {
    const scope: SelectionScope = {
      kind: "selection",
      targetIds: ["slide-1-subtitle-1", "slide-2-body-1"],
    };
    const healer = createScopeHealer("ppt", pptInitial, scope);
    const healed = healer.heal(envelopeOf({ slides: [{ id: "slide-1", objects: [{ id: "slide-1-title-1" }] }] }));
    expect(healed).toEqual({ kind: "container", targetIds: ["slide-1"] });
  });

  it("container 目标页被删：无法放宽，返回 null（由调用方中止）", () => {
    const healer = createScopeHealer("ppt", pptInitial, { kind: "container", targetIds: ["slide-1"] });
    expect(healer.heal(envelopeOf({ slides: [{ id: "slide-2", objects: [] }] }))).toBeNull();
  });

  it("运行开始时就不存在的 id 不做自愈：原样保留，交给 adapter 报错", () => {
    const healer = createScopeHealer("ppt", pptInitial, { kind: "selection", targetIds: ["ghost-object"] });
    expect(healer.heal(pptInitial)).toEqual({ kind: "selection", targetIds: ["ghost-object"] });
    const containerHealer = createScopeHealer("ppt", pptInitial, { kind: "container", targetIds: ["ghost-slide"] });
    expect(containerHealer.heal(pptInitial)).toEqual({ kind: "container", targetIds: ["ghost-slide"] });
  });

  it("file scope 永远原样返回", () => {
    const healer = createScopeHealer("ppt", pptInitial, { kind: "file", targetIds: [] });
    expect(healer.heal(envelopeOf({ slides: [] }))).toEqual({ kind: "file", targetIds: [] });
  });
});

describe("createScopeHealer (word)", () => {
  const wordInitial = envelopeOf({
    sections: [
      { id: "section-1", blockIds: ["block-1", "block-2"] },
      { id: "section-2", blockIds: ["block-3"] },
    ],
    blocks: [{ id: "block-1" }, { id: "block-2" }, { id: "block-3" }],
  });

  it("selection 块被删除：自愈为所属章节 container；章节也没了则 null", () => {
    const healer = createScopeHealer("word", wordInitial, { kind: "selection", targetIds: ["block-2"] });
    expect(
      healer.heal(
        envelopeOf({
          sections: [{ id: "section-1", blockIds: ["block-1"] }],
          blocks: [{ id: "block-1" }],
        }),
      ),
    ).toEqual({ kind: "container", targetIds: ["section-1"] });

    expect(
      healer.heal(
        envelopeOf({
          sections: [{ id: "section-2", blockIds: ["block-3"] }],
          blocks: [{ id: "block-3" }],
        }),
      ),
    ).toBeNull();
  });
});
