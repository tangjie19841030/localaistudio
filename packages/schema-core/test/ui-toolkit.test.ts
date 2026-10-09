import { describe, expect, it } from "vitest";
import {
  CommandExecutionError,
  createDocumentEnvelope,
  executeCommand,
  executeTransaction,
} from "@studio/studio-core";
import { defaultStudioDocument, type Page, type StudioDocument } from "../src/document.js";
import { makeNode, insertNode } from "../src/registry/documentOps.js";
import { getNode as getPageNode } from "../src/registry/treeUtils.js";

/** getNode over a page OR a whole doc (first page). */
function getNode(doc: Page | StudioDocument, id: string) {
  const page = "pages" in doc ? doc.pages[0]! : doc;
  return getPageNode(page, id);
}

/** The first page of a StudioDocument. */
function firstPage(doc: StudioDocument): Page {
  return doc.pages[0]!;
}

/** Wrap a page into a minimal StudioDocument for the envelope factory. */
function docOfPage(page: Page): StudioDocument {
  const doc = defaultStudioDocument(page.name);
  doc.pages[0] = { ...page };
  return doc;
}
import {
  createUiDocumentEnvelope,
  UI_TOOLKIT,
  UI_TOOLKIT_ID,
} from "../src/ui-toolkit/index.js";

describe("UI ToolKit", () => {
  it("accepts only UI page documents in the UI envelope", () => {
    const envelope = createUiDocumentEnvelope(defaultStudioDocument("UI 项目"));

    expect(UI_TOOLKIT.document.parse(envelope).document.name).toBe("UI 项目");
    expect(() =>
      UI_TOOLKIT.document.parse(
        createDocumentEnvelope({
          projectType: "ppt",
          toolkitId: UI_TOOLKIT_ID,
          toolkitVersion: UI_TOOLKIT.version,
          documentVersion: 1,
          document: defaultStudioDocument("错误类型"),
        }),
      ),
    ).toThrow("UI 文档信封不匹配");
  });

  it("runs existing UI node operations through the shared command dispatcher", () => {
    const original = createUiDocumentEnvelope(defaultStudioDocument("UI 项目"));
    const result = executeTransaction(UI_TOOLKIT, original, [
      {
        invocationId: "insert-card",
        id: "ui.insert-node",
        args: { type: "Card", parentId: "root", nodeId: "card-1" },
        source: "manual",
        scope: { kind: "file", targetIds: [] },
      },
      {
        invocationId: "update-card",
        id: "ui.update-props",
        args: { nodeId: "card-1", props: { title: "指标概览", padded: true } },
        source: "ai",
        scope: { kind: "selection", targetIds: ["card-1"] },
      },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(getNode(result.envelope.document, "card-1")?.props).toEqual({
        title: "指标概览",
        padded: true,
      });
      expect(result.commands.map((command) => command.result.summary)).toEqual([
        "已插入 卡片",
        "已更新 card-1 的属性",
      ]);
    }
  });

  it("uses the UI selection resolver for object writes and blocks document-wide commands from selection scope", () => {
    const document = insertNode(defaultStudioDocument("UI 项目").pages[0]!, makeNode("Card", "card-1"), "root");
    const envelope = createUiDocumentEnvelope(docOfPage(document));
    expect(() =>
      executeCommand(UI_TOOLKIT, envelope, {
        invocationId: "outside",
        id: "ui.update-props",
        args: { nodeId: "root", props: { maxWidth: "full" } },
        source: "ai",
        scope: { kind: "selection", targetIds: ["card-1"] },
      }),
    ).toThrow(CommandExecutionError);

    expect(() =>
      executeCommand(UI_TOOLKIT, envelope, {
        invocationId: "rename-selection",
        id: "ui.rename-document",
        args: { name: "不允许" },
        source: "manual",
        scope: { kind: "selection", targetIds: ["root"] },
      }),
    ).toThrow("不支持 selection 范围");
  });

  it("duplicates a selected subtree through the shared dispatcher", () => {
    const document = insertNode(defaultStudioDocument("UI 项目").pages[0]!, makeNode("Card", "card-1"), "root");
    const result = executeCommand(UI_TOOLKIT, createUiDocumentEnvelope(docOfPage(document)), {
      invocationId: "duplicate-card",
      id: "ui.duplicate-node",
      args: { nodeId: "card-1" },
      source: "manual",
      scope: { kind: "container", targetIds: ["root"] },
    });

    expect(result.result.affectedIds).toHaveLength(2);
    expect(result.result.nextEnvelope.document.pages[0]!.nodes).toHaveLength(3);
    expect(getNode(result.result.nextEnvelope.document, "card-1")).toBeDefined();
  });

  it("blocks a selected node from moving into an unselected container", () => {
    const withSource = insertNode(defaultStudioDocument("UI 项目").pages[0]!, makeNode("Stack", "source"), "root");
    const withTarget = insertNode(withSource, makeNode("Stack", "target"), "root");
    const document = insertNode(withTarget, makeNode("Card", "card-1"), "source");

    expect(() =>
      executeCommand(UI_TOOLKIT, createUiDocumentEnvelope(docOfPage(document)), {
        invocationId: "move-card",
        id: "ui.move-node",
        args: { nodeId: "card-1", parentId: "target" },
        source: "ai",
        scope: { kind: "selection", targetIds: ["card-1"] },
      }),
    ).toThrow("命令超出当前范围");
  });

  it("blocks locked nodes and lets a manual lock command unlock them", () => {
    const lockedCard = { ...makeNode("Card", "card-1"), locked: true };
    const document = insertNode(defaultStudioDocument("UI 项目").pages[0]!, lockedCard, "root");
    const envelope = createUiDocumentEnvelope(docOfPage(document));

    expect(() =>
      executeCommand(UI_TOOLKIT, envelope, {
        invocationId: "update-locked",
        id: "ui.update-props",
        args: { nodeId: "card-1", props: { title: "不可修改", padded: true } },
        source: "ai",
        scope: { kind: "selection", targetIds: ["card-1"] },
      }),
    ).toThrow("目标已锁定");

    expect(() =>
      executeCommand(UI_TOOLKIT, envelope, {
        invocationId: "ai-unlock",
        id: "ui.set-node-locked",
        args: { nodeId: "card-1", locked: false },
        source: "ai",
        scope: { kind: "selection", targetIds: ["card-1"] },
      }),
    ).toThrow("AI 未注册命令");

    const unlocked = executeCommand(UI_TOOLKIT, envelope, {
      invocationId: "unlock-card",
      id: "ui.set-node-locked",
      args: { nodeId: "card-1", locked: false },
      source: "manual",
      scope: { kind: "selection", targetIds: ["card-1"] },
    });
    expect(getNode(unlocked.result.nextEnvelope.document, "card-1")?.locked).toBeUndefined();
  });

  it("does not unlock a child through its locked container", () => {
    const lockedContainer = { ...makeNode("Stack", "section-1"), locked: true };
    const withContainer = insertNode(defaultStudioDocument("UI 项目").pages[0]!, lockedContainer, "root");
    const document = insertNode(withContainer, makeNode("Card", "card-1"), "section-1");

    expect(() =>
      executeCommand(UI_TOOLKIT, createUiDocumentEnvelope(docOfPage(document)), {
        invocationId: "unlock-child",
        id: "ui.set-node-locked",
        args: { nodeId: "card-1", locked: false },
        source: "manual",
        scope: { kind: "container", targetIds: ["section-1"] },
      }),
    ).toThrow("目标已锁定");
  });
});
