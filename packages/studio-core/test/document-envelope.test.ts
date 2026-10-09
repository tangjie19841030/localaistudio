import { describe, expect, it } from "vitest";
import { DocumentEnvelopeError, createDocumentEnvelope, parseDocumentEnvelope } from "../src/index.js";

describe("DocumentEnvelope", () => {
  it("creates and parses a typed envelope without altering its domain payload", () => {
    const envelope = createDocumentEnvelope({
      projectType: "ui",
      toolkitId: "builtin.ui",
      toolkitVersion: "1.0.0",
      documentVersion: 1,
      document: { root: "root", futureField: { retained: true } },
    });

    expect(parseDocumentEnvelope(envelope)).toEqual(envelope);
  });

  it("rejects malformed headers, missing payloads, and unknown envelope fields", () => {
    expect(() =>
      parseDocumentEnvelope({
        format: "studio-document",
        coreVersion: 1,
        projectType: "ui",
        toolkitId: "builtin.ui",
        toolkitVersion: "1.0.0",
        documentVersion: 1,
        document: {},
        extra: true,
      }),
    ).toThrow(DocumentEnvelopeError);

    expect(() =>
      parseDocumentEnvelope({
        format: "studio-document",
        coreVersion: 1,
        projectType: "ui",
        toolkitId: "builtin.ui",
        toolkitVersion: "1.0.0",
        documentVersion: 1,
      }),
    ).toThrow(DocumentEnvelopeError);

    expect(() =>
      createDocumentEnvelope({
        projectType: "unknown" as "ui",
        toolkitId: "builtin.unknown",
        toolkitVersion: "1.0.0",
        documentVersion: 1,
        document: {},
      }),
    ).toThrow(DocumentEnvelopeError);
  });
});
