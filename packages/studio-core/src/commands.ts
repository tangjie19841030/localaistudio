import type { AuthorizationDecision, DataDisclosure } from "./assets.js";
import { canSendDisclosure } from "./assets.js";
import { parseDocumentEnvelope, type DocumentEnvelope } from "./document-envelope.js";
import type { SelectionScope, SelectionScopeKind } from "./selection.js";
import { ensureScopeAllows, parseSelectionScope, SelectionScopeError } from "./selection.js";
import type { ToolKit } from "./toolkit.js";
import { z } from "zod";

export type CommandSource = "manual" | "ai" | "migration" | "import";
export type RiskLevel = "low" | "medium" | "high";

export interface CommandInvocation {
  invocationId: string;
  id: string;
  args: unknown;
  source: CommandSource;
  scope: SelectionScope;
}

export interface CommandExecutionContext {
  source: CommandSource;
  scope: SelectionScope;
  grantedCapabilities: ReadonlySet<string>;
  authorizationDecisions: readonly AuthorizationDecision[];
}

export interface CommandResult<TDocument = unknown> {
  nextEnvelope: DocumentEnvelope<TDocument>;
  summary: string;
  affectedIds: string[];
  /** IDs created by this command for dependency-aware AI preview acceptance. */
  createdIds?: string[];
  /** Directly locked IDs this manual command is permitted to change. */
  lockOverrideIds?: string[];
  /** IDs whose mutation must remain inside the resolved selection scope. */
  scopeIds: string[];
}

export interface CommandDefinition<TDocument = unknown, TArgs = unknown, TInput = TArgs> {
  id: string;
  title: string;
  riskLevel: RiskLevel;
  allowedScopeKinds?: readonly SelectionScopeKind[];
  parameters: z.ZodType<TArgs, z.ZodTypeDef, TInput>;
  requiredCapabilities?: string[];
  requiredDisclosures?: DataDisclosure[];
  execute(
    envelope: DocumentEnvelope<TDocument>,
    args: TArgs,
    context: CommandExecutionContext,
  ): CommandResult<TDocument>;
}

export interface ExecutedCommand<TDocument = unknown> {
  invocation: CommandInvocation;
  result: CommandResult<TDocument>;
}

export interface TransactionMetadata {
  transactionId: string;
  coalesceKey?: string;
}

export interface SuccessfulTransaction<TDocument = unknown> {
  ok: true;
  envelope: DocumentEnvelope<TDocument>;
  commands: ExecutedCommand<TDocument>[];
}

export interface FailedTransaction<TDocument = unknown> {
  ok: false;
  envelope: DocumentEnvelope<TDocument>;
  error: CommandExecutionError;
}

export type TransactionResult<TDocument = unknown> = SuccessfulTransaction<TDocument> | FailedTransaction<TDocument>;

export class CommandExecutionError extends Error {
  constructor(message: string, public readonly invocationId?: string) {
    super(message);
    this.name = "CommandExecutionError";
  }
}

function commandById<TDocument>(toolkit: ToolKit<TDocument>, id: string): CommandDefinition<TDocument> {
  const command = toolkit.commands.find((candidate) => candidate.id === id);
  if (!command) throw new CommandExecutionError(`当前工具包不支持命令: ${id}`);
  return command;
}

/** Top-level property names of a zod object schema ("strict" hides nothing). */
function zodShapeKeys(schema: z.ZodTypeAny): string[] {
  const def = (schema as unknown as { _def?: { shape?: (() => Record<string, unknown>) | Record<string, unknown> } })._def;
  const shape = typeof def?.shape === "function" ? def.shape() : def?.shape;
  return shape ? Object.keys(shape) : [];
}

function assertToolKitMatch<TDocument>(toolkit: ToolKit<TDocument>, envelope: DocumentEnvelope<TDocument>): void {
  if (envelope.projectType !== toolkit.projectType || envelope.toolkitId !== toolkit.id) {
    throw new CommandExecutionError("文档与当前工具包不匹配");
  }
  if (envelope.toolkitVersion !== toolkit.version) {
    throw new CommandExecutionError(`文档工具包版本 ${envelope.toolkitVersion} 与当前版本 ${toolkit.version} 不兼容`);
  }
}

function assertAiCommandIsRegistered<TDocument>(
  toolkit: ToolKit<TDocument>,
  command: CommandDefinition<TDocument>,
  source: CommandSource,
): void {
  if (source !== "ai") return;
  if (!toolkit.aiTools.some((tool) => tool.commandIds.includes(command.id))) {
    throw new CommandExecutionError(`AI 未注册命令: ${command.id}`);
  }
}

function cloneEnvelope<TDocument>(envelope: DocumentEnvelope<TDocument>): DocumentEnvelope<TDocument> {
  try {
    return structuredClone(envelope);
  } catch {
    throw new CommandExecutionError("文档信封必须是可复制的持久化数据");
  }
}

function assertEnvelopeIdentity<TDocument>(
  before: DocumentEnvelope<TDocument>,
  after: DocumentEnvelope<TDocument>,
): void {
  if (
    after.format !== before.format ||
    after.coreVersion !== before.coreVersion ||
    after.projectType !== before.projectType ||
    after.toolkitId !== before.toolkitId ||
    after.toolkitVersion !== before.toolkitVersion ||
    after.documentVersion !== before.documentVersion
  ) {
    throw new CommandExecutionError("命令不能直接变更文档格式或工具包版本");
  }
}

function defaultContext(invocation: CommandInvocation, options?: Partial<CommandExecutionContext>): CommandExecutionContext {
  return {
    source: invocation.source,
    scope: parseSelectionScope(invocation.scope),
    grantedCapabilities: options?.grantedCapabilities ?? new Set<string>(),
    authorizationDecisions: options?.authorizationDecisions ?? [],
  };
}

function ensureAuthorization<TDocument>(
  toolkit: ToolKit<TDocument>,
  command: CommandDefinition<TDocument>,
  context: CommandExecutionContext,
): void {
  const undeclaredCapabilities = (command.requiredCapabilities ?? []).filter(
    (capability) => !toolkit.capabilities.some((declared) => declared.id === capability),
  );
  if (undeclaredCapabilities.length > 0) {
    throw new CommandExecutionError(`工具包未声明所需能力: ${undeclaredCapabilities.join("、")}`);
  }
  const missingCapabilities = (command.requiredCapabilities ?? []).filter(
    (capability) => !context.grantedCapabilities.has(capability),
  );
  if (missingCapabilities.length > 0) {
    throw new CommandExecutionError(`未授予所需能力: ${missingCapabilities.join("、")}`);
  }
  const deniedDisclosure = (command.requiredDisclosures ?? []).find(
    (disclosure) => !canSendDisclosure(disclosure, context.authorizationDecisions),
  );
  if (deniedDisclosure) {
    throw new CommandExecutionError(`未授权数据外发: ${deniedDisclosure.summary}`);
  }
}

export function executeCommand<TDocument>(
  toolkit: ToolKit<TDocument>,
  envelope: DocumentEnvelope<TDocument>,
  invocation: CommandInvocation,
  options?: Partial<CommandExecutionContext>,
): ExecutedCommand<TDocument> {
  if (invocation.invocationId.trim() === "") {
    throw new CommandExecutionError("命令调用 ID 不能为空");
  }
  try {
    assertToolKitMatch(toolkit, envelope);
    const normalizedEnvelope = toolkit.document.parse(
      parseDocumentEnvelope(cloneEnvelope(envelope)),
    ) as DocumentEnvelope<TDocument>;
    const command = commandById(toolkit, invocation.id);
    assertAiCommandIsRegistered(toolkit, command, invocation.source);
    const parsedArgs = command.parameters.safeParse(invocation.args);
    if (!parsedArgs.success) {
      const issues = parsedArgs.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
      // Allowed-key list lets an AI retry with correct field names in one
      // round-trip instead of guessing (slide.add rejects `id` but accepts
      // `slideId` — without the hint the model burns its whole step budget).
      const allowed = zodShapeKeys(command.parameters);
      const hint = allowed.length > 0 ? `；允许的字段: ${allowed.join("、")}` : "";
      throw new CommandExecutionError(`命令参数无效: ${issues.join("; ")}${hint}`, invocation.invocationId);
    }
    const context = defaultContext(invocation, options);
    if (command.allowedScopeKinds && !command.allowedScopeKinds.includes(context.scope.kind)) {
      throw new CommandExecutionError(
        `命令 ${command.id} 不支持 ${context.scope.kind} 范围`,
        invocation.invocationId,
      );
    }
    ensureAuthorization(toolkit, command, context);
    const resolution = toolkit.document.resolveScope(normalizedEnvelope, context.scope);
    const result = command.execute(normalizedEnvelope, parsedArgs.data, context);
    const lockOverrideIds = result.lockOverrideIds ?? [];
    if (invocation.source !== "manual" && lockOverrideIds.length > 0) {
      throw new CommandExecutionError("只有手动命令可以请求锁定豁免", invocation.invocationId);
    }
    const invalidLockOverrides = lockOverrideIds.filter(
      (id) => !result.scopeIds.includes(id) || !resolution.lockManagementIds.includes(id),
    );
    if (invalidLockOverrides.length > 0) {
      throw new CommandExecutionError(
        `锁定豁免只能覆盖本次范围内的直接锁定目标: ${invalidLockOverrides.join("、")}`,
        invocation.invocationId,
      );
    }
    const scopedResolution =
      lockOverrideIds.length > 0
        ? { ...resolution, lockedIds: resolution.lockedIds.filter((id) => !lockOverrideIds.includes(id)) }
        : resolution;
    ensureScopeAllows(scopedResolution, result.scopeIds);
    assertEnvelopeIdentity(normalizedEnvelope, result.nextEnvelope);
    const nextEnvelope = toolkit.document.parse(result.nextEnvelope);
    return { invocation, result: { ...result, nextEnvelope } };
  } catch (error) {
    if (error instanceof CommandExecutionError) throw error;
    if (error instanceof SelectionScopeError) {
      throw new CommandExecutionError(error.message, invocation.invocationId);
    }
    throw new CommandExecutionError(error instanceof Error ? error.message : String(error), invocation.invocationId);
  }
}

export function executeTransaction<TDocument>(
  toolkit: ToolKit<TDocument>,
  envelope: DocumentEnvelope<TDocument>,
  invocations: readonly CommandInvocation[],
  options?: Partial<CommandExecutionContext>,
): TransactionResult<TDocument> {
  let current = envelope;
  const commands: ExecutedCommand<TDocument>[] = [];
  const invocationIds = new Set<string>();
  for (const invocation of invocations) {
    if (invocationIds.has(invocation.invocationId)) {
      return {
        ok: false,
        envelope,
        error: new CommandExecutionError(`重复的命令调用 ID: ${invocation.invocationId}`, invocation.invocationId),
      };
    }
    invocationIds.add(invocation.invocationId);
    try {
      const executed = executeCommand(toolkit, current, invocation, options);
      commands.push(executed);
      current = executed.result.nextEnvelope;
    } catch (error) {
      return {
        ok: false,
        envelope,
        error:
          error instanceof CommandExecutionError
            ? error
            : new CommandExecutionError(error instanceof Error ? error.message : String(error), invocation.invocationId),
      };
    }
  }
  return { ok: true, envelope: current, commands };
}
