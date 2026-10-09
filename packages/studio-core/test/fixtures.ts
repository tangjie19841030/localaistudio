import { z } from "zod";
import {
  createDocumentEnvelope,
  type CommandDefinition,
  type DocumentAdapter,
  type DataDisclosure,
  type DocumentEnvelope,
  type SelectionScope,
  type ToolKit,
} from "../src/index.js";

export interface DemoObject {
  id: string;
  label: string;
  locked?: boolean;
}

export interface DemoDocument {
  name: string;
  objects: DemoObject[];
}

const payloadSchema = z
  .object({
    name: z.string().min(1),
    objects: z.array(z.object({ id: z.string().min(1), label: z.string(), locked: z.boolean().optional() })),
  })
  .strict();

export function demoEnvelope(document: DemoDocument = { name: "演示", objects: [{ id: "object-1", label: "初始" }] }): DocumentEnvelope<DemoDocument> {
  return createDocumentEnvelope({
    projectType: "ui",
    toolkitId: "builtin.demo-ui",
    toolkitVersion: "1.0.0",
    documentVersion: 1,
    document,
  });
}

export const demoAdapter: DocumentAdapter<DemoDocument> = {
  createEmpty(name) {
    return demoEnvelope({ name, objects: [] });
  },
  parse(input) {
    const candidate = input as DocumentEnvelope<unknown>;
    if (
      candidate?.projectType !== "ui" ||
      candidate.toolkitId !== "builtin.demo-ui" ||
      candidate.documentVersion !== 1
    ) {
      throw new Error("demo 文档信封不匹配");
    }
    return { ...candidate, document: payloadSchema.parse(candidate.document) };
  },
  resolveScope(envelope, scope) {
    const ids = new Set(envelope.document.objects.map((object) => object.id));
    const lockedIds = envelope.document.objects.filter((object) => object.locked).map((object) => object.id);
    if (scope.kind === "file") return { allowAll: true, allowedIds: [], lockedIds, lockManagementIds: lockedIds };
    for (const id of scope.targetIds) {
      if (!ids.has(id)) throw new Error(`选择对象不存在: ${id}`);
    }
    return { allowAll: false, allowedIds: scope.targetIds, lockedIds, lockManagementIds: lockedIds };
  },
};

const setLabel: CommandDefinition<DemoDocument> = {
  id: "demo.set-label",
  title: "设置对象标签",
  riskLevel: "low",
  parameters: z.object({ id: z.string().min(1), label: z.string().min(1) }).strict(),
  execute(envelope, args) {
    const input = args as { id: string; label: string };
    const document = envelope.document as DemoDocument;
    const exists = document.objects.some((object) => object.id === input.id);
    if (!exists) throw new Error(`对象不存在: ${input.id}`);
    return {
      nextEnvelope: {
        ...envelope,
        document: {
          ...document,
          objects: document.objects.map((object) =>
            object.id === input.id ? { ...object, label: input.label } : object,
          ),
        },
      },
      summary: `已设置 ${input.id} 的标签`,
      affectedIds: [input.id],
      scopeIds: [input.id],
    };
  },
};

const addObject: CommandDefinition<DemoDocument> = {
  id: "demo.add-object",
  title: "新增对象",
  riskLevel: "low",
  allowedScopeKinds: ["file"],
  parameters: z.object({ id: z.string().min(1), label: z.string().min(1) }).strict(),
  execute(envelope, args) {
    const input = args as { id: string; label: string };
    const document = envelope.document as DemoDocument;
    if (document.objects.some((object) => object.id === input.id)) {
      throw new Error(`对象已存在: ${input.id}`);
    }
    return {
      nextEnvelope: {
        ...envelope,
        document: { ...document, objects: [...document.objects, { id: input.id, label: input.label }] },
      },
      summary: `已新增 ${input.id}`,
      affectedIds: [input.id],
      createdIds: [input.id],
      scopeIds: [],
    };
  },
};

const rename: CommandDefinition<DemoDocument> = {
  id: "demo.rename",
  title: "重命名文档",
  riskLevel: "low",
  allowedScopeKinds: ["file"],
  parameters: z.object({ name: z.string().min(1) }).strict(),
  execute(envelope, args) {
    const input = args as { name: string };
    const document = envelope.document as DemoDocument;
    return {
      nextEnvelope: { ...envelope, document: { ...document, name: input.name } },
      summary: "已重命名文档",
      affectedIds: [],
      scopeIds: [],
    };
  },
};

export const externalModelDisclosure: DataDisclosure = {
  id: "demo.external-model",
  destination: "external-model",
  dataCategories: ["prompt", "selection"],
  summary: "将提示词和选区发送给外部模型",
};

const external: CommandDefinition<DemoDocument> = {
  id: "demo.external",
  title: "外发素材",
  riskLevel: "high",
  parameters: z.object({ id: z.string().min(1) }).strict(),
  requiredCapabilities: ["external-network"],
  requiredDisclosures: [externalModelDisclosure],
  execute(envelope, args) {
    const input = args as { id: string };
    return {
      nextEnvelope: envelope,
      summary: "已处理外发素材",
      affectedIds: [input.id],
      scopeIds: [input.id],
    };
  },
};

export const demoToolkit: ToolKit<DemoDocument> = {
  id: "builtin.demo-ui",
  version: "1.0.0",
  projectType: "ui",
  document: demoAdapter,
  commands: [setLabel, addObject, rename, external],
  aiTools: [
    { id: "demo.ai.add-object", title: "新增对象", commandIds: ["demo.add-object"] },
    { id: "demo.ai.set-label", title: "设置标签", commandIds: ["demo.set-label"] },
    { id: "demo.ai.rename", title: "重命名文档", commandIds: ["demo.rename"] },
  ],
  importers: [],
  exporters: [],
  inspectors: [],
  capabilities: [{ id: "external-network", title: "访问外部网络", dataCategories: ["prompt", "asset"] }],
};

export const fileScope: SelectionScope = { kind: "file", targetIds: [] };
export const objectScope: SelectionScope = { kind: "selection", targetIds: ["object-1"] };
