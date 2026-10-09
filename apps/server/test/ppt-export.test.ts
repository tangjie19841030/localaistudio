import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createProjectsStore } from "../src/store/projects.js";
import { registerPptExportRoutes } from "../src/toolkits/ppt/routes.js";
import { exportPptx, PptExportError } from "../src/toolkits/ppt/exporter.js";
import { createEmptyDeck, type PptDocument } from "@studio/ppt-toolkit";

/**
 * P9.2: PPTX export contract.
 * - POST /api/projects/:id/export/pptx on a ppt project -> PK zip with the
 *   expected slide parts and text content;
 * - non-ppt project -> 400 project_type_mismatch; unknown id -> 404;
 * - a copy lands in <project>/export/;
 * - the exporter itself throws PptExportError (never crashes) on bad shapes.
 *
 * Routes are registered on a bare Hono app because app.ts mounting is the
 * coordinator's step (parallel-task handoff); the store-backed behaviour
 * under test is identical once mounted.
 */

let baseDir: string;
let app: Hono;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-ppt-export-"));
  const store = createProjectsStore(baseDir);
  app = new Hono();
  registerPptExportRoutes(app, { store });
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

/** Two-slide deck exercising text + shape + table + chart. */
function sampleDeck(): PptDocument {
  const deck = createEmptyDeck("导出演示");
  deck.slides = [
    {
      id: "slide-1",
      title: "封面",
      notes: "演讲备注",
      objects: [
        {
          id: "obj-title",
          kind: "text",
          rect: { x: 80, y: 60, w: 800, h: 80 },
          paragraphs: [{ runs: [{ text: "季度汇报", bold: true, color: "#0F766E" }] }],
          fontSize: 32,
          align: "center",
        },
        {
          id: "obj-shape",
          kind: "shape",
          rect: { x: 100, y: 200, w: 200, h: 120 },
          shape: "round",
          fill: "#0EA5E9",
          stroke: "#0F172A",
        },
      ],
    },
    {
      id: "slide-2",
      title: "数据页",
      notes: "",
      objects: [
        {
          id: "obj-table",
          kind: "table",
          rect: { x: 60, y: 60, w: 600, h: 200 },
          rows: 2,
          cols: 2,
          cells: [
            [{ text: "指标" }, { text: "数值" }],
            [{ text: "月活" }, { text: "1,200" }],
          ],
        },
        {
          id: "obj-chart",
          kind: "chart",
          rect: { x: 60, y: 300, w: 600, h: 300 },
          chartType: "bar",
          series: [{ name: "月活", points: [{ label: "一月", value: 100 }, { label: "二月", value: 150 }] }],
        },
      ],
    },
  ];
  return deck;
}

async function saveDeck(id: string, deck: PptDocument) {
  const store = createProjectsStore(baseDir);
  const { meta } = await store.read(id);
  await store.save(id, { meta: { ...meta, name: meta.name }, document: deck });
}

describe("PPTX 导出", () => {
  it("2-slide deck 导出为合法 zip 且 slide XML 含文本", async () => {
    const { meta } = await createProject("ppt", "季度汇报项目");
    await saveDeck(meta.id, sampleDeck());

    const res = await app.request(`/api/projects/${meta.id}/export/pptx`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    // RFC 5987 extended filename carries the real (Chinese) project name.
    expect(disposition).toContain("filename*=UTF-8''");

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK"); // zip magic

    const zip = await JSZip.loadAsync(buffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string");
    const slide2 = await zip.file("ppt/slides/slide2.xml")?.async("string");
    expect(slide1).toContain("季度汇报");
    expect(slide2).toContain("月活");
    // 16:9 layout: 13.33in wide in the presentation part
    const presentation = await zip.file("ppt/presentation.xml")?.async("string");
    expect(presentation).toContain("12192000"); // 13.333in * 914400 EMU/in
  });

  it("artifact 副本落盘到 <project>/export/", async () => {
    const { meta } = await createProject("ppt", "落盘检查");
    await saveDeck(meta.id, sampleDeck());
    const res = await app.request(`/api/projects/${meta.id}/export/pptx`, { method: "POST" });
    expect(res.status).toBe(200);
    const files = await fs.readdir(join(baseDir, meta.id, "export"));
    expect(files.some((name) => name.endsWith(".pptx"))).toBe(true);
  });

  it("word 项目请求 pptx 导出 → 400 project_type_mismatch", async () => {
    const { meta } = await createProject("word", "错台项目");
    const res = await app.request(`/api/projects/${meta.id}/export/pptx`, { method: "POST" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_type_mismatch");
  });

  it("未知项目 → 404", async () => {
    const res = await app.request(
      "/api/projects/00000000-0000-0000-0000-000000000000/export/pptx",
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });

  it("非法 ID → 400", async () => {
    const res = await app.request("/api/projects/not-a-uuid/export/pptx", { method: "POST" });
    expect(res.status).toBe(400);
  });
});

describe("exportPptx 防御性输入", () => {
  it("坏形状（对象缺 rect）→ PptExportError 明确报错不崩", async () => {
    const deck = sampleDeck();
    (deck.slides[0]!.objects[0] as unknown as { rect: unknown }).rect = undefined;
    await expect(exportPptx(deck)).rejects.toBeInstanceOf(PptExportError);
  });

  it("画布尺寸不符 → PptExportError", async () => {
    const deck = sampleDeck();
    deck.slideSize = { w: 800, h: 600 } as unknown as PptDocument["slideSize"];
    await expect(exportPptx(deck)).rejects.toBeInstanceOf(PptExportError);
  });
});

describe("exportPptx video 对象（T30 插视频）", () => {
  /** Deck with one video object (data-URL or asset-URL src + optional poster). */
  function videoDeck(src: string, poster?: string): PptDocument {
    const deck = createEmptyDeck("视频导出");
    deck.slides = [
      {
        id: "slide-1",
        title: "视频页",
        notes: "",
        objects: [
          {
            id: "obj-video",
            kind: "video",
            rect: { x: 200, y: 140, w: 880, h: 495 },
            src,
            ...(poster ? { poster } : {}),
          },
        ],
      },
    ];
    return deck;
  }

  const MP4_DATA_URL = "data:video/mp4;base64,AAAAIGZ0eXBpc29t";

  it("data URL src（含 base64, 头）→ 出 buffer 不抛，slide XML 含视频 rel", async () => {
    const out = await exportPptx(videoDeck(MP4_DATA_URL));
    expect(out.subarray(0, 2).toString("ascii")).toBe("PK");
    const zip = await JSZip.loadAsync(out);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string");
    expect(slide1).toBeDefined();
    // addMedia writes a video relationship + media part into the package.
    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")?.async("string");
    expect(rels ?? "").toContain("video");
    const mediaNames = Object.keys(zip.files).filter((name) => name.startsWith("ppt/media/"));
    expect(mediaNames.length).toBeGreaterThan(0);
  });

  it("资产 URL src 经 resolver 解析为 data URL 后嵌入；poster 同步解析", async () => {
    const deck = videoDeck("/api/projects/p1/assets/abcd.mp4", "/api/projects/p1/assets/poster.png");
    const resolver = async (src: string): Promise<string | null> =>
      src.endsWith(".mp4")
        ? `data:video/mp4;base64,${Buffer.from("MOCK-MP4").toString("base64")}`
        : `data:image/png;base64,${Buffer.from("MOCK-PNG").toString("base64")}`;
    const out = await exportPptx(deck, { resolveImageSrc: resolver });
    expect(out.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("无 resolver 且 src 不可解析 → PptExportError 中文文案", async () => {
    await expect(exportPptx(videoDeck("/api/projects/p1/assets/abcd.mp4"))).rejects.toThrow(/视频对象/);
  });
});
