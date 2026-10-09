import JSZip from "jszip";

/**
 * Minimal editable-DOCX writer (P10.2 spike, deliberate dependency choice):
 * a .docx is a plain OOXML zip, and jszip is already a server dependency —
 * no heavyweight docx library is introduced. Scope of this first pass:
 * document.xml (body blocks) + styles.xml (style set) + [Content_Types].xml
 * + _rels/.rels + word/_rels/document.xml.rels, which is the smallest set
 * Word accepts as an editable document. Known simplifications (each also
 * commented at its render site in toolkits/word/exporter.ts):
 * - no numbering.xml: lists render with character prefixes
 * - no headers/footers/footnotes parts: footnote text inlined
 * - no images embedded: image blocks become caption placeholders
 *
 * All XML here is produced from primitives below; no hand-built strings from
 * callers, so escaping stays central in xmlEscape().
 */

/** XML 1.0 predefined entities for text nodes and attribute values. */
export function xmlEscape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Tiny XML element builder. Children are either strings (already-escaped
 * text) or nested nodes. Undefined attrs are skipped; the output keeps the
 * namespace prefix the caller passes (e.g. "w:p").
 */
export interface XmlNode {
  name: string;
  attrs?: Record<string, string | undefined>;
  children?: (XmlNode | string)[];
}

export function renderXml(node: XmlNode): string {
  const attrs = Object.entries(node.attrs ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => ` ${key}="${xmlEscape(value)}"`)
    .join("");
  const kids = node.children ?? [];
  if (kids.length === 0) return `<${node.name}${attrs}/>`;
  const inner = kids.map((child) => (typeof child === "string" ? child : renderXml(child))).join("");
  return `<${node.name}${attrs}>${inner}</${node.name}>`;
}

export function xmlDeclaration(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;
}

/** Part names for the .docx zip; shared between [Content_Types] and the zip. */
export interface DocxParts {
  documentXml: string;
  stylesXml: string;
}

export const DOCX_DOCUMENT_REL_ID = "rId1";
export const DOCX_STYLES_REL_ID = "rId2";

function contentTypesXml(): string {
  return xmlDeclaration(
    renderXml({
      name: "Types",
      attrs: {
        xmlns: "http://schemas.openxmlformats.org/package/2006/content-types",
      },
      children: [
        {
          name: "Default",
          attrs: {
            Extension: "rels",
            ContentType: "application/vnd.openxmlformats-package.relationships+xml",
          },
        },
        { name: "Default", attrs: { Extension: "xml", ContentType: "application/xml" } },
        {
          name: "Override",
          attrs: {
            PartName: "/word/document.xml",
            ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
          },
        },
        {
          name: "Override",
          attrs: {
            PartName: "/word/styles.xml",
            ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
          },
        },
      ],
    }),
  );
}

function rootRelsXml(): string {
  return xmlDeclaration(
    renderXml({
      name: "Relationships",
      attrs: { xmlns: "http://schemas.openxmlformats.org/package/2006/relationships" },
      children: [
        {
          name: "Relationship",
          attrs: {
            Id: "rId1",
            Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
            Target: "word/document.xml",
          },
        },
      ],
    }),
  );
}

function documentRelsXml(): string {
  const stylesRel: XmlNode = {
    name: "Relationship",
    attrs: {
      Id: DOCX_STYLES_REL_ID,
      Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
      Target: "styles.xml",
    },
  };
  return xmlDeclaration(
    renderXml({
      name: "Relationships",
      attrs: { xmlns: "http://schemas.openxmlformats.org/package/2006/relationships" },
      children: [stylesRel],
    }),
  );
}

/**
 * Assemble the final .docx buffer. Zip layout follows OPC conventions
 * ([Content_Types].xml at the root, rels in _rels/).
 */
export function packDocx(parts: DocxParts): Promise<Buffer> {  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml());
  zip.file("_rels/.rels", rootRelsXml());
  zip.file("word/_rels/document.xml.rels", documentRelsXml());
  zip.file("word/document.xml", parts.documentXml);
  zip.file("word/styles.xml", parts.stylesXml);
  return zip.generateAsync({ type: "nodebuffer" }) as Promise<Buffer>;
}
