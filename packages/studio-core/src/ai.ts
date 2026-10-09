import type { CommandInvocation, ExecutedCommand } from "./commands.js";
import { executeCommand, executeTransaction } from "./commands.js";
import type { DocumentEnvelope } from "./document-envelope.js";
import type { ToolKit } from "./toolkit.js";

export interface ChangePlanItem<TDocument = unknown> {
  invocationId: string;
  invocation: CommandInvocation;
  summary: string;
  affectedIds: string[];
  dependsOnInvocationIds: string[];
  previewEnvelope: DocumentEnvelope<TDocument>;
}

export interface PreviewTransaction<TDocument = unknown> {
  sourceEnvelope: DocumentEnvelope<TDocument>;
  previewEnvelope: DocumentEnvelope<TDocument>;
  items: ChangePlanItem<TDocument>[];
}

export interface AcceptedPreviewTransaction<TDocument = unknown> {
  envelope: DocumentEnvelope<TDocument>;
  commands: ExecutedCommand<TDocument>[];
  rejectedInvocationIds: string[];
}

export interface AuditEntry {
  source: "manual" | "ai" | "migration" | "import";
  invocationIds: string[];
  acceptedAt: string;
}

export function previewAiTransaction<TDocument>(
  toolkit: ToolKit<TDocument>,
  sourceEnvelope: DocumentEnvelope<TDocument>,
  invocations: readonly CommandInvocation[],
): PreviewTransaction<TDocument> {
  const seen = new Set<string>();
  const creatorById = new Map<string, string>();
  let current = sourceEnvelope;
  const items: ChangePlanItem<TDocument>[] = [];
  for (const invocation of invocations) {
    if (invocation.source !== "ai") {
      throw new Error("AI 预览事务只接受 AI 命令");
    }
    if (seen.has(invocation.invocationId)) {
      throw new Error(`重复的命令调用 ID: ${invocation.invocationId}`);
    }
    seen.add(invocation.invocationId);
    const command = executeCommand(toolkit, current, invocation);
    const dependsOnInvocationIds = [
      ...new Set(
        command.result.scopeIds
          .map((id) => creatorById.get(id))
          .filter((creator): creator is string => creator !== undefined),
      ),
    ];
    for (const createdId of command.result.createdIds ?? []) {
      if (creatorById.has(createdId)) {
        throw new Error(`预览命令重复创建对象: ${createdId}`);
      }
      creatorById.set(createdId, invocation.invocationId);
    }
    current = command.result.nextEnvelope;
    items.push({
      invocationId: invocation.invocationId,
      invocation,
      summary: command.result.summary,
      affectedIds: command.result.affectedIds,
      dependsOnInvocationIds,
      previewEnvelope: current,
    });
  }
  return { sourceEnvelope, previewEnvelope: current, items };
}

export function acceptPreviewTransaction<TDocument>(
  toolkit: ToolKit<TDocument>,
  preview: PreviewTransaction<TDocument>,
  acceptedInvocationIds: readonly string[],
): AcceptedPreviewTransaction<TDocument> {
  const accepted = new Set(acceptedInvocationIds);
  const unknown = acceptedInvocationIds.filter((id) => !preview.items.some((item) => item.invocationId === id));
  if (unknown.length > 0) throw new Error(`不存在的预览命令: ${unknown.join("、")}`);

  for (const item of preview.items) {
    if (!accepted.has(item.invocationId)) continue;
    const missingDependencies = item.dependsOnInvocationIds.filter((id) => !accepted.has(id));
    if (missingDependencies.length > 0) {
      throw new Error(`预览命令 ${item.invocationId} 缺少依赖: ${missingDependencies.join("、")}`);
    }
  }

  const selected = preview.items
    .filter((item) => accepted.has(item.invocationId))
    .map((item) => item.invocation);
  const transaction = executeTransaction(toolkit, preview.sourceEnvelope, selected);
  if (!transaction.ok) throw transaction.error;

  return {
    envelope: transaction.envelope,
    commands: transaction.commands,
    rejectedInvocationIds: preview.items
      .map((item) => item.invocationId)
      .filter((id) => !accepted.has(id)),
  };
}
