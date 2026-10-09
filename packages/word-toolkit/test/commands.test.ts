import { describe, expect, it } from "vitest";
import type { CommandInvocation } from "@studio/studio-core";
import {
  CommandExecutionError,
  executeCommand,
  executeTransaction,
  ToolKitRegistry,
} from "@studio/studio-core";
import { WORD_TOOLKIT } from "../src/index.js";
import { baseDocument, blockScope, fileScope, invocation, rangeScope, sectionScope, wordEnvelope } from "./fixtures.js";

function run(overrides: Partial<CommandInvocation> = {}) {
  return executeCommand(WORD_TOOLKIT, wordEnvelope(), invocation(overrides));
}

describe("word commands", () => {
  it("renames the document (file scope)", () => {
    const executed = run({ id: "word.doc.rename", args: { name: "季度报告" }, scope: fileScope });
    expect(executed.result.nextEnvelope.document.name).toBe("季度报告");
  });

  it("inserts a paragraph with a server-assigned id", () => {
    const executed = run({
      id: "word.block.insert",
      args: { block: { type: "paragraph", runs: [{ text: "新段落" }] }, sectionId: "section-1", index: 1 },
      scope: fileScope,
    });
    const created = executed.result.createdIds![0]!;
    expect(created).toMatch(/^wb_/);
    expect(executed.result.nextEnvelope.document.blocks.some((block) => block.id === created)).toBe(true);
    expect(executed.result.nextEnvelope.document.sections[0]!.blockIds[1]).toBe(created);
  });

  it("inserts a heading and a table at explicit positions", () => {
    const heading = run({
      id: "word.block.insert",
      args: { block: { type: "heading", level: 2, runs: [{ text: "二级标题" }] }, blockId: "h-2", sectionId: "section-1" },
      scope: sectionScope,
    });
    expect(heading.result.nextEnvelope.document.blocks.some((block) => block.id === "h-2")).toBe(true);
    const table = run({
      id: "word.block.insert",
      args: {
        block: { type: "table", headerRowCount: 1, rows: [{ cells: [{ runs: [{ text: "列" }] }] }] },
        blockId: "t-2",
        sectionId: "section-2",
      },
      scope: fileScope,
    });
    expect(table.result.nextEnvelope.document.sections[1]!.blockIds).toContain("t-2");
  });

  it("removes a block and its anchored comments", () => {
    const withComment = run({ id: "word.comment.add", args: { commentId: "c-1", targetBlockId: "para-1", author: "张三", text: "这里要改" }, scope: fileScope });
    const removed = executeCommand(WORD_TOOLKIT, withComment.result.nextEnvelope, invocation({
      id: "word.block.remove",
      args: { blockId: "para-1" },
      scope: blockScope("para-1"),
    }));
    const doc = removed.result.nextEnvelope.document;
    expect(doc.blocks.some((block) => block.id === "para-1")).toBe(false);
    expect(doc.comments.some((comment) => comment.id === "c-1")).toBe(false);
  });

  it("moves a block across sections", () => {
    const executed = run({
      id: "word.block.move",
      args: { blockId: "para-1", targetSectionId: "section-2", index: 0 },
      scope: fileScope,
    });
    const doc = executed.result.nextEnvelope.document;
    expect(doc.sections[0]!.blockIds).not.toContain("para-1");
    expect(doc.sections[1]!.blockIds).toContain("para-1");
  });

  it("replaces runs via update-text", () => {
    const executed = run({
      id: "word.block.update-text",
      args: { blockId: "para-1", runs: [{ text: "整段替换" }, { text: "斜体", italic: true }] },
      scope: blockScope("para-1"),
    });
    const block = executed.result.nextEnvelope.document.blocks.find((b) => b.id === "para-1");
    expect(block).toMatchObject({ type: "paragraph", runs: [{ text: "整段替换" }, { text: "斜体", italic: true }] });
  });

  it("applies range-scope rewrite inside the selected run span only", () => {
    const executed = run({
      id: "word.block.update-text",
      args: { blockId: "para-2", runs: [{ text: "全部改写" }] },
      scope: rangeScope("para-2", 0, 2),
    });
    expect(executed.result.summary).toContain("已更新块 para-2 的文本");
  });

  it("sets paragraph style and run-level direct formatting", () => {
    const executed = run({
      id: "word.block.set-style",
      args: { blockId: "para-1", styleId: "quote", bold: true },
      scope: blockScope("para-1"),
    });
    const block = executed.result.nextEnvelope.document.blocks.find((b) => b.id === "para-1");
    expect(block).toMatchObject({ type: "paragraph", styleId: "quote" });
    expect((block as { runs: { bold?: boolean }[] }).runs.every((run) => run.bold === true)).toBe(true);
  });

  it("updates table rows and columns", () => {
    const base = wordEnvelope();
    const added = executeCommand(WORD_TOOLKIT, base, invocation({
      id: "word.block.update-table",
      args: { blockId: "table-1", addRow: true },
      scope: blockScope("table-1"),
    }));
    const afterAdd = added.result.nextEnvelope.document.blocks.find((b) => b.id === "table-1") as unknown as { rows: unknown[] };
    expect(afterAdd.rows).toHaveLength(3);

    const widened = executeCommand(WORD_TOOLKIT, added.result.nextEnvelope, invocation({
      id: "word.block.update-table",
      args: { blockId: "table-1", addColumn: true },
      scope: blockScope("table-1"),
    }));
    const afterCol = widened.result.nextEnvelope.document.blocks.find((b) => b.id === "table-1") as unknown as { rows: { cells: unknown[] }[] };
    expect(afterCol.rows.every((row) => row.cells.length === 3)).toBe(true);

    const shrunk = executeCommand(WORD_TOOLKIT, widened.result.nextEnvelope, invocation({
      id: "word.block.update-table",
      args: { blockId: "table-1", removeColumn: true },
      scope: blockScope("table-1"),
    }));
    const afterRemove = shrunk.result.nextEnvelope.document.blocks.find((b) => b.id === "table-1") as unknown as { rows: { cells: unknown[] }[] };
    expect(afterRemove.rows.every((row) => row.cells.length === 2)).toBe(true);
  });

  it("inserts, renames and removes sections", () => {
    const inserted = run({ id: "word.section.insert", args: { sectionId: "section-3", heading: "附录", index: 1 }, scope: fileScope });
    expect(inserted.result.nextEnvelope.document.sections[1]!.heading).toBe("附录");
    const renamed = executeCommand(WORD_TOOLKIT, inserted.result.nextEnvelope, invocation({
      id: "word.section.rename",
      args: { sectionId: "section-3", heading: "附录 B" },
      scope: { kind: "container", targetIds: ["section-3"] },
    }));
    expect(renamed.result.nextEnvelope.document.sections[1]!.heading).toBe("附录 B");
    const removed = executeCommand(WORD_TOOLKIT, renamed.result.nextEnvelope, invocation({
      id: "word.section.remove",
      args: { sectionId: "section-2" },
      scope: fileScope,
    }));
    expect(removed.result.nextEnvelope.document.sections.some((s) => s.id === "section-2")).toBe(false);
  });

  it("refuses to remove the last remaining section", () => {
    const doc = baseDocument();
    doc.sections = [doc.sections[0]!];
    const envelope = wordEnvelope(doc);
    expect(() =>
      executeCommand(WORD_TOOLKIT, envelope, invocation({
        id: "word.section.remove",
        args: { sectionId: "section-1" },
        scope: fileScope,
      })),
    ).toThrow(/至少要保留一个章节/);
  });

  it("adds a footnote anchored in a paragraph", () => {
    const executed = run({
      id: "word.footnote.add",
      args: { footnoteId: "fn-1", blockId: "para-1", runs: [{ text: "参考资料。" }] },
      scope: blockScope("para-1"),
    });
    const doc = executed.result.nextEnvelope.document;
    expect(doc.footnotes).toHaveLength(1);
    const block = doc.blocks.find((b) => b.id === "para-1") as unknown as { runs: { footnoteRef?: string }[] };
    expect(block.runs.some((run) => run.footnoteRef === "fn-1")).toBe(true);
  });

  it("sets and clears section header/footer", () => {
    const set = run({ id: "word.header.set", args: { sectionId: "section-1", runs: [{ text: "公司内部资料" }] }, scope: fileScope });
    expect(set.result.nextEnvelope.document.sections[0]!.header).toEqual({ runs: [{ text: "公司内部资料" }] });
    const cleared = run({ id: "word.header.set", args: { sectionId: "section-1" }, scope: fileScope });
    expect(cleared.result.nextEnvelope.document.sections[0]!.header).toBeUndefined();
    const footer = run({ id: "word.footer.set", args: { sectionId: "section-1", runs: [{ text: "第 1 页" }] }, scope: fileScope });
    expect(footer.result.nextEnvelope.document.sections[0]!.footer).toEqual({ runs: [{ text: "第 1 页" }] });
  });

  it("generates a toc snapshot from the heading structure", () => {
    const doc = baseDocument();
    doc.sections[0]!.blockIds = ["heading-1", "para-1", "toc-1"];
    doc.blocks = doc.blocks.filter((block) => doc.sections[0]!.blockIds.includes(block.id));
    const envelope = wordEnvelope(doc);
    const executed = executeCommand(WORD_TOOLKIT, envelope, invocation({
      id: "word.toc.generate",
      args: { tocBlockId: "toc-1" },
      scope: fileScope,
    }));
    const toc = executed.result.nextEnvelope.document.blocks.find((b) => b.id === "toc-1");
    expect((toc as { entries?: { headingBlockId: string; level: number; text: string }[] }).entries).toEqual([
      { headingBlockId: "heading-1", level: 1, text: "项目概述" },
    ]);
  });

  it("blocks editing a locked block and honors manual lock override", () => {
    const doc = baseDocument();
    (doc.blocks[1] as { locked?: boolean }).locked = true;
    expect(() =>
      executeCommand(WORD_TOOLKIT, wordEnvelope(doc), invocation({
        id: "word.block.update-text",
        args: { blockId: "para-1", runs: [{ text: "x" }] },
        scope: blockScope("para-1"),
      })),
    ).toThrow(/目标已锁定: para-1/);

    const unlocked = executeCommand(WORD_TOOLKIT, wordEnvelope(doc), invocation({
      id: "word.block.set-locked",
      args: { blockId: "para-1", locked: false },
      scope: blockScope("para-1"),
    }));
    const after = unlocked.result.nextEnvelope.document.blocks.find((b) => b.id === "para-1");
    expect((after as { locked?: boolean }).locked).toBeUndefined();
  });

  it("rejects out-of-scope targets", () => {
    expect(() =>
      run({
        id: "word.block.update-text",
        args: { blockId: "para-2", runs: [{ text: "x" }] },
        scope: blockScope("para-1"),
      }),
    ).toThrow(CommandExecutionError);
    expect(() =>
      run({
        id: "word.block.update-text",
        args: { blockId: "para-1", runs: [{ text: "x" }] },
        scope: { kind: "container", targetIds: ["section-2"] },
      }),
    ).toThrow(/命令超出当前范围/);
  });

  it("rejects a range-scope command whose kind is not allowed", () => {
    expect(() =>
      run({
        id: "word.block.remove",
        args: { blockId: "para-1" },
        scope: rangeScope("para-1", 0, 1),
      }),
    ).toThrow(/不支持 range 范围/);
  });

  it("块细节编辑：标题层级 / 表格单元格 / run 颜色字号 / 列表更新 / 图片更新", () => {
    // Build a doc containing a list and an image too.
    const doc = baseDocument();
    doc.blocks.push(
      { id: "list-1", type: "list", ordered: false, items: [{ runs: [{ text: "旧一" }] }, { runs: [{ text: "旧二" }] }] },
      { id: "img-1", type: "image", src: "old.png", width: 200 },
    );
    doc.sections[0]!.blockIds.push("list-1", "img-1");
    let env = wordEnvelope(doc);
    const exec = (id: string, args: unknown, scope = fileScope) => {
      const result = executeCommand(WORD_TOOLKIT, env, invocation({ id, args, scope }));
      env = result.result.nextEnvelope ?? env;
      return result;
    };
    const get = (id: string) => env.document.blocks.find((b) => b.id === id)!;

    exec("word.heading.set-level", { blockId: "heading-1", level: 2 }, blockScope("heading-1"));
    const heading = get("heading-1");
    expect(heading.type === "heading" && heading.level).toBe(2);

    exec("word.block.update-table-cell", { blockId: "table-1", row: 1, col: 1, runs: [{ text: "42" }] }, blockScope("table-1"));
    const table = get("table-1");
    expect(table.type === "table" && table.rows[1]!.cells[1]!.runs[0]!.text).toBe("42");

    // Direct run color/size survives update-text.
    exec("word.block.update-text", { blockId: "para-1", runs: [{ text: "红字", color: "#E11D48", size: 18 }] });
    const para = get("para-1");
    expect(para.type === "paragraph" && para.runs[0]!.color).toBe("#E11D48");
    expect(para.type === "paragraph" && para.runs[0]!.size).toBe(18);

    exec("word.list.update", {
      blockId: "list-1",
      items: [{ runs: [{ text: "新甲" }] }, { runs: [{ text: "新乙" }] }, { runs: [{ text: "新丙" }] }],
      ordered: true,
    }, blockScope("list-1"));
    const list = get("list-1");
    expect(list.type === "list" && list.items).toHaveLength(3);
    expect(list.type === "list" && list.ordered).toBe(true);

    exec("word.block.update-image", { blockId: "img-1", src: "new.png", width: 300, caption: "配图" }, blockScope("img-1"));
    const image = get("img-1");
    expect(image.type === "image" && image.src).toBe("new.png");
    expect(image.type === "image" && image.width).toBe(300);
  });

  it("selection（块）范围现在可以在选中块旁边插入、以及删除/移动选中块", () => {
    // Insert a sibling next to a selected block (owner section anchor is in reach).
    const inserted = run({
      id: "word.block.insert",
      args: { block: { type: "paragraph", runs: [{ text: "旁注" }] }, sectionId: "section-1" },
      scope: blockScope("para-1"),
    });
    expect(inserted.result.nextEnvelope).toBeDefined();
    expect(inserted.result.createdIds).toHaveLength(1);
    expect(() =>
      executeCommand(
        WORD_TOOLKIT,
        wordEnvelope(),
        invocation({ id: "word.block.remove", args: { blockId: "para-1" }, scope: blockScope("para-1") }),
      ),
    ).not.toThrow();
  });

  it("word.block.duplicate 在源块后插入深拷贝（新 id、同章节）", () => {
    const executed = executeCommand(
      WORD_TOOLKIT,
      wordEnvelope(),
      invocation({ id: "word.block.duplicate", args: { blockId: "para-1" }, scope: fileScope }),
    );
    const doc = executed.result.nextEnvelope.document;
    const originals = doc.blocks.filter((b) => b.type === "paragraph" && b.runs[0]?.text.includes("这是第一段"));
    expect(originals).toHaveLength(2);
    const [source, clone] = originals;
    expect(clone!.id).not.toBe(source!.id);
    expect(clone!.id).toMatch(/^wb_/);
    const section = doc.sections[0]!;
    expect(section.blockIds.indexOf(clone!.id)).toBe(section.blockIds.indexOf("para-1") + 1);
  });

  it("word.block.duplicate 拒绝复制锁定块", () => {
    const lockedDoc = baseDocument();
    lockedDoc.blocks = lockedDoc.blocks.map((b) => (b.id === "para-1" ? { ...b, locked: true } : b));
    expect(() =>
      executeCommand(
        WORD_TOOLKIT,
        wordEnvelope(lockedDoc),
        invocation({ id: "word.block.duplicate", args: { blockId: "para-1" }, scope: fileScope }),
      ),
    ).toThrow(/锁定/);
  });

  it("rejects AI invocations of unregistered commands", () => {
    expect(() =>
      run({
        source: "ai",
        id: "word.header.set",
        args: { sectionId: "sec-1", runs: [{ text: "页眉" }] },
        scope: fileScope,
      }),
    ).toThrow(/AI 未注册命令/);
  });

  it("rolls back the whole transaction when a later command fails", () => {
    const original = wordEnvelope();
    const result = executeTransaction(WORD_TOOLKIT, original, [
      invocation({ invocationId: "t1", id: "word.doc.rename", args: { name: "第一步" }, scope: fileScope }),
      invocation({ invocationId: "t2", id: "word.block.remove", args: { blockId: "不存在的块" }, scope: fileScope }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.envelope).toEqual(original);
      expect(result.error).toBeInstanceOf(CommandExecutionError);
      expect(result.envelope.document.name).toBe("测试文档");
    }
  });

  it("applies a transaction atomically when all commands succeed", () => {
    const result = executeTransaction(WORD_TOOLKIT, wordEnvelope(), [
      invocation({ invocationId: "t1", id: "word.doc.rename", args: { name: "批量" }, scope: fileScope }),
      invocation({ invocationId: "t2", id: "word.block.update-text", args: { blockId: "para-1", runs: [{ text: "事务内" }] }, scope: blockScope("para-1") }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.document.name).toBe("批量");
      expect(result.commands).toHaveLength(2);
    }
  });
});

describe("word toolkit registry", () => {
  it("registers through ToolKitRegistry and lists for project type word", () => {
    const registry = new ToolKitRegistry([WORD_TOOLKIT]);
    expect(registry.get("word", "builtin.word")).toBe(WORD_TOOLKIT);
    expect(registry.getForProjectType("word")).toBe(WORD_TOOLKIT);
  });

  it("has aiTools whose commandIds all exist", () => {
    const commandIds = new Set(WORD_TOOLKIT.commands.map((command) => command.id));
    for (const tool of WORD_TOOLKIT.aiTools) {
      expect(tool.commandIds.length).toBeGreaterThan(0);
      for (const commandId of tool.commandIds) {
        expect(commandIds.has(commandId)).toBe(true);
      }
    }
    expect(WORD_TOOLKIT.aiTools.map((tool) => tool.id)).toEqual(["word.ai.draft", "word.ai.rewrite", "word.ai.restructure"]);
  });

  it("creates an empty document through the adapter", () => {
    const envelope = WORD_TOOLKIT.document.createEmpty("空白");
    expect(envelope.document.sections).toHaveLength(1);
    expect(envelope.document.blocks).toHaveLength(1);
    expect(envelope.document.blocks[0]).toMatchObject({ type: "paragraph" });
    expect(() => WORD_TOOLKIT.document.parse(JSON.parse(JSON.stringify(envelope)))).not.toThrow();
  });
});
