import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NodeErrorBoundary } from "./NodeErrorBoundary";

/**
 * 回归：真实模型产出让单个节点渲染抛错时，编辑器必须继续可用
 * （此前一个对象子节点就把整个应用白屏）。
 */
describe("NodeErrorBoundary", () => {
  it("子节点正常时透传渲染", () => {
    render(
      <NodeErrorBoundary nodeId="n1">
        <p>正常内容</p>
      </NodeErrorBoundary>,
    );
    expect(screen.getByText("正常内容")).toBeInTheDocument();
  });

  it("子节点抛错时降级为内联错误卡，不向上传播", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const Boom = () => {
      throw new Error("Objects are not valid as a React child");
    };
    render(
      <NodeErrorBoundary nodeId="bad-node">
        <Boom />
      </NodeErrorBoundary>,
    );
    const alert = screen.getByRole("status");
    expect(alert).toHaveAttribute("data-node-error", "bad-node");
    expect(alert.textContent).toContain("bad-node");
    expect(alert.textContent).toContain("渲染失败");
    spy.mockRestore();
  });
});
