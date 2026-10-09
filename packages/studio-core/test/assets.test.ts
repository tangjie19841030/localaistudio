import { describe, expect, it } from "vitest";
import { assetRefSchema, canSendDisclosure, parseSelectionScope } from "../src/index.js";

describe("asset disclosure and selection contracts", () => {
  it("requires explicit authorization before external data disclosure", () => {
    const disclosure = {
      id: "external-model-prompt",
      destination: "external-model" as const,
      dataCategories: ["prompt", "selection"] as const,
      summary: "将发送提示词与当前选区",
    };

    expect(canSendDisclosure(disclosure, [])).toBe(false);
    expect(
      canSendDisclosure(disclosure, [
        { disclosureId: disclosure.id, granted: true, decidedAt: "2026-09-11T00:00:00.000Z" },
      ]),
    ).toBe(true);
  });

  it("keeps embedded assets separate from cross-project references", () => {
    expect(
      assetRefSchema.parse({
        id: "asset-1",
        mediaType: "image/png",
        displayName: "封面",
        embedding: "embedded",
        relativePath: "assets/cover.png",
      }).relativePath,
    ).toBe("assets/cover.png");

    expect(() =>
      assetRefSchema.parse({
        id: "asset-2",
        mediaType: "image/png",
        displayName: "跨项目素材",
        embedding: "reference",
      }),
    ).toThrow();
  });

  it("supports toolkit-resolved text ranges without flattening them into pages", () => {
    expect(
      parseSelectionScope({
        kind: "range",
        targetIds: ["paragraph-1"],
        range: { containerId: "paragraph-1", start: 2, end: 5 },
      }),
    ).toEqual({
      kind: "range",
      targetIds: ["paragraph-1"],
      range: { containerId: "paragraph-1", start: 2, end: 5 },
    });
  });
});
