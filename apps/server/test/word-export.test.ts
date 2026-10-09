import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createProjectsStore } from "../src/store/projects.js";
import { registerWordExportRoutes } from "../src/toolkits/word/routes.js";
import { exportDocx, WordExportError } from "../src/toolkits/word/exporter.js";
import {
  defaultPageSettings,
  defaultStyleSet,
  type Run,
  type WordDocument,
} from "@studio/word-toolkit";

/**
 * P10.2: DOCX export contract (minimal-OOXML spike assertions).
 * - POST /api/projects/:id/export/docx -> PK zip with word/document.xml
 *   (w:tbl, page break), word/styles.xml (Heading1), [Content_Types].xml;
 * - non-word project -> 400; unknown id -> 404;
 * - artifact copy in <project>/export/;
 * - exporter throws WordExportError (never crashes) on bad shapes.
 *
 * Routes live on a bare Hono app; app.ts mounting is the coordinator's step.
 */

let baseDir: string;
let app: Hono;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-word-export-"));
  const store = createProjectsStore(baseDir);
  app = new Hono();
  registerWordExportRoutes(app, { store });
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

async function createProject(projectType: "ppt" | "word", name: string) {
  const store = createProjectsStore(baseDir);
  return store.create({
    name,
    productType: "",
    targetUsers: "",
    goal: "",
    referenceLinks: [],
    brandRules: "",
    projectType,
  });
}

/** heading + paragraph + table + pageBreak + list + toc snapshot. */
function sampleDoc(): WordDocument {
  return {
    documentVersion: 1,
    name: "导出文档",
    sections: [
      {
        id: "section-1",
        blockIds: ["h1", "p1", "tbl", "pagebreak", "h2", "list1", "toc"],
      },
    ],
    blocks: [
      { id: "h1", type: "heading", level: 1, runs: [{ text: "项目背景" }] },
      { id: "p1", type: "paragraph", runs: [{ text: "这是导出测试正文。" }] },
      {
        id: "tbl",
        type: "table",
        headerRowCount: 1,
        rows: [
          { cells: [{ runs: [{ text: "模块" }] }, { runs: [{ text: "状态" }] }] },
          { cells: [{ runs: [{ text: "导出器" }] }, { runs: [{ text: "完成" }] }] },
        ],
      },
      { id: "pagebreak", type: "pageBreak" },
      { id: "h2", type: "heading", level: 2, runs: [{ text: "第二章" }] },
      {
        id: "list1",
        type: "list",
        ordered: true,
        items: [{ runs: [{ text: "列表项一" }] }, { runs: [{ text: "列表项二" }] }],
      },
      {
        id: "toc",
        type: "tocPlaceholder",
        entries: [
          { headingBlockId: "h1", level: 1, text: "项目背景" },
          { headingBlockId: "h2", level: 2, text: "第二章" },
        ],
      },
    ],
    styles: defaultStyleSet(),
    pageSettings: defaultPageSettings(),
    footnotes: [],
    comments: [],
  };
}

async function saveDoc(id: string, doc: WordDocument) {
  const store = createProjectsStore(baseDir);
  const { meta } = await store.read(id);
  await store.save(id, { meta, document: doc });
}

describe("DOCX 导出", () => {
  it("文档导出为合法 zip：document.xml/styles.xml/[Content_Types].xml 齐备", async () => {
    const { meta } = await createProject("word", "导出测试文档");
    await saveDoc(meta.id, sampleDoc());

    const res = await app.request(`/api/projects/${meta.id}/export/docx`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");

    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const stylesXml = await zip.file("word/styles.xml")?.async("string");
    const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
    expect(documentXml).toBeTruthy();
    expect(stylesXml).toBeTruthy();
    expect(contentTypes).toBeTruthy();
    // body assertions: table + page break + text content
    expect(documentXml).toContain("<w:tbl>");
    expect(documentXml).toContain('<w:br w:type="page"/>');
    expect(documentXml).toContain("项目背景");
    expect(documentXml).toContain("导出测试正文。");
    expect(documentXml).toContain('w:val="Heading1"');
    // list character-prefix simplification is visible
    expect(documentXml).toContain("1. 列表项一");
    // sectPr page size: A4 595.3pt -> 11906 twips
    expect(documentXml).toContain('w:w="11906"');
    // styles part carries the Heading1 style definition
    expect(stylesXml).toContain('w:styleId="Heading1"');
    expect(contentTypes).toContain("wordprocessingml.document.main+xml");
  });

  it("artifact 副本落盘到 <project>/export/", async () => {
    const { meta } = await createProject("word", "落盘检查");
    await saveDoc(meta.id, sampleDoc());
    const res = await app.request(`/api/projects/${meta.id}/export/docx`, { method: "POST" });
    expect(res.status).toBe(200);
    const files = await fs.readdir(join(baseDir, meta.id, "export"));
    expect(files.some((name) => name.endsWith(".docx"))).toBe(true);
  });

  it("ppt 项目请求 docx 导出 → 400 project_type_mismatch", async () => {
    const { meta } = await createProject("ppt", "错台项目");
    const res = await app.request(`/api/projects/${meta.id}/export/docx`, { method: "POST" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_type_mismatch");
  });

  it("未知项目 → 404", async () => {
    const res = await app.request(
      "/api/projects/00000000-0000-0000-0000-000000000000/export/docx",
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });

  it("非法 ID → 400", async () => {
    const res = await app.request("/api/projects/not-a-uuid/export/docx", { method: "POST" });
    expect(res.status).toBe(400);
  });
});

describe("exportDocx 防御性输入", () => {
  it("坏形状（section 引用不存在的块）→ WordExportError 明确报错不崩", async () => {
    const doc = sampleDoc();
    (doc.sections[0] as { blockIds: string[] }).blockIds = ["missing-block"];
    await expect(exportDocx(doc)).rejects.toBeInstanceOf(WordExportError);
  });

  it("sections 非数组 → WordExportError", async () => {
    const doc = sampleDoc();
    (doc as unknown as { sections: unknown }).sections = "not-an-array";
    await expect(exportDocx(doc)).rejects.toBeInstanceOf(WordExportError);
  });
});

/**
 * XML-detail regression contract for the exporter (test-only by design):
 * - run direct color/size -> w:color / w:sz(+w:szCs) half-points;
 * - Normal style never basedOn itself;
 * - multi-section body: every intermediate sectPr sits inside w:p/w:pPr,
 *   only the last one is a direct child of w:body;
 * - style defs carry w:rFonts (first family of the font list + eastAsia);
 * - w:t gets xml:space="preserve" only when text has edge spaces.
 */
describe("DOCX 导出 XML 细节回归", () => {
  async function unzipPart(buffer: Buffer, part: string): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);
    return (await zip.file(part)?.async("string")) ?? "";
  }

  async function exportParts(doc: WordDocument) {
    const buffer = await exportDocx(doc);
    return {
      documentXml: await unzipPart(buffer, "word/document.xml"),
      stylesXml: await unzipPart(buffer, "word/styles.xml"),
    };
  }

  function replaceRuns(doc: WordDocument, blockId: string, runs: Run[]): void {
    const block = doc.blocks.find((candidate) => candidate.id === blockId);
    if (!block || block.type !== "paragraph") {
      throw new Error(`test setup: paragraph block "${blockId}" not found`);
    }
    block.runs = runs;
  }

  /** Two sections reusing sampleDoc blocks (unreferenced blocks stay legal). */
  function multiSectionDoc(): WordDocument {
    const doc = sampleDoc();
    doc.sections = [
      { id: "section-1", blockIds: ["h1", "p1"] },
      { id: "section-2", blockIds: ["h2", "list1"] },
    ];
    return doc;
  }

  it("run 直接 color 输出 w:color（十六进制去掉 #）", async () => {
    const doc = sampleDoc();
    replaceRuns(doc, "p1", [{ text: "彩色文字", color: "#E11D48" }]);
    const { documentXml } = await exportParts(doc);
    expect(documentXml).toContain('<w:color w:val="E11D48"/>');
    expect(documentXml).not.toContain('w:val="#E11D48"');
  });

  it("run size 输出 w:sz/w:szCs 半点值（Normal 11pt->22，Heading1 18pt->36）", async () => {
    const { documentXml } = await exportParts(sampleDoc());
    expect(documentXml).toContain('<w:sz w:val="22"/>');
    expect(documentXml).toContain('<w:szCs w:val="22"/>');
    expect(documentXml).toContain('<w:sz w:val="36"/>');
  });

  it("run 直接 size 优先于解析样式（14pt -> 28 半点）", async () => {
    const doc = sampleDoc();
    replaceRuns(doc, "p1", [{ text: "直接字号", size: 14 }]);
    const { documentXml } = await exportParts(doc);
    expect(documentXml).toContain('<w:sz w:val="28"/>');
  });

  it("多 section：中间 sectPr 位于 w:p/w:pPr 内，末尾 sectPr 直属 body", async () => {
    const { documentXml } = await exportParts(multiSectionDoc());
    expect((documentXml.match(/<w:sectPr>/g) ?? []).length).toBe(2);
    expect((documentXml.match(/<w:pPr><w:sectPr>/g) ?? []).length).toBe(1);
    expect(documentXml.endsWith("</w:sectPr></w:body></w:document>")).toBe(true);
    // both sections keep the A4 page size (595.3pt -> 11906 twips)
    expect((documentXml.match(/w:w="11906"/g) ?? []).length).toBe(2);
  });

  it("样式定义输出 w:rFonts：字体族取首名，eastAsia 固定兜底", async () => {
    const { stylesXml } = await exportParts(sampleDoc());
    expect(stylesXml).toContain(
      '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="微软雅黑"/>',
    );
    // Normal + Heading1-3 style defs all carry rFonts
    expect((stylesXml.match(/<w:rFonts /g) ?? []).length).toBe(4);
  });

  it("Normal 样式不自引用 basedOn；Heading 样式 basedOn Normal", async () => {
    const { stylesXml } = await exportParts(sampleDoc());
    const normalStart = stylesXml.indexOf('w:styleId="Normal"');
    const normalDef = stylesXml.slice(normalStart, stylesXml.indexOf("</w:style>", normalStart));
    expect(normalDef).not.toContain("w:basedOn");
    expect(stylesXml).toContain('<w:basedOn w:val="Normal"/>');
  });

  it("文本首尾带空格时 w:t 加 xml:space=preserve，普通文本不加", async () => {
    const doc = sampleDoc();
    replaceRuns(doc, "p1", [{ text: " 两端空格 " }]);
    const { documentXml } = await exportParts(doc);
    expect(documentXml).toContain('<w:t xml:space="preserve"> 两端空格 </w:t>');

    const plain = await exportParts(sampleDoc());
    expect(plain.documentXml).toContain("<w:t>这是导出测试正文。</w:t>");
  });
});
