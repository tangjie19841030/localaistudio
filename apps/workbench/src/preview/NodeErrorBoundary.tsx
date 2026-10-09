import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Per-node render guard: one malformed AI-generated node must degrade to an
 * inline error card instead of tearing down the whole editor (the real-model
 * crash found in the P6 flow test — an object rendered as a React child
 * blanked the entire app). Renders on white preview paper — fixed slate.
 */

interface BoundaryProps {
  /** What the node tried to render; shown fresh when there is no error. */
  children: ReactNode;
  /** Schema node id for the error label. */
  nodeId: string;
}

interface BoundaryState {
  error: Error | null;
}

export class NodeErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep a console trace for debugging; the UI stays up.
    console.error(`[preview] 节点 ${this.props.nodeId} 渲染失败:`, error.message, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="status"
          data-node-error={this.props.nodeId}
          className="rounded border border-dashed border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600"
        >
          节点 {this.props.nodeId} 渲染失败：{this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
