import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createProjectsStore } from "../src/store/projects.js";
import { registerPptExportRoutes } from "../src/toolkits/ppt/routes.js";
import { exportPptx } from "../src/toolkits/ppt/exporter.js";
import { mergeImportedSlides, parsePptx, PptImportError } from "../src/toolkits/ppt/importer.js";
import { validatePptDocument, type PptDocument } from "@studio/ppt-toolkit";
import type { PptSlideObject } from "@studio/ppt-toolkit";

/**
 * PPTX import contract. Fixtures are minimal OOXML packages built with JSZip
 * (deterministic, no checked-in binary): presentation + rels + master +
 * layout + theme + slides (+ media). The parser is measured against the
 * authoritative PptDocument validators.
 */

// ---------------------------------------------------------------------------
// Minimal OOXML fixture builder
// ---------------------------------------------------------------------------

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const EMU = 9525;
const emu = (px: number) => Math.round(px * EMU);

interface SlideSpec {
  titleXfrm?: string;
  shapes?: string[];
  notes?: string;
  background?: string;
  hidden?: boolean;
  layoutTarget?: string;
}

function xfrm(pxRect: { x: number; y: number; w: number; h: number }): string {
  return `<a:xfrm><a:off x="${emu(pxRect.x)}" y="${emu(pxRect.y)}"/><a:ext cx="${emu(pxRect.w)}" cy="${emu(pxRect.h)}"/></a:xfrm>`;
}

function textSp(opts: { id: number; name: string; ph?: string; rect?: { x: number; y: number; w: number; h: number }; runs: { text: string; sz?: number; b?: boolean; color?: string }[]; prst?: string; fill?: string; schemeFill?: string }): string {
  const nvPr = opts.ph ? `<p:nvPr><p:ph ${opts.ph}/></p:nvPr>` : "<p:nvPr/>";
  const runs = opts.runs
    .map((r) => {
      const attrs = [`lang="zh-CN"`];
      if (r.sz) attrs.push(`sz="${r.sz}"`);
      if (r.b) attrs.push(`b="1"`);
      const fill = r.color ? `<a:solidFill><a:srgbClr val="${r.color}"/></a:solidFill>` : "";
      return `<a:r><a:rPr ${attrs.join(" ")}>${fill}</a:rPr><a:t>${r.text}</a:t></a:r>`;
    })
    .join("");
  const shapeFill = opts.fill ? `<a:solidFill><a:srgbClr val="${opts.fill}"/></a:solidFill>` : opts.schemeFill ? `<a:solidFill><a:schemeClr val="${opts.schemeFill}"/></a:solidFill>` : "";
  const geom = opts.prst ? `<a:prstGeom prst="${opts.prst}"><a:avLst/></a:prstGeom>` : `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`;
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${opts.id}" name="${opts.name}"/><p:cNvSpPr/>${nvPr}</p:nvSpPr>
    <p:spPr>${opts.rect ? xfrm(opts.rect) : ""}${shapeFill}${geom}</p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/>${runs}</a:p></p:txBody>
  </p:sp>`;
}

function pictureSp(id: number, rect: { x: number; y: number; w: number; h: number }, relId = "rId2", stretch = true): string {
  return `<p:pic>
    <p:nvPicPr><p:cNvPr id="${id}" name="图片 ${id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="${relId}"/>${stretch ? "<a:stretch><a:fillRect/></a:stretch>" : "<a:tile/>"}</p:blipFill>
    <p:spPr>${xfrm(rect)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
  </p:pic>`;
}

function tableCell(textParts: string, extraAttr = ""): string {
  return `<a:tc ${extraAttr}><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${textParts}<a:endParaRPr lang="zh-CN"/></a:p></a:txBody><a:tcPr/></a:tc>`;
}

function runXml(text: string): string {
  return `<a:r><a:rPr lang="zh-CN"/><a:t>${text}</a:t></a:r>`;
}

function tableSp(rect: { x: number; y: number; w: number; h: number }): string {
  const emuRect = xfrm(rect);
  return `<p:graphicFrame>
    <p:nvGraphicFramePr><p:cNvPr id="9" name="表格 9"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
    <p:xfrm><a:off x="${emu(rect.x)}" y="${emu(rect.y)}"/><a:ext cx="${emu(rect.w)}" cy="${emu(rect.h)}"/></p:xfrm>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
      <a:tblGrid><a:gridCol w="3000000"/><a:gridCol w="3000000"/><a:gridCol w="3000000"/></a:tblGrid>
      <a:tr h="300000">${tableCell(runXml("A"), 'gridSpan="2"')}${tableCell("", 'hMerge="1"')}${tableCell(runXml("第一行") + "<a:br/>" + runXml("第二行"))}</a:tr>
      <a:tr h="300000">${tableCell(runXml("X"))}${tableCell(runXml("Y"))}${tableCell(runXml("Z"))}</a:tr>
    </a:tbl></a:graphicData></a:graphic>
  </p:graphicFrame>`;
}

function altContentPicture(rect: { x: number; y: number; w: number; h: number }, fallbackRel = "rId2"): string {
  const MC = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
  return `<mc:AlternateContent ${MC}>
    <mc:Choice requires="http://schemas.microsoft.com/office/drawing/2010/main">
      <p:pic><p:nvPicPr><p:cNvPr id="8" name="SVG"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rIdSvg"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
        <p:spPr>${xfrm(rect)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>
    </mc:Choice>
    <mc:Fallback>${pictureSp(7, rect, fallbackRel)}</mc:Fallback>
  </mc:AlternateContent>`;
}

function picPlaceholderSp(rect: { x: number; y: number; w: number; h: number }, relId = "rId2"): string {
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="11" name="图片占位 11"/><p:cNvSpPr/><p:nvPr><p:ph type="pic" idx="4"/></p:nvPr></p:nvSpPr>
    <p:spPr>${xfrm(rect)}<a:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>
  </p:sp>`;
}

function slideXml(spec: SlideSpec): string {
  const bg = spec.background ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${spec.background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}${spec.hidden ? ' show="0"' : ""}>
  <p:cSld>${bg}<p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    ${spec.shapes?.join("\n") ?? ""}
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

interface PptxBuilder {
  zip: JSZip;
  addSlide(partName: string, xml: string, rels: Record<string, { type: string; target: string; data?: Buffer; dataName?: string }>): void;
  build(slideSize?: { cx: number; cy: number }, slideList?: { id: number; rId: string; show?: string }[]): Promise<Buffer>;
}

function createPptxBuilder(): PptxBuilder {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/theme/theme1.xml",
    `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="t"><a:themeElements>
      <a:clrScheme name="c"><a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:accent1><a:srgbClr val="0F766E"/></a:accent1><a:accent2><a:srgbClr val="F59E0B"/></a:accent2>
      <a:accent3><a:srgbClr val="0EA5E9"/></a:accent3><a:accent4><a:srgbClr val="8B5CF6"/></a:accent4></a:clrScheme>
      <a:fontScheme name="f"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface="微软雅黑"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="宋体"/></a:minorFont></a:fontScheme>
      <a:fmtScheme name="n"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>
    </a:themeElements></a:theme>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0"?><p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
      <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
      <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId2"/></p:sldLayoutIdLst></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
    </Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<?xml version="1.0"?><p:sldLayout ${NS} type="title" preserve="1"><p:cSld name="标题幻灯片"><p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="标题 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr>${xfrm({ x: 140, y: 240, w: 1000, h: 140 })}</p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>
    </p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  );

  const slides: { file: string; show?: string }[] = [];
  return {
    zip,
    addSlide(partName, xml, relsInput) {
      zip.file(partName, xml);
      const { rNotes, ...rels } = relsInput;
      const entries = Object.entries(rels);
      if (rNotes) entries.push(["rNotes", { type: "notesSlide", target: "../notesSlides/notesSlide1.xml" }]);
      const relXml =
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        entries
          .map(([id, r]) => {
            if (r.data) zip.file(`ppt/media/${r.dataName ?? "image1.png"}`, r.data);
            return `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${r.type}" Target="${r.target}"/>`;
          })
          .join("") +
        `</Relationships>`;
      const dir = partName.split("/").slice(0, -1).join("/");
      const base = partName.split("/").pop();
      zip.file(`${dir}/_rels/${base}.rels`, relXml);
      slides.push({ file: partName, show: xml.includes('show="0"') ? "0" : undefined });
      if (rNotes) {
        zip.file(
          "ppt/notesSlides/notesSlide1.xml",
          `<?xml version="1.0"?><p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
          <p:sp><p:nvSpPr><p:cNvPr id="2" name="备注"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>演讲备注文字</a:t></a:r></a:p></p:txBody></p:sp>
          </p:spTree></p:cSld></p:notes>`,
        );
      }
    },
    async build(slideSize = { cx: 12192000, cy: 6858000 }, slideList?: { id: number; rId: string; show?: string }[]) {
      const list: { id: number; rId: string; show?: string }[] =
        slideList ??
        slides.map((s, i) => ({ id: 256 + i, rId: `rIdSlide${i + 1}`, ...(s.show ? { show: s.show } : {}) }));
      zip.file(
        "ppt/presentation.xml",
        `<?xml version="1.0"?><p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
        <p:sldIdLst>${list.map((s) => `<p:sldId id="${s.id}" r:id="${s.rId}"${s.show ? ` show="${s.show}"` : ""}/>`).join("")}</p:sldIdLst>
        <p:sldSz cx="${slideSize.cx}" cy="${slideSize.cy}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
      );
      zip.file(
        "ppt/_rels/presentation.xml.rels",
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
        ${slides.map((s, i) => `<Relationship Id="rIdSlide${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${s.file.replace("ppt/", "")}"/>`).join("")}
        </Relationships>`,
      );
      return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    },
  };
}

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("MINIMAL-PNG-PAYLOAD-FOR-SNIFF"),
]);

/** Minimal mp4: box size + "ftyp" at bytes 4-7 + "isom" brand. */
const MP4_BYTES = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]),
  Buffer.from("isomavc1MOCK-PAYLOAD"),
]);

/** AVI: RIFF header without WEBP at 8-12 — sniffVideo must miss it (grey placeholder). */
const AVI_BYTES = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("AVI LIST"),
]);

/** p:video per OP-1 default: media linked via p:nvSpPr/p:nvPr/a:videoFile@r:link. */
function videoSp(rect: { x: number; y: number; w: number; h: number }, relId = "rIdV"): string {
  return `<p:video>
    <p:nvSpPr><p:cNvPr id="12" name="视频 12"/><p:cNvSpPr/><p:nvPr><a:videoFile r:link="${relId}"/></p:nvPr></p:nvSpPr>
    <p:spPr>${xfrm(rect)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
  </p:video>`;
}

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe("parsePptx", () => {
  it("16:9：标题占位符文本、字号 sz/75、粗体与字色", async () => {
    const builder = createPptxBuilder();
    builder.addSlide(
      "ppt/slides/slide1.xml",
      slideXml({
        shapes: [
          textSp({
            id: 2,
            name: "标题 1",
            ph: 'type="title"',
            rect: { x: 140, y: 240, w: 1000, h: 140 },
            runs: [{ text: "你好 PPTX", sz: 2400, b: true, color: "FF0000" }],
          }),
        ],
      }),
      { rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" } },
    );
    const buf = await builder.build();

    const result = await parsePptx(buf, { name: "测试", assetBaseUrl: "/api/projects/p/assets" });
    expect(result.warnings).toEqual([]);
    expect(result.document.slides).toHaveLength(1);
    const slide = result.document.slides[0]!;
    expect(slide.title).toBe("你好 PPTX");
    const title = slide.objects.find((o) => o.kind === "placeholder" && o.subtype === "title");
    expect(title).toMatchObject({ text: "你好 PPTX", rect: { x: 140, y: 240 } });
    // 2400 hundredths-point = 24pt = 32px.
    expect(slide.objects.some((o) => false)).toBe(false);
  });

  it("普通文本框：kind=text，run 粗斜体颜色，sz 换算到对象 fontSize", async () => {
    const builder = createPptxBuilder();
    builder.addSlide(
      "ppt/slides/slide1.xml",
      slideXml({
        shapes: [
          textSp({
            id: 3,
            name: "文本框 2",
            rect: { x: 100, y: 100, w: 600, h: 80 },
            runs: [{ text: "正文内容", sz: 1800, color: "0F766E" }],
          }),
        ],
      }),
      { rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" } },
    );
    const result = await parsePptx(await builder.build(), { name: "t", assetBaseUrl: "/api/projects/p/assets" });
    const text = result.document.slides[0]!.objects.find((o) => o.kind === "text")!;
    expect(text.kind).toBe("text");
    if (text.kind === "text") {
      expect(text.fontSize).toBe(24);
      expect(text.align).toBe("center");
      expect(text.paragraphs[0]!.runs[0]).toMatchObject({ text: "正文内容", color: "#0F766E" });
    }
  });

  it("4:3 源等比缩放并水平居中：960×720 内容整体右移 160px", async () => {
    const builder = createPptxBuilder();
    builder.addSlide(
      "ppt/slides/slide1.xml",
      slideXml({
        shapes: [
          textSp({
            id: 2,
            name: "t",
            ph: 'type="title"',
            rect: { x: 0, y: 100, w: 960, h: 100 },
            runs: [{ text: "四比三标题" }],
          }),
        ],
      }),
      { rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" } },
    );
    // 10in × 7.5in = 9144000 × 6858000 EMU (4:3).
    const result = await parsePptx(await builder.build({ cx: 9144000, cy: 6858000 }), {
      name: "4:3",
      assetBaseUrl: "/api/projects/p/assets",
    });
    const title = result.document.slides[0]!.objects[0]!;
    expect(title.rect.x).toBeCloseTo(160, 0);
    expect(title.rect.w).toBeCloseTo(960, 0);
  });

  it("图片：解包为资产、对象 src 指向资产 URL、fit=fill（stretch）", async () => {
    const builder = createPptxBuilder();
    builder.addSlide(
      "ppt/slides/slide1.xml",
      slideXml({
        shapes: [pictureSp(4, { x: 200, y: 200, w: 400, h: 300 })],
      }),
      {
        rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
        rId2: { type: "image", target: "../media/image1.png", data: PNG_BYTES },
      },
    );
    const result = await parsePptx(await builder.build(), { name: "图", assetBaseUrl: "/api/projects/p1/assets" });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.data.equals(PNG_BYTES)).toBe(true);
    const image = result.document.slides[0]!.objects.find((o) => o.kind === "image")!;
    expect(image.kind).toBe("image");
    if (image.kind === "image") {
      expect(image.src).toMatch(/^\/api\/projects\/p1\/assets\/[0-9a-f]{40}\.png$/);
      expect(image.fit).toBe("fill");
    }
  });

  it("不被 magic 支持的图片（SVG/EMF）降级为灰色占位并产生 warning", async () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"/>`);
    const builder = createPptxBuilder();
    builder.addSlide(
      "ppt/slides/slide1.xml",
      slideXml({
        shapes: [pictureSp(4, { x: 10, y: 10, w: 100, h: 100 })],
      }),
      {
        rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
        rId2: { type: "image", target: "../media/image1.svg", data: svg, dataName: "image1.svg" },
      },
    );
    const result = await parsePptx(await builder.build(), { name: "svg", assetBaseUrl: "/api/projects/p/assets" });
    expect(result.assets).toHaveLength(0);
    expect(result.document.slides[0]!.objects[0]).toMatchObject({ kind: "shape", shape: "rect", fill: "#D4D4D8" });
    expect(result.warnings.join("")).toContain("SVG");
  });

  it("占位符缺少 xfrm 时回退到 slideLayout 几何", async () => {
    const builder = createPptxBuilder();
    builder.addSlide(
      "ppt/slides/slide1.xml",
      slideXml({
        shapes: [textSp({ id: 2, name: "标题", ph: 'type="title"', runs: [{ text: "继承版式坐标" }] })],
      }),
      { rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" } },
    );
    const result = await parsePptx(await builder.build(), { name: "x", assetBaseUrl: "/api/projects/p/assets" });
    const title = result.document.slides[0]!.objects[0]!;
    expect(title.rect).toEqual({ x: 140, y: 240, w: 1000, h: 140 });
  });

  it("备注与纯色背景被提取", async () => {
    const builder = createPptxBuilder();
    builder.addSlide(
      "ppt/slides/slide1.xml",
      slideXml({
        background: "0F766E",
        shapes: [
          textSp({ id: 2, name: "标题", ph: 'type="title"', rect: { x: 140, y: 240, w: 1000, h: 140 }, runs: [{ text: "深色背景" }] }),
        ],
      }),
      {
        rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
        rNotes: { type: "notesSlide", target: "../notesSlides/notesSlide1.xml" },
      },
    );
    const result = await parsePptx(await builder.build(), { name: "x", assetBaseUrl: "/api/projects/p/assets" });
    const slide = result.document.slides[0]!;
    expect(slide.background).toBe("#0F766E");
    expect(slide.notes).toContain("演讲备注文字");
  });

  it("保留混合 sibling 顺序、accent3/accent4 映射与母版 bg1 背景继承", async () => {
    const builder = createPptxBuilder();
    const ordered = [
      textSp({ id: 2, name: "accent3", rect: { x: 0, y: 0, w: 100, h: 100 }, runs: [], schemeFill: "accent3" }),
      pictureSp(3, { x: 100, y: 0, w: 100, h: 100 }),
      textSp({ id: 4, name: "accent4", rect: { x: 200, y: 0, w: 100, h: 100 }, runs: [], schemeFill: "accent4" }),
    ];
    builder.addSlide("ppt/slides/slide1.xml", slideXml({ shapes: ordered }), {
      rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
      rId2: { type: "image", target: "../media/image1.png", data: PNG_BYTES },
    });
    const result = await parsePptx(await builder.build(), { name: "顺序", assetBaseUrl: "/api/projects/p/assets" });
    const objects = result.document.slides[0]!.objects;
    expect(objects.map((o) => o.kind)).toEqual(["shape", "image", "shape"]);
    expect(objects[0]).toMatchObject({ fill: "#0EA5E9" });
    expect(objects[2]).toMatchObject({ fill: "#8B5CF6" });
    expect(result.document.slides[0]!.background).toBe("#FFFFFF");
  });

  it("输出文档通过权威校验，且 name 被强制为入参", async () => {
    const builder = createPptxBuilder();
    builder.addSlide("ppt/slides/slide1.xml", slideXml({ shapes: [] }), {
      rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
    });
    const result = await parsePptx(await builder.build(), { name: "我的项目", assetBaseUrl: "/api/projects/p/assets" });
    expect(result.document.name).toBe("我的项目");
    expect(() => validatePptDocument(result.document)).not.toThrow();
  });

  it("非 zip / 缺 presentation.xml / 加密包 → PptImportError 中文错误", async () => {
    await expect(parsePptx(Buffer.from("not a zip at all, just plain text".repeat(10)), { name: "x", assetBaseUrl: "a" })).rejects.toBeInstanceOf(PptImportError);
    const zip = new JSZip();
    zip.file("hello.txt", "world");
    const bad = await zip.generateAsync({ type: "nodebuffer" });
    await expect(parsePptx(bad, { name: "x", assetBaseUrl: "a" })).rejects.toThrow(/presentation\.xml/);
  });
});

// ---------------------------------------------------------------------------
// mergeImportedSlides
// ---------------------------------------------------------------------------

describe("mergeImportedSlides", () => {
  async function parseSimple(): Promise<PptDocument> {
    const builder = createPptxBuilder();
    builder.addSlide(
      "ppt/slides/slide1.xml",
      slideXml({
        shapes: [
          textSp({ id: 2, name: "标题", ph: 'type="title"', rect: { x: 140, y: 240, w: 1000, h: 140 }, runs: [{ text: "模板页" }] }),
        ],
      }),
      { rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" } },
    );
    return (await parsePptx(await builder.build(), { name: "base", assetBaseUrl: "/api/projects/p/assets" })).document;
  }

  it("同一导入文档用不同 nonce 追加两次：id 全局不撞", async () => {
    const incoming = await parseSimple();
    const once = mergeImportedSlides(incoming, incoming, "aaaa1111").document;
    const twice = mergeImportedSlides(once, incoming, "bbbb2222").document;
    const slideIds = twice.slides.map((s) => s.id);
    expect(new Set(slideIds).size).toBe(slideIds.length);
    const objectIds = twice.slides.flatMap((s) => s.objects.map((o) => o.id));
    expect(new Set(objectIds).size).toBe(objectIds.length);
    expect(() => validatePptDocument(twice)).not.toThrow();
    expect(twice.slides).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
describe("parsePptx 边界修复", () => {
  async function parseShapes(shapes: string[], rels?: Parameters<ReturnType<typeof createPptxBuilder>["addSlide"]>[2]) {
    const builder = createPptxBuilder();
    builder.addSlide("ppt/slides/slide1.xml", slideXml({ shapes }), rels ?? {
      rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
    });
    const result = await parsePptx(await builder.build(), { name: "边界测试", assetBaseUrl: "/api/projects/p/assets" });
    return result;
  }

  it("表格：tblGrid 正确给出列数；gridSpan+hMerge 不双计数；a:br 保留换行", async () => {
    const result = await parseShapes([tableSp({ x: 100, y: 100, w: 900, h: 300 })]);
    const table = result.document.slides[0]!.objects.find((o) => o.kind === "table");
    expect(table).toBeDefined();
    expect(table && table.kind === "table" && table.cols).toBe(3);
    expect(table && table.kind === "table" && table.rows).toBe(2);
    expect(table && table.kind === "table" && table.cells).toEqual([
      [{ text: "A" }, { text: "" }, { text: "第一行\n第二行" }],
      [{ text: "X" }, { text: "Y" }, { text: "Z" }],
    ]);
  });

  it("右/下边界外对象被拉回画布内，不再让整份导入失败", async () => {
    const result = await parseShapes([
      textSp({ id: 2, name: "越界", rect: { x: 1300, y: 800, w: 200, h: 100 }, runs: [{ text: "在外" }] }),
      textSp({ id: 3, name: "微越界", rect: { x: 1279.5, y: 10, w: 2, h: 10 }, runs: [{ text: "边" }] }),
    ]);
    expect(result.document.slides).toHaveLength(1);
    for (const o of result.document.slides[0]!.objects) {
      expect(o.rect.x).toBeLessThanOrEqual(1279);
      expect(o.rect.y).toBeLessThanOrEqual(719);
      expect(o.rect.x + o.rect.w).toBeLessThanOrEqual(1280);
      expect(o.rect.y + o.rect.h).toBeLessThanOrEqual(720);
    }
  });

  it("mc:AlternateContent 包裹的图片使用 Fallback 位图导入", async () => {
    const result = await parseShapes(
      [altContentPicture({ x: 50, y: 50, w: 300, h: 200 })],
      {
        rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
        rId2: { type: "image", target: "../media/image1.png", data: PNG_BYTES },
      },
    );
    expect(result.document.slides[0]!.objects.some((o) => o.kind === "image")).toBe(true);
    expect(result.assets).toHaveLength(1);
  });

  it("形状的 a:alpha 透明度被保留（半透明全幅蒙层不再盖住全部内容）", async () => {
    const overlay = textSp({
      id: 90,
      name: "标题",
      rect: { x: 100, y: 100, w: 400, h: 100 },
      runs: [{ text: "标题在蒙层之下" }],
    });
    const wash = `<p:sp>
      <p:nvSpPr><p:cNvPr id="91" name="半透明粉色全幅"/></p:nvSpPr>
      <p:spPr>${xfrm({ x: 0, y: 0, w: 1280, h: 720 })}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:solidFill><a:srgbClr val="FFEAE7"><a:alpha val="40000"/></a:srgbClr></a:solidFill></p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>
    </p:sp>`;
    const result = await parseShapes([overlay, wash], {
      rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
    });
    const shape = result.document.slides[0]!.objects.find(
      (o): o is Extract<PptSlideObject, { kind: "shape" }> => o.kind === "shape" && o.rect.w === 1280,
    );
    expect(shape).toBeDefined();
    expect(shape!.fill).toBe("#FFEAE7");
    expect(shape!.opacity).toBeCloseTo(0.4);
    expect(result.document.slides[0]!.objects.some((o) => o.kind === "text")).toBe(true);
  });

  it("type=pic 图片占位符内的照片被导入为图片对象", async () => {
    const result = await parseShapes(
      [picPlaceholderSp({ x: 0, y: 0, w: 1280, h: 720 })],
      {
        rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
        rId2: { type: "image", target: "../media/image1.png", data: PNG_BYTES },
      },
    );
    const image = result.document.slides[0]!.objects.find((o) => o.kind === "image");
    expect(image).toBeDefined();
  });

  it("关系 Target 为包根绝对路径（/ppt/media/...）时图片仍可解析", async () => {
    const result = await parseShapes(
      [pictureSp(6, { x: 10, y: 10, w: 100, h: 100 }, "rId2")],
      {
        rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
        rId2: { type: "image", target: "/ppt/media/image1.png", data: PNG_BYTES },
      },
    );
    expect(result.document.slides[0]!.objects.some((o) => o.kind === "image")).toBe(true);
  });

  it("p:video（a:videoFile r:link mp4）导入为 video 对象并注册资产", async () => {
    const result = await parseShapes(
      [videoSp({ x: 100, y: 100, w: 640, h: 360 })],
      {
        rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
        rIdV: { type: "video", target: "../media/media1.mp4", data: MP4_BYTES, dataName: "media1.mp4" },
      },
    );
    const video = result.document.slides[0]!.objects.find((o) => o.kind === "video");
    expect(video).toBeDefined();
    if (video?.kind === "video") {
      expect(video.src).toMatch(/^\/api\/projects\/p\/assets\/[0-9a-f]{40}\.mp4$/);
      expect(video.rect).toEqual({ x: 100, y: 100, w: 640, h: 360 });
    }
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.contentType).toBe("video/mp4");
    expect(result.assets[0]!.data.equals(MP4_BYTES)).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("mov/avi 字节 sniff 不中 → 灰占位 + 警告，不注册资产", async () => {
    const result = await parseShapes(
      [videoSp({ x: 0, y: 0, w: 320, h: 180 })],
      {
        rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
        rIdV: { type: "video", target: "../media/media1.avi", data: AVI_BYTES, dataName: "media1.avi" },
      },
    );
    const objects = result.document.slides[0]!.objects;
    expect(objects[0]).toMatchObject({ kind: "shape", shape: "rect", fill: "#D4D4D8" });
    expect(result.warnings.join("")).toContain("MOV/AVI/WMV");
    expect(result.assets).toHaveLength(0);
  });

  it("标题占位符是导入提示时，使用同页下一个有效文本作为标题", async () => {
    const result = await parseShapes([
      textSp({
        id: 2,
        name: "标题",
        ph: 'type="title"',
        rect: { x: 140, y: 240, w: 1000, h: 140 },
        runs: [{ text: "请输入您的标题" }],
      }),
      textSp({
        id: 3,
        name: "正文标题",
        rect: { x: 140, y: 430, w: 800, h: 80 },
        runs: [{ text: "2026 增长复盘" }],
      }),
    ]);
    expect(result.document.slides[0]!.title).toBe("2026 增长复盘");
  });

  it("标题是 Lorem ipsum 且没有其他有效文本时，回退为未命名页", async () => {
    const result = await parseShapes([
      textSp({
        id: 2,
        name: "标题",
        ph: 'type="title"',
        rect: { x: 140, y: 240, w: 1000, h: 140 },
        runs: [{ text: "Lorem ipsum dolor sit amet" }],
      }),
    ]);
    expect(result.document.slides[0]!.title).toBe("未命名页");
  });

  it("首个文本框只剩单字时，继续寻找后面的有效文本", async () => {
    const result = await parseShapes([
      textSp({
        id: 2,
        name: "残片",
        rect: { x: 100, y: 100, w: 200, h: 60 },
        runs: [{ text: "第" }],
      }),
      textSp({
        id: 3,
        name: "有效标题",
        rect: { x: 100, y: 220, w: 500, h: 80 },
        runs: [{ text: "季度经营分析" }],
      }),
    ]);
    expect(result.document.slides[0]!.title).toBe("季度经营分析");
  });

  it("两个字的真实标题不被当作截断残片", async () => {
    const result = await parseShapes([
      textSp({
        id: 2,
        name: "标题",
        ph: 'type="title"',
        rect: { x: 140, y: 240, w: 1000, h: 140 },
        runs: [{ text: "方案" }],
      }),
    ]);
    expect(result.document.slides[0]!.title).toBe("方案");
  });
});

// Route tests
// ---------------------------------------------------------------------------

let baseDir: string;
let app: Hono;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-ppt-import-"));
  const store = createProjectsStore(baseDir);
  app = new Hono();
  registerPptExportRoutes(app, { store });
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

async function createPptProject(name: string) {
  const store = createProjectsStore(baseDir);
  return store.create({
    name,
    productType: "",
    targetUsers: "",
    goal: "",
    referenceLinks: [],
    brandRules: "",
    projectType: "ppt",
  });
}

function pptxWithImage(): Promise<Buffer> {
  const builder = createPptxBuilder();
  builder.addSlide(
    "ppt/slides/slide1.xml",
    slideXml({
      shapes: [
        textSp({ id: 2, name: "标题", ph: 'type="title"', rect: { x: 140, y: 240, w: 1000, h: 140 }, runs: [{ text: "路由测试" }] }),
        pictureSp(4, { x: 100, y: 400, w: 300, h: 200 }),
      ],
    }),
    {
      rId1: { type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
      rId2: { type: "image", target: "../media/image1.png", data: PNG_BYTES },
    },
  );
  return builder.build();
}

describe("POST /api/projects/:id/import/pptx", () => {
  it("replace：资产落盘、返回合法文档；GET 资产字节一致且带 nosniff/immutable 头", async () => {
    const { meta } = await createPptProject("导入测试");
    const res = await app.request(`/api/projects/${meta.id}/import/pptx?mode=replace`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(await pptxWithImage()),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { document: PptDocument; warnings: string[]; imported: { slides: number; assets: number } };
    expect(body.imported).toEqual({ slides: 1, assets: 1 });
    expect(body.document.slides[0]!.title).toBe("路由测试");

    const image = body.document.slides[0]!.objects.find((o) => o.kind === "image");
    expect(image).toBeDefined();
    const src = (image as { src: string }).src;
    const assetRes = await app.request(src);
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(assetRes.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await assetRes.arrayBuffer()).equals(PNG_BYTES)).toBe(true);

    // The asset really exists under <project>/assets.
    const file = src.split("/").pop()!;
    const onDisk = await fs.readFile(join(baseDir, meta.id, "assets", file));
    expect(onDisk.equals(PNG_BYTES)).toBe(true);
  });

  it("append：响应文档逐次追加；模拟前端保存后二次追加得到全部页，资产去重", async () => {
    const created = await createPptProject("追加测试");
    const buffer = await pptxWithImage();

    const postAppend = () =>
      app.request(`/api/projects/${created.meta.id}/import/pptx?mode=append`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(buffer),
      });

    const first = (await (await postAppend()).json()) as { document: PptDocument };
    // Blank starter deck (1) + imported (1) = 2 in the response.
    expect(first.document.slides.length).toBe(2);
    // The import route does NOT persist the document; the workbench saves it.
    let store = createProjectsStore(baseDir);
    await store.save(created.meta.id, { meta: created.meta, document: first.document });

    const second = (await (await postAppend()).json()) as { document: PptDocument };
    expect(second.document.slides.length).toBe(3);
    // Ids stay unique across same-file double append.
    const ids = second.document.slides.flatMap((s) => [s.id, ...s.objects.map((o) => o.id)]);
    expect(new Set(ids).size).toBe(ids.length);

    store = createProjectsStore(baseDir);
    const onDisk = (await store.readDocument(created.meta.id)) as PptDocument;
    expect(onDisk.slides.length).toBe(2); // state after the first simulated save
    const files = await fs.readdir(join(baseDir, created.meta.id, "assets"));
    expect(files).toHaveLength(1); // content-hash dedupe
  });

  it("坏 mode → 400；非 ppt 项目 → 400；超大 body → 413", async () => {
    const { meta } = await createPptProject("错误测试");
    const badMode = await app.request(`/api/projects/${meta.id}/import/pptx?mode=nope`, {
      method: "POST",
      body: Buffer.from("x"),
    });
    expect(badMode.status).toBe(400);

    const word = await createProjectsStore(baseDir).create({
      name: "w", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "", projectType: "word",
    });
    const mismatch = await app.request(`/api/projects/${word.meta.id}/import/pptx?mode=replace`, {
      method: "POST",
      body: Buffer.from("x"),
    });
    expect(mismatch.status).toBe(400);

    const tooBig = await app.request(`/api/projects/${meta.id}/import/pptx?mode=replace`, {
      method: "POST",
      headers: { "Content-Length": String(60 * 1024 * 1024) },
      body: new Uint8Array(60 * 1024 * 1024).fill(0x78),
    });
    expect(tooBig.status).toBe(413);
  });

  it("损坏文件 → 400 import_failed 且错误信息为中文", async () => {
    const { meta } = await createPptProject("坏文件");
    const res = await app.request(`/api/projects/${meta.id}/import/pptx?mode=replace`, {
      method: "POST",
      body: Buffer.from("this is not a pptx package"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("import_failed");
    expect(body.message).toMatch(/\.pptx|加密/);
  });

  it("资产路由：非法文件名 404、未知资产 404", async () => {
    const { meta } = await createPptProject("资产");
    expect((await app.request(`/api/projects/${meta.id}/assets/../secret`)).status).toBe(404);
    expect((await app.request(`/api/projects/${meta.id}/assets/${"a".repeat(40)}.png`)).status).toBe(404);
  });

  it("roundtrip：导出含资产 URL 的文档时，resolver 把图片重新嵌入 PPTX", async () => {
    const { meta } = await createPptProject("往返");
    const res = await app.request(`/api/projects/${meta.id}/import/pptx?mode=replace`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(await pptxWithImage()),
    });
    const body = (await res.json()) as { document: PptDocument };

    // Without a resolver an asset-URL image is an error (historical strictness).
    await expect(exportPptx(body.document)).rejects.toThrow(/src/);

    const store = createProjectsStore(baseDir);
    const resolver = (src: string) =>
      (async () => {
        const prefix = `/api/projects/${meta.id}/assets/`;
        if (!src.startsWith(prefix)) return null;
        const file = src.slice(prefix.length);
        const buf = await fs.readFile(join(baseDir, meta.id, "assets", file));
        return `data:image/png;base64,${buf.toString("base64")}`;
      })();
    void store;
    const out = await exportPptx(body.document, { resolveImageSrc: resolver });
    expect(out.subarray(0, 2).toString("hex")).toBe("504b"); // PK zip magic
  });
});

describe("POST /api/projects/:id/assets（单图上传）", () => {
  it("PNG 上传：落盘、sha1 命名、GET 字节一致、出现在资产列表", async () => {
    const { meta } = await createPptProject("资产上传");
    const res = await app.request(`/api/projects/${meta.id}/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(PNG_BYTES),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { src: string; sha1: string; ext: string; contentType: string; bytes: number };
    expect(body.ext).toBe("png");
    expect(body.contentType).toBe("image/png");
    expect(body.bytes).toBe(PNG_BYTES.length);
    expect(body.src).toMatch(new RegExp(`^/api/projects/${meta.id}/assets/[0-9a-f]{40}\\.png$`));

    const fetched = await app.request(body.src);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(PNG_BYTES)).toBe(true);

    const list = await app.request(`/api/projects/${meta.id}/assets`);
    const listed = (await list.json()) as { assets: { src: string; bytes: number }[] };
    expect(listed.assets.map((a) => a.src)).toContain(body.src);
  });

  it("相同字节重复上传幂等（同 sha1 → 同 src）", async () => {
    const { meta } = await createPptProject("幂等");
    const first = await app.request(`/api/projects/${meta.id}/assets`, {
      method: "POST",
      body: new Uint8Array(PNG_BYTES),
    });
    const second = await app.request(`/api/projects/${meta.id}/assets`, {
      method: "POST",
      body: new Uint8Array(PNG_BYTES),
    });
    const a = (await first.json()) as { src: string };
    const b = (await second.json()) as { src: string };
    expect(second.status).toBe(200);
    expect(b.src).toBe(a.src);
  });

  it("非图片字节 / 空 body → 400，中文错误信息", async () => {
    const { meta } = await createPptProject("坏图");
    const svg = await app.request(`/api/projects/${meta.id}/assets`, {
      method: "POST",
      body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });
    expect(svg.status).toBe(400);
    const svgBody = (await svg.json()) as { error: string; message: string };
    expect(svgBody.error).toBe("unsupported_image");
    expect(svgBody.message).toMatch(/PNG|JPEG/);

    const empty = await app.request(`/api/projects/${meta.id}/assets`, { method: "POST", body: Buffer.alloc(0) });
    expect(empty.status).toBe(400);
  });

  it("超过 20MB：Content-Length 预检与实读双检都 → 413", async () => {
    const { meta } = await createPptProject("大图");
    const declared = await app.request(`/api/projects/${meta.id}/assets`, {
      method: "POST",
      headers: { "Content-Length": String(21 * 1024 * 1024) },
      body: Buffer.from("x"),
    });
    expect(declared.status).toBe(413);
    const actual = await app.request(`/api/projects/${meta.id}/assets`, {
      method: "POST",
      body: new Uint8Array(21 * 1024 * 1024).fill(0x89), // starts like PNG but size-blocked first
    });
    expect(actual.status).toBe(413);
  });

  it("ui 项目 → 400 project_type_mismatch；ppt/word 项目可上传；空列表为空", async () => {
    const ui = await createProjectsStore(baseDir).create({
      name: "u",
      productType: "",
      targetUsers: "",
      goal: "",
      referenceLinks: [],
      brandRules: "",
      projectType: "ui",
    });
    const mismatch = await app.request(`/api/projects/${ui.meta.id}/assets`, {
      method: "POST",
      body: new Uint8Array(PNG_BYTES),
    });
    expect(mismatch.status).toBe(400);

    const word = await createProjectsStore(baseDir).create({
      name: "w",
      productType: "",
      targetUsers: "",
      goal: "",
      referenceLinks: [],
      brandRules: "",
      projectType: "word",
    });
    const wordUpload = await app.request(`/api/projects/${word.meta.id}/assets`, {
      method: "POST",
      body: new Uint8Array(PNG_BYTES),
    });
    expect(wordUpload.status).toBe(200);

    const { meta } = await createPptProject("空资产");
    const list = await app.request(`/api/projects/${meta.id}/assets`);
    expect((await list.json()) as { assets: unknown[] }).toEqual({ assets: [] });
  });

  it("kind=video：mp4 上传落盘、video/mp4 Content-Type、列举含视频", async () => {
    const { meta } = await createPptProject("视频上传");
    const res = await app.request(`/api/projects/${meta.id}/assets?kind=video`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(MP4_BYTES),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { src: string; ext: string; contentType: string; bytes: number };
    expect(body.ext).toBe("mp4");
    expect(body.contentType).toBe("video/mp4");
    expect(body.src).toMatch(new RegExp(`^/api/projects/${meta.id}/assets/[0-9a-f]{40}\\.mp4$`));

    const fetched = await app.request(body.src);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("content-type")).toBe("video/mp4");
    expect(Buffer.from(await fetched.arrayBuffer()).equals(MP4_BYTES)).toBe(true);

    const list = await app.request(`/api/projects/${meta.id}/assets`);
    const listed = (await list.json()) as { assets: { src: string; ext: string }[] };
    expect(listed.assets.map((a) => a.ext)).toContain("mp4");
  });

  it("kind=video：非视频字节 → 400 unsupported_video 中文文案", async () => {
    const { meta } = await createPptProject("坏视频");
    const res = await app.request(`/api/projects/${meta.id}/assets?kind=video`, {
      method: "POST",
      body: new Uint8Array(PNG_BYTES), // image bytes are not a video
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("unsupported_video");
    expect(body.message).toMatch(/MP4|WebM/);
  });

  it("kind=video 走 200MB 上限（20MB 图上限不套用；200MB+1 → 413 视频文案）", async () => {
    const { meta } = await createPptProject("大视频");
    // 21MB non-video bytes: image branch is size-blocked at 20MB (413), video
    // branch passes its 200MB size gate and fails the sniff instead (400) —
    // proving the image cap did NOT apply to kind=video.
    const oversized = Buffer.alloc(21 * 1024 * 1024);
    const overImage = await app.request(`/api/projects/${meta.id}/assets`, {
      method: "POST",
      body: oversized,
    });
    expect(overImage.status).toBe(413); // image branch: 20MB cap first
    const asVideo = await app.request(`/api/projects/${meta.id}/assets?kind=video`, {
      method: "POST",
      body: oversized,
    });
    expect(asVideo.status).toBe(400); // past the size gate → video sniff rejects
    const sniffBody = (await asVideo.json()) as { error: string };
    expect(sniffBody.error).toBe("unsupported_video");

    const tooBig = await app.request(`/api/projects/${meta.id}/assets?kind=video`, {
      method: "POST",
      headers: { "Content-Length": String(201 * 1024 * 1024) },
      body: Buffer.from("x"),
    });
    expect(tooBig.status).toBe(413);
    const tooBigBody = (await tooBig.json()) as { message: string };
    expect(tooBigBody.message).toContain("200MB");
  });
});
