import { z } from "zod";

export type AssetEmbedding = "reference" | "embedded";
export type DataCategory = "prompt" | "document" | "asset" | "selection" | "metadata";

export interface AssetRef {
  id: string;
  mediaType: string;
  displayName: string;
  embedding: AssetEmbedding;
  sourceProjectId?: string;
  relativePath?: string;
  checksum?: string;
}

export interface DataDisclosure {
  id: string;
  destination: "local-process" | "external-model" | "external-resource";
  dataCategories: readonly DataCategory[];
  summary: string;
}

export interface AuthorizationDecision {
  disclosureId: string;
  granted: boolean;
  decidedAt: string;
}

export const assetRefSchema = z
  .object({
    id: z.string().min(1),
    mediaType: z.string().min(1),
    displayName: z.string().min(1),
    embedding: z.enum(["reference", "embedded"]),
    sourceProjectId: z.string().uuid().optional(),
    relativePath: z.string().min(1).optional(),
    checksum: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((asset, ctx) => {
    if (asset.embedding === "reference" && !asset.sourceProjectId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceProjectId"], message: "跨项目引用必须指定源项目" });
    }
    if (asset.embedding === "embedded" && !asset.relativePath) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["relativePath"], message: "嵌入资产必须指定项目内路径" });
    }
  });

export function canSendDisclosure(
  disclosure: DataDisclosure,
  decisions: readonly AuthorizationDecision[],
): boolean {
  if (disclosure.destination === "local-process") return true;
  return decisions.some((decision) => decision.disclosureId === disclosure.id && decision.granted);
}
