import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createProjectsStore } from "../src/store/projects.js";
import { runToolkitChatStream } from "../src/ai/toolkit-pipeline.js";
import { buildToolkitSystemPrompt, scopedDocumentView } from "../src/ai/toolkit-prompt.js";
import type { ToolkitDriver } from "../src/ai/mock-toolkit.js";
import { createPptDocumentEnvelope, defaultTheme, type PptDocument } from "@studio/ppt-toolkit";
import { createWordDocumentEnvelope, emptyWordDocument } from "@studio/word-toolkit";
import { PPT_TOOLKIT } from "@studio/ppt-toolkit";
import { WORD_TOOLKIT } from "@studio/word-toolkit";

/**
 * T79: the toolkit system prompt must show only the ids the frozen scope may
 * touch. The full-document dump let the model reference out-of-scope object ids,
 * which ensureScopeAllows rejected ("命令超出当前范围: …") until the run aborted
 * (live repro: a selection turn on imp-s16-text325 died while editing another
 * slide's object). These tests lock the per-scope slicing plus the humanized
 * terminal copy for scope violations.
 */

const deck: PptDocument = {
  documentVersion: 1,
  name: "T79 测试稿",
  presentation: { title: null, author: null, subject: null },
  slideSize: { w: 1280, h: 720 },
  theme: defaultTheme(),
  masters: [],
  layouts: [],
  slides: [
    {
      id: "s1",
      title: "封面",
      notes: "",
      objects: [
        {
          id: "s1-o1",
          kind: "text",
          rect: { x: 0, y: 0, w: 100, h: 50 },
          paragraphs: [{ runs: [{ text: "封面文字" }] }],
        },
      ],
    },
    {
      id: "s2",
      title: "第二页",
      notes: "",
      objects: [
        {
          id: "s2-o1",
          kind: "text",
          rect: { x: 10, y: 10, w: 100, h: 50 },
          paragraphs: [{ runs: [{ text: "第二页文字" }] }],
        },
        { id: "s2-o2", kind: "shape", shape: "rect", rect: { x: 200, y: 10, w: 100, h: 50 } },
      ],
    },
  ],
};

const pptEnvelope = createPptDocumentEnvelope(deck);

function promptFor(scope: Parameters<typeof buildToolkitSystemPrompt>[2]): string {
  return buildToolkitSystemPrompt(PPT_TOOLKIT, pptEnvelope, scope);
}

/** The `当前文档：<json>` payload the model actually reads. */
function documentLine(prompt: string): string {
  const line = prompt.split("\n").find((l) => l.startsWith("当前文档："));
  expect(line).toBeTruthy();
  return line!.slice("当前文档：".length);
}

describe("T79 toolkit 提示词按 scope 裁剪文档", () => {
  it("file scope：文档视图与旧的整份 JSON 字节一致", () => {
    const prompt = promptFor({ kind: "file", targetIds: [] });
    expect(documentLine(prompt)).toBe(JSON.stringify(pptEnvelope.document));
  });

  it("container scope：只含目标页的对象 + 其余页的 {id,title} 大纲，无其他页对象 id", () => {
    const prompt = promptFor({ kind: "container", targetIds: ["s2"] });
    const view = JSON.parse(documentLine(prompt)) as Record<string, unknown>;
    expect(JSON.stringify(view.slides)).toContain("s2-o1");
    expect(JSON.stringify(view.slides)).toContain("s2-o2");
    // No other slide's object id may appear ANYWHERE in the prompt.
    expect(prompt).not.toContain("s1-o1");
    // Deck outline of the REMAINING slides keeps narrative context, no objects.
    expect(view.deckOutline).toEqual([{ id: "s1", title: "封面" }]);
    expect(prompt).toContain("封面");
  });

  it("selection scope：含目标对象与其所属页 id，无任何其他对象 id，含大纲标题", () => {
    const prompt = promptFor({ kind: "selection", targetIds: ["s2-o1"] });
    const view = JSON.parse(documentLine(prompt)) as {
      selection: { slideId: string; objects: { id: string }[] }[];
      deckOutline: unknown;
    };
    expect(view.selection).toHaveLength(1);
    expect(view.selection[0]!.slideId).toBe("s2");
    expect(view.selection[0]!.objects.map((o) => o.id)).toEqual(["s2-o1"]);
    // No other object id may appear ANYWHERE in the prompt.
    expect(prompt).not.toContain("s2-o2");
    expect(prompt).not.toContain("s1-o1");
    expect(view.deckOutline).toEqual([
      { id: "s1", title: "封面" },
      { id: "s2", title: "第二页" },
    ]);
  });

  it("word 分支保持整份文档（该失败模式不存在于 word 提示词）", () => {
    const wordEnvelope = createWordDocumentEnvelope(emptyWordDocument("T79 word"));
    const blockId = (wordEnvelope.document as { blocks: { id: string }[] }).blocks[0]!.id;
    const prompt = buildToolkitSystemPrompt(WORD_TOOLKIT, wordEnvelope, { kind: "selection", targetIds: [blockId] });
    expect(documentLine(prompt)).toBe(JSON.stringify(wordEnvelope.document));
  });

  it("scopedDocumentView：非 ppt 项目与 file scope 原样返回", () => {
    const wordEnvelope = createWordDocumentEnvelope(emptyWordDocument("T79 raw"));
    expect(scopedDocumentView(wordEnvelope, { kind: "selection", targetIds: [] })).toBe(wordEnvelope.document);
    expect(scopedDocumentView(pptEnvelope, { kind: "file", targetIds: [] })).toBe(pptEnvelope.document);
  });
});

let dataDir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(join(tmpdir(), "studio-toolkit-prompt-"));
  app = createApp(createProjectsStore(join(dataDir, "projects")), { dataDir });
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function createPptProject(): Promise<string> {
  const res = await app.request("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "T79 范围越界", projectType: "ppt" }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { meta: { id: string } }).meta.id;
}

/** Drive the pipeline with a scripted driver and collect the emitted frames. */
async function runWithDriver(projectId: string, driver: ToolkitDriver, targetIds: string[]): Promise<Record<string, unknown>[]> {
  const store = createProjectsStore(join(dataDir, "projects"));
  const events: Record<string, unknown>[] = [];
  await runToolkitChatStream(
    { store, dataDir, toolkitDriver: driver },
    { projectId, messages: [{ role: "user", content: "改一下这个对象" }], scope: { kind: "selection", targetIds } },
    new AbortController(),
    async (event) => void events.push(event),
  );
  return events;
}

function terminalRaw(events: Record<string, unknown>[]): string {
  const errorEvent = events.find((e) => "error" in e) as { raw?: unknown } | undefined;
  expect(errorEvent).toMatchObject({ error: "invalid_json" }); // client contract unchanged
  return String(errorEvent?.raw ?? "");
}

describe("T79 scope 越界终帧文案人话化", () => {
  it("连续失败批次：终帧提示用户在画布上重新选择，模型侧 tool-result 保持原样", async () => {
    // s2-o1 is the frozen selection target; editing s1-o1 is outside the scope.
    const projectId = await createPptProject();
    let round = 0;
    const driver: ToolkitDriver = {
      async next() {
        round += 1;
        return [{ commandId: "object.editText", args: { objectId: "slide-1-title-1", paragraphs: [{ runs: [{ text: "越界" }] }] } }];
      },
    };
    const events = await runWithDriver(projectId, driver, ["slide-1-subtitle-1"]);
    expect(round).toBeGreaterThanOrEqual(3);
    const raw = terminalRaw(events);
    expect(raw).toContain("AI 尝试修改了选中范围之外的目标");
    expect(raw).toContain("slide-1-title-1");
    expect(raw).toContain("请在画布上选中要修改的对象后重试");
    expect(raw).not.toContain("连续 3 步失败");
    // The model still receives the precise adapter error to self-correct.
    const toolResult = events.find((e) => e.type === "tool-result") as { message?: string } | undefined;
    expect(String(toolResult?.message)).toBe("命令超出当前范围: slide-1-title-1");
  });

  it("driver 收尾路径（endOfRound）：全失败步同样给出人话终帧", async () => {
    const projectId = await createPptProject();
    const driver: ToolkitDriver = {
      async next() {
        return []; // SDK shape: executed steps arrive through takeInternal
      },
      takeInternal() {
        return {
          envelope: pptEnvelope,
          steps: [{ commandId: "object.editText", ok: false, message: "命令超出当前范围: slide-1-title-1" }],
        };
      },
    };
    const events = await runWithDriver(projectId, driver, ["slide-1-subtitle-1"]);
    const raw = terminalRaw(events);
    expect(raw).toContain("AI 尝试修改了选中范围之外的目标（slide-1-title-1）");
  });

  it("非 scope 失败保留原错误文案", async () => {
    const projectId = await createPptProject();
    const driver: ToolkitDriver = {
      async next() {
        return [{ commandId: "object.editText", args: { objectId: "ghost-object", paragraphs: [{ runs: [{ text: "x" }] }] } }];
      },
    };
    const events = await runWithDriver(projectId, driver, ["slide-1-subtitle-1"]);
    const raw = terminalRaw(events);
    expect(raw).toBe("连续 3 步失败，已中止：对象不存在: ghost-object");
  });
});

const REAL_DECK = resolve(
  fileURLToPath(import.meta.url),
  "../../../..",
  "data/projects/ce2c42f5-e81a-4561-bfd3-72ae39c5497b/document/document.json",
);

describe("T79 真实稿只读抽查（data/ 只读）", () => {
  it("selection scope 提示词只含目标对象 id，并报告字符数收缩", async () => {
    if (!existsSync(REAL_DECK)) return; // deck absent (fresh clone) — nothing to sample
    const raw = JSON.parse(await fs.readFile(REAL_DECK, "utf8")) as { document: unknown };
    const envelope = createPptDocumentEnvelope(raw.document as PptDocument);
    const prompt = buildToolkitSystemPrompt(PPT_TOOLKIT, envelope, { kind: "selection", targetIds: ["imp-s16-text325"] });
    expect(prompt).toContain("imp-s16-text325");
    expect(prompt).toContain("imp-s16"); // owning slide id
    const line = documentLine(prompt);
    // No OTHER object on that slide leaks into the view.
    for (const other of ["imp-s16-text318", "imp-s16-text319", "imp-s16-text320", "imp-s16-image321", "imp-s16-shape322", "imp-s16-shape323", "imp-s16-shape324"]) {
      expect(line).not.toContain(other);
    }
    expect(line).not.toContain("imp-s1-text1");
    const newDocChars = JSON.stringify(scopedDocumentView(envelope, { kind: "selection", targetIds: ["imp-s16-text325"] })).length;
    const oldDocChars = JSON.stringify(envelope.document).length;
    expect(newDocChars).toBeLessThan(oldDocChars);
    console.log(`T79 real deck: document view ${oldDocChars} -> ${newDocChars} chars (prompt ${prompt.length} chars)`);
  });
});
