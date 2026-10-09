import { z } from "zod";

export const PROJECT_TYPES = ["ui", "ppt", "word"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const projectTypeSchema = z.enum(PROJECT_TYPES);

const documentEnvelopeSchema = z
  .object({
    format: z.literal("studio-document"),
    coreVersion: z.literal(1),
    projectType: projectTypeSchema,
    toolkitId: z.string().min(1),
    toolkitVersion: z.string().min(1),
    documentVersion: z.number().int().min(1),
    document: z.unknown().refine((document) => document !== undefined, "必须提供领域文档"),
  })
  .strict();

export interface DocumentEnvelope<TDocument = unknown> {
  format: "studio-document";
  coreVersion: 1;
  projectType: ProjectType;
  toolkitId: string;
  toolkitVersion: string;
  documentVersion: number;
  document: TDocument;
}

export interface CreateDocumentEnvelope<TDocument> {
  projectType: ProjectType;
  toolkitId: string;
  toolkitVersion: string;
  documentVersion: number;
  document: TDocument;
}

export class DocumentEnvelopeError extends Error {
  constructor(message: string, public readonly issues: string[] = []) {
    super(message);
    this.name = "DocumentEnvelopeError";
  }
}

function issueLines(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

export function parseDocumentEnvelope(input: unknown): DocumentEnvelope {
  const parsed = documentEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    throw new DocumentEnvelopeError("文档信封无效", issueLines(parsed.error));
  }
  return {
    format: parsed.data.format,
    coreVersion: parsed.data.coreVersion,
    projectType: parsed.data.projectType,
    toolkitId: parsed.data.toolkitId,
    toolkitVersion: parsed.data.toolkitVersion,
    documentVersion: parsed.data.documentVersion,
    document: parsed.data.document,
  };
}

export function createDocumentEnvelope<TDocument>(
  input: CreateDocumentEnvelope<TDocument>,
): DocumentEnvelope<TDocument> {
  const envelope: DocumentEnvelope<TDocument> = {
    format: "studio-document",
    coreVersion: 1,
    ...input,
  };
  try {
    parseDocumentEnvelope(envelope);
  } catch (error) {
    if (error instanceof DocumentEnvelopeError) throw error;
    throw new DocumentEnvelopeError("文档信封无效");
  }
  return envelope;
}
