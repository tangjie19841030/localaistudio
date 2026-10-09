import { describe, expect, it } from "vitest";
import {
  activityAppendThought,
  activityDoneOpCount,
  activityOnBatch,
  activityOnStage,
  activityOnToolCall,
  activityOnToolResult,
  activityOnVerifyRound,
  activityOnViolation,
  finishActivity,
  startActivity,
} from "./activity";
import { commandLabel } from "./commandLabels";
import type { ToolkitCommand } from "./types";

const T0 = 1_000_000;

const stage = (id: string, label: string, round?: number) =>
  ({ type: "stage", id, label, ...(round ? { round } : {}) }) as never;

describe("activity timeline reducers", () => {
  it("startActivity：空步骤的 live 时间线", () => {
    const a = startActivity("a1", T0);
    expect(a).toMatchObject({ id: "a1", status: "live", startedAt: T0 });
    expect(a.steps).toEqual([]);
  });

  it("stage：reading 起步；第二个 model 关闭前一阶段并标注轮次", () => {
    let a = startActivity("a1", T0);
    a = activityOnStage(a, stage("reading", "正在读取项目…"), T0 + 10);
    expect(a.steps).toHaveLength(1);
    expect(a.steps[0]).toMatchObject({
      kind: "stage",
      name: "reading",
      status: "running",
      label: "正在读取项目", // 服务端 label 尾部省略号由卡片渲染层负责
    });

    a = activityOnStage(a, stage("model", "模型思考中…"), T0 + 100);
    expect(a.steps).toHaveLength(2);
    expect(a.steps[0]?.status).toBe("done");
    expect(a.steps[1]).toMatchObject({ kind: "stage", name: "model", round: 1, status: "running" });

    a = activityOnStage(a, stage("model", "模型思考中…"), T0 + 5_000);
    expect(a.steps).toHaveLength(3);
    expect(a.steps[2]?.label).toBe("模型思考中（第 2 轮）");
    expect(a.steps[2]?.round).toBe(2);
  });

  it("tool-call/result：中文标签、结果摘要、同名严格成对匹配", () => {
    let a = startActivity("a1", T0);
    a = activityOnToolCall(a, "slide.add", "ppt", T0 + 100);
    expect(a.steps.at(-1)).toMatchObject({ kind: "tool", name: "slide.add", label: "新增幻灯片", status: "running" });

    a = activityOnToolResult(a, "slide.add", true, '已新增幻灯片 "封面"', T0 + 900);
    const step = a.steps.at(-1)!;
    expect(step).toMatchObject({ kind: "tool", status: "done", detail: '已新增幻灯片 "封面"' });
    expect(step.endedAt! - step.startedAt).toBe(800);

    // 同名连续调用：result 只关闭最后一个 running。
    a = activityOnToolCall(a, "slide.rename", "ppt", T0 + 1000);
    a = activityOnToolCall(a, "slide.rename", "ppt", T0 + 1100);
    a = activityOnToolResult(a, "slide.rename", false, "重命名失败", T0 + 1200);
    const renames = a.steps.filter((s) => s.name === "slide.rename");
    expect(renames.map((s) => s.status)).toEqual(["running", "failed"]);
  });

  it("thought：连续 delta 合并为一条，工具调用后冻结，再次说话另起一条", () => {
    let a = startActivity("a1", T0);
    a = activityAppendThought(a, "先做封面，", T0 + 100);
    a = activityAppendThought(a, "再删空白页。", T0 + 200);
    expect(a.steps).toHaveLength(1);
    expect(a.steps[0]?.detail).toBe("先做封面，再删空白页。");
    expect(a.steps[0]?.status).toBe("running");

    a = activityOnToolCall(a, "slide.add", "ppt", T0 + 300);
    expect(a.steps[0]?.status).toBe("done"); // 调用工具冻结思考

    a = activityAppendThought(a, "现在调整标题。", T0 + 400);
    expect(a.steps.filter((s) => s.kind === "thought")).toHaveLength(2);
  });

  it("batch：partial 帧记录已应用命令的中文标题", () => {
    const commands: ToolkitCommand[] = [
      { invocationId: "i1", commandId: "slide.add", title: "新增幻灯片", riskLevel: "low", args: {} },
      { invocationId: "i2", commandId: "slide.rename", title: "重命名幻灯片", riskLevel: "low", args: {} },
    ];
    const a = activityOnBatch(startActivity("a1", T0), commands, T0 + 500);
    const step = a.steps[0]!;
    expect(step).toMatchObject({
      kind: "batch",
      status: "done",
      label: "已应用一批变更（2 条）",
      detail: "新增幻灯片；重命名幻灯片",
    });
  });

  it("violation 与 verify-round：notice 步骤 / 带 issues 的修复阶段", () => {
    let a = activityOnViolation(startActivity("a1", T0), ["slide-9"], T0);
    expect(a.steps[0]).toMatchObject({ kind: "notice", label: "操作超出允许范围，已自动重试" });

    a = activityOnVerifyRound(a, { type: "verify-round", round: 1, issues: ["层级跳跃"] } as never, "文档校验未通过，自动修复中", T0 + 100);
    expect(a.steps.at(-1)).toMatchObject({
      kind: "stage",
      name: "verify",
      round: 1,
      label: "文档校验未通过，自动修复中（第 1 轮）",
      detail: "层级跳跃",
    });
  });

  it("finishActivity：error 时仅进行中的工具步骤标红，阶段/思考保持中性", () => {
    let a = activityOnStage(startActivity("a1", T0), stage("model", "模型思考中…"), T0);
    a = activityAppendThought(a, "思考中", T0 + 10);
    a = activityOnToolCall(a, "slide.add", "ppt", T0 + 20);
    const failed = finishActivity(a, "error", T0 + 900, { errorMessage: "炸了" });
    expect(failed.status).toBe("error");
    expect(finishedKinds(failed)).toEqual({ stage: "done", thought: "done", tool: "failed" });
    expect(failed.resultTitle).toBe("执行中断");
    expect(failed.errorMessage).toBe("炸了");

    const canceled = finishActivity(activityOnToolCall(startActivity("a2", T0), "slide.add", "ppt", T0), "canceled", T0 + 100);
    expect(canceled.steps.every((s) => s.status !== "failed")).toBe(true);
    expect(canceled.resultTitle).toContain("已取消");
  });

  it("成功归档标题含操作数与耗时", () => {
    let a = activityOnToolCall(startActivity("a1", T0), "slide.add", "ppt", T0);
    a = activityOnToolResult(a, "slide.add", true, "ok", T0 + 2_300);
    const done = finishActivity(a, "done", T0 + 3_000);
    expect(done.resultTitle).toBe("已完成 · 1 个操作 · 耗时 3s");
    expect(activityDoneOpCount(done)).toBe(1);
  });
});

describe("commandLabel", () => {
  it("ppt/word 命令来自共享工具包的中文 title；UI 工具走内置短语表；未知 id 兜底", () => {
    expect(commandLabel("ppt", "slide.add")).toBe("新增幻灯片");
    expect(commandLabel("ppt", "object.editText")).toBeTruthy();
    expect(commandLabel("word", "word.block.insert")).toBe("插入块");
    expect(commandLabel("ui", "insert_node")).toBe("插入节点");
    expect(commandLabel("ui", "set_token")).toBe("设置设计变量");
    expect(commandLabel("ui", "some_new_tool")).toBe("some new tool");
  });
});

function finishedKinds(a: ReturnType<typeof finishActivity>): Record<string, string> {
  return Object.fromEntries(a.steps.map((s) => [s.kind, s.status]));
}
