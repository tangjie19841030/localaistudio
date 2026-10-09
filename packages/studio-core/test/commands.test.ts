import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CommandExecutionError,
  executeCommand,
  executeTransaction,
  type CommandDefinition,
  type CommandInvocation,
  type DocumentEnvelope,
} from "../src/index.js";
import {
  demoEnvelope,
  demoToolkit,
  externalModelDisclosure,
  fileScope,
  objectScope,
  type DemoDocument,
} from "./fixtures.js";

function invocation(overrides: Partial<CommandInvocation> = {}): CommandInvocation {
  return {
    invocationId: "set-label",
    id: "demo.set-label",
    args: { id: "object-1", label: "更新后" },
    source: "manual",
    scope: objectScope,
    ...overrides,
  };
}

describe("command dispatcher", () => {
  it("runs manual and AI requests through the same command path", () => {
    const manual = executeCommand(demoToolkit, demoEnvelope(), invocation());
    const ai = executeCommand(demoToolkit, demoEnvelope(), invocation({ source: "ai" }));

    expect(ai.result.nextEnvelope).toEqual(manual.result.nextEnvelope);
    expect(ai.result.summary).toBe(manual.result.summary);
  });

  it("blocks out-of-scope, locked, and ungranted capability commands", () => {
    expect(() =>
      executeCommand(
        demoToolkit,
        demoEnvelope(),
        invocation({ scope: { kind: "selection", targetIds: ["another-object"] } }),
      ),
    ).toThrow(CommandExecutionError);

    expect(() =>
      executeCommand(
        demoToolkit,
        demoEnvelope({ name: "演示", objects: [{ id: "object-1", label: "初始", locked: true }] }),
        invocation(),
      ),
    ).toThrow(CommandExecutionError);

    expect(() =>
      executeCommand(
        demoToolkit,
        demoEnvelope(),
        invocation({
          invocationId: "external",
          id: "demo.external",
          args: { id: "object-1" },
          scope: objectScope,
        }),
      ),
    ).toThrow(CommandExecutionError);

    const externalInvocation = invocation({
      invocationId: "external",
      id: "demo.external",
      args: { id: "object-1" },
      scope: objectScope,
    });
    expect(() =>
      executeCommand(demoToolkit, demoEnvelope(), externalInvocation, {
        grantedCapabilities: new Set(["external-network"]),
      }),
    ).toThrow("未授权数据外发");

    expect(
      executeCommand(demoToolkit, demoEnvelope(), externalInvocation, {
        grantedCapabilities: new Set(["external-network"]),
        authorizationDecisions: [
          {
            disclosureId: externalModelDisclosure.id,
            granted: true,
            decidedAt: "2026-09-11T00:00:00.000Z",
          },
        ],
      }).result.summary,
    ).toBe("已处理外发素材");
  });

  it("rejects a command that requests an undeclared toolkit capability", () => {
    const incompleteToolkit = { ...demoToolkit, capabilities: [] };

    expect(() =>
      executeCommand(
        incompleteToolkit,
        demoEnvelope(),
        invocation({
          invocationId: "external",
          id: "demo.external",
          args: { id: "object-1" },
          scope: objectScope,
        }),
        { grantedCapabilities: new Set(["external-network"]) },
      ),
    ).toThrow("工具包未声明所需能力");
  });

  it("keeps the original envelope when any transaction command fails", () => {
    const original = demoEnvelope();
    const result = executeTransaction(demoToolkit, original, [
      invocation({ invocationId: "rename", id: "demo.rename", args: { name: "新名称" }, scope: fileScope }),
      invocation({ invocationId: "bad", args: { id: "missing", label: "失败" } }),
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.envelope).toEqual(original);
      expect(result.error).toBeInstanceOf(CommandExecutionError);
    }
  });

  it("only overrides the directly locked targets declared by a manual command", () => {
    const lockCommand: CommandDefinition<DemoDocument> = {
      id: "demo.lock-manager",
      title: "管理对象锁定",
      riskLevel: "low",
      allowedScopeKinds: ["file"],
      parameters: z
        .object({ overrideId: z.string().min(1), scopeIds: z.array(z.string().min(1)).min(1) })
        .strict(),
      execute(envelope, args) {
        const input = args as { overrideId: string; scopeIds: string[] };
        return {
          nextEnvelope: envelope,
          summary: "已管理锁定",
          affectedIds: input.scopeIds,
          lockOverrideIds: [input.overrideId],
          scopeIds: input.scopeIds,
        };
      },
    };
    const toolkit = {
      ...demoToolkit,
      commands: [lockCommand, ...demoToolkit.commands],
      aiTools: [...demoToolkit.aiTools, { id: "demo.ai.lock-manager", title: "管理锁定", commandIds: [lockCommand.id] }],
    };
    const locked = demoEnvelope({
      name: "演示",
      objects: [
        { id: "object-1", label: "锁定 A", locked: true },
        { id: "object-2", label: "锁定 B", locked: true },
      ],
    });

    expect(
      executeCommand(toolkit, locked, {
        invocationId: "manage-lock-a",
        id: lockCommand.id,
        args: { overrideId: "object-1", scopeIds: ["object-1"] },
        source: "manual",
        scope: fileScope,
      }).result.summary,
    ).toBe("已管理锁定");

    expect(() =>
      executeCommand(toolkit, locked, {
        invocationId: "manage-both-locks",
        id: lockCommand.id,
        args: { overrideId: "object-1", scopeIds: ["object-1", "object-2"] },
        source: "manual",
        scope: fileScope,
      }),
    ).toThrow("目标已锁定: object-2");

    for (const source of ["ai", "migration", "import"] as const) {
      expect(() =>
        executeCommand(toolkit, locked, {
          invocationId: `${source}-manage-lock`,
          id: lockCommand.id,
          args: { overrideId: "object-1", scopeIds: ["object-1"] },
          source,
          scope: fileScope,
        }),
      ).toThrow("只有手动命令可以请求锁定豁免");
    }
  });

  it("isolates the source envelope from a mutating command handler", () => {
    const mutatingCommand: CommandDefinition<DemoDocument> = {
      id: "demo.mutate-input",
      title: "错误地修改输入",
      riskLevel: "low",
      allowedScopeKinds: ["file"],
      parameters: z.object({}).strict(),
      execute(envelope) {
        envelope.document.name = "不应写回源文档";
        return {
          nextEnvelope: envelope,
          summary: "已修改",
          affectedIds: [],
          scopeIds: [],
        };
      },
    };
    const transparentAdapter = {
      ...demoToolkit.document,
      parse(input: unknown): DocumentEnvelope<DemoDocument> {
        return input as DocumentEnvelope<DemoDocument>;
      },
    };
    const toolkit = {
      ...demoToolkit,
      document: transparentAdapter,
      commands: [mutatingCommand, ...demoToolkit.commands],
    };
    const original = demoEnvelope();
    const result = executeTransaction(toolkit, original, [
      invocation({ invocationId: "mutate", id: "demo.mutate-input", args: {}, scope: fileScope }),
      invocation({ invocationId: "bad", args: { id: "missing", label: "失败" } }),
    ]);

    expect(result.ok).toBe(false);
    expect(original.document.name).toBe("演示");
  });

  it("invalid command args report the allowed field names for AI retry", () => {
    expect(() =>
      executeCommand(demoToolkit, demoEnvelope(), invocation({ args: { objectKey: "object-1", label: "x" } })),
    ).toThrow(/允许的字段: id、label/);
  });
});
