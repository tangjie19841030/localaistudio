import {
  DOCUMENT_VERSION,
  studioDocumentSchema,
  type Page,
  type StudioDocument,
} from "./document.js";

/**
 * v1 -> v2 read-time migration (T19 §0.3). Pure functions, no IO:
 *  - docFormat: version triage by document.documentVersion (2 = v2; 1 or a
 *    v1-shaped object without the field = v1; anything else = unknown, never
 *    guessed into a downgrade).
 *  - migrateV1ToV2: wraps a v1 raw doc into a single-page v2 document. The
 *    page id is FIXED to "page-1" and the page name mirrors doc.name, so the
 *    operation is deterministic and idempotent — running it twice yields
 *    byte-identical JSON (locked by test A2).
 *  - downgradeToV1: rollback fold for single-page v2 docs; multi-page docs
 *    return null (never silently truncated).
 */

/** Minimal v1 root shape (documentVersion literal 1 + flat node table). */
export interface V1PageDocumentShape {
  documentVersion: 1;
  name: string;
  tokens: StudioDocument["tokens"];
  rootId: string;
  nodes: StudioDocument["pages"][number]["nodes"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Triage only — callers must not rely on this for validation depth. */
export function docFormat(input: unknown): "v1" | "v2" | "unknown" {
  if (!isRecord(input)) return "unknown";
  const version = input.documentVersion;
  if (version === 2) return "v2";
  if (version === 1) return "v1";
  // Missing version but v1-shaped (flat node table + rootId, no pages):
  // treat as v1 legacy raw (T19 §0.3 formatVersion ruling).
  if (
    version === undefined &&
    typeof input.rootId === "string" &&
    Array.isArray(input.nodes) &&
    !("pages" in input)
  ) {
    return "v1";
  }
  return "unknown";
}

/**
 * v1 -> v2 wrap. Page id fixed "page-1"; page.name = doc.name (codegen's
 * src/pages/<Name>.tsx then stays byte-identical for migrated docs);
 * tokens/name hoisted verbatim; the nodes array reference is untouched.
 * Throws on non-v1 input (callers triage with docFormat first).
 */
export function migrateV1ToV2(raw: unknown): StudioDocument {
  if (docFormat(raw) !== "v1") {
    throw new Error("migrateV1ToV2 仅接受 v1 形状的文档（请先用 docFormat 分诊）");
  }
  const v1 = raw as V1PageDocumentShape & Record<string, unknown>;
  const page: Page = {
    id: "page-1",
    name: typeof v1.name === "string" ? v1.name : "",
    rootId: v1.rootId,
    nodes: v1.nodes,
  };
  const candidate: StudioDocument = {
    documentVersion: DOCUMENT_VERSION,
    name: page.name,
    tokens: v1.tokens,
    pages: [page],
  };
  // Full validation on the way out: schema parse normalizes node defaults
  // exactly like the old v1 parse did, so downstream consumers see the same
  // normalized shape as before (plus the new pages envelope).
  return studioDocumentSchema.parse(candidate);
}

/**
 * Inverse fold for rollback. Single-page docs collapse losslessly (page id /
 * page name / documentVersion are derived, everything else round-trips);
 * multi-page docs return null — callers surface that, never truncate.
 */
export function downgradeToV1(doc: StudioDocument): V1PageDocumentShape | null {
  if (doc.pages.length !== 1) return null;
  const page = doc.pages[0]!;
  return {
    documentVersion: 1,
    name: doc.name,
    tokens: doc.tokens,
    rootId: page.rootId,
    nodes: page.nodes,
  };
}
