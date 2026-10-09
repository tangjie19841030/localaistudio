import type { z } from "zod";
import type { AssetRef, DataCategory } from "./assets.js";
import type { CommandDefinition } from "./commands.js";
import type { DocumentEnvelope, ProjectType } from "./document-envelope.js";
import type { SelectionScope, ScopeResolution } from "./selection.js";

export interface DocumentAdapter<TDocument = unknown> {
  createEmpty(name: string): DocumentEnvelope<TDocument>;
  parse(input: unknown): DocumentEnvelope<TDocument>;
  resolveScope(envelope: DocumentEnvelope<TDocument>, scope: SelectionScope): ScopeResolution;
}

export interface AiToolDefinition {
  id: string;
  title: string;
  commandIds: string[];
}

export interface ImporterDefinition {
  id: string;
  title: string;
  sourceFormat: string;
}

export interface ExporterDefinition {
  id: string;
  title: string;
  targetFormat: string;
}

export interface QualityInspector {
  id: string;
  title: string;
}

export interface CapabilityDeclaration {
  id: string;
  title: string;
  dataCategories: DataCategory[];
}

export interface ToolKit<TDocument = unknown> {
  id: string;
  version: string;
  projectType: ProjectType;
  document: DocumentAdapter<TDocument>;
  commands: CommandDefinition<TDocument>[];
  aiTools: AiToolDefinition[];
  importers: ImporterDefinition[];
  exporters: ExporterDefinition[];
  inspectors: QualityInspector[];
  capabilities: CapabilityDeclaration[];
}

export interface ToolKitTemplate<TDocument = unknown> {
  id: string;
  title: string;
  create(name: string): DocumentEnvelope<TDocument>;
  assets?: AssetRef[];
}

export interface ParameterizedTool<TArgs = unknown> {
  id: string;
  title: string;
  parameters: z.ZodType<TArgs>;
}

export class ToolKitRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolKitRegistryError";
  }
}

export class ToolKitRegistry {
  private readonly byId = new Map<string, ToolKit<unknown>>();

  constructor(toolkits: readonly ToolKit[]) {
    for (const toolkit of toolkits) {
      if (this.byId.has(toolkit.id)) {
        throw new ToolKitRegistryError(`工具包 ID 重复: ${toolkit.id}`);
      }
      this.assertDefinition(toolkit);
      this.byId.set(toolkit.id, toolkit as ToolKit<unknown>);
    }
  }

  get(projectType: ProjectType, toolkitId: string): ToolKit<unknown> {
    const toolkit = this.byId.get(toolkitId);
    if (!toolkit) throw new ToolKitRegistryError(`未注册的工具包: ${toolkitId}`);
    if (toolkit.projectType !== projectType) {
      throw new ToolKitRegistryError(`工具包 ${toolkitId} 不支持 ${projectType} 项目`);
    }
    return toolkit;
  }

  getForProjectType(projectType: ProjectType): ToolKit<unknown> {
    const toolkit = [...this.byId.values()].find((item) => item.projectType === projectType);
    if (!toolkit) throw new ToolKitRegistryError(`未注册 ${projectType} 项目的工具包`);
    return toolkit;
  }

  list(): ToolKit<unknown>[] {
    return [...this.byId.values()];
  }

  private assertDefinition(toolkit: ToolKit): void {
    if (toolkit.id.trim() === "") throw new ToolKitRegistryError("工具包 ID 不能为空");
    if (toolkit.version.trim() === "") throw new ToolKitRegistryError(`工具包 ${toolkit.id} 缺少版本号`);

    const commandIds = new Set<string>();
    for (const command of toolkit.commands) {
      if (commandIds.has(command.id)) {
        throw new ToolKitRegistryError(`工具包 ${toolkit.id} 的命令 ID 重复: ${command.id}`);
      }
      commandIds.add(command.id);
    }
    for (const tool of toolkit.aiTools) {
      for (const commandId of tool.commandIds) {
        if (!commandIds.has(commandId)) {
          throw new ToolKitRegistryError(`AI 工具 ${tool.id} 引用了不存在的命令: ${commandId}`);
        }
      }
    }
  }
}
