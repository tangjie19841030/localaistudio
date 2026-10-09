import { describe, expect, it } from "vitest";
import { acceptPreviewTransaction, previewAiTransaction, type CommandInvocation } from "../src/index.js";
import { demoEnvelope, demoToolkit, fileScope, objectScope } from "./fixtures.js";

const rename: CommandInvocation = {
  invocationId: "rename",
  id: "demo.rename",
  args: { name: "AI 文档" },
  source: "ai",
  scope: fileScope,
};

const label: CommandInvocation = {
  invocationId: "label",
  id: "demo.set-label",
  args: { id: "object-1", label: "AI 标签" },
  source: "ai",
  scope: objectScope,
};

describe("AI preview transaction", () => {
  it("previews commands without mutating the source and accepts selected items only", () => {
    const original = demoEnvelope();
    const preview = previewAiTransaction(demoToolkit, original, [rename, label]);

    expect(original.document.name).toBe("演示");
    expect(preview.items.map((item) => item.invocationId)).toEqual(["rename", "label"]);

    const accepted = acceptPreviewTransaction(demoToolkit, preview, ["label"]);
    expect(accepted.envelope.document.name).toBe("演示");
    expect(accepted.envelope.document.objects[0]?.label).toBe("AI 标签");
    expect(accepted.rejectedInvocationIds).toEqual(["rename"]);
  });

  it("requires a selected dependent command to include its creating command", () => {
    const create: CommandInvocation = {
      invocationId: "create-object",
      id: "demo.add-object",
      args: { id: "object-2", label: "新增" },
      source: "ai",
      scope: fileScope,
    };
    const update: CommandInvocation = {
      invocationId: "update-object",
      id: "demo.set-label",
      args: { id: "object-2", label: "已更新" },
      source: "ai",
      scope: { kind: "selection", targetIds: ["object-2"] },
    };
    const preview = previewAiTransaction(demoToolkit, demoEnvelope(), [create, update]);

    expect(preview.items[1]?.dependsOnInvocationIds).toEqual(["create-object"]);
    expect(() => acceptPreviewTransaction(demoToolkit, preview, ["update-object"])).toThrow("缺少依赖");

    const accepted = acceptPreviewTransaction(demoToolkit, preview, ["create-object", "update-object"]);
    expect(accepted.envelope.document.objects).toContainEqual({ id: "object-2", label: "已更新" });
  });

  it("rejects a preview with duplicate invocation ids", () => {
    expect(() => previewAiTransaction(demoToolkit, demoEnvelope(), [label, { ...label }])).toThrow(
      "重复的命令调用 ID",
    );
  });
});
