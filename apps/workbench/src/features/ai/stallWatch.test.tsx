import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STALL_AFTER_MS, useStallWarn } from "./stallWatch";

describe("useStallWarn 停滞检测", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("15 秒内无新帧：恒不告警；第 16 秒起 stalled=true 且秒数正确", () => {
    const start = Date.now();
    vi.setSystemTime(start);
    const { result } = renderHook((p: { at: number | null }) => useStallWarn(p.at, "streaming"), {
      initialProps: { at: start },
    });
    expect(result.current).toEqual({ stalled: false, seconds: 1 });

    act(() => {
      vi.advanceTimersByTime(14_000); // 14s < 15s：仍不告警
    });
    expect(result.current.stalled).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2_000); // 16s：越过阈值
    });
    expect(result.current).toEqual({ stalled: true, seconds: 16 });

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toEqual({ stalled: true, seconds: 21 });
  });

  it("非 streaming phase：无论多久恒 false（且不启动计时器）", () => {
    const start = Date.now();
    vi.setSystemTime(start);
    const { result } = renderHook(
      (p: { at: number | null; phase: "idle" | "streaming" }) => useStallWarn(p.at, p.phase),
      { initialProps: { at: start, phase: "idle" as const } },
    );
    act(() => {
      vi.advanceTimersByTime(STALL_AFTER_MS + 10_000);
    });
    expect(result.current.stalled).toBe(false);

    act(() => {
      vi.advanceTimersByTime(STALL_AFTER_MS); // 继续空转也恒 false
    });
    expect(result.current.stalled).toBe(false);
  });

  it("streaming 期间新帧到达：lastFrameAt 前推，告警解除", () => {
    const start = Date.now();
    vi.setSystemTime(start);
    const { result, rerender } = renderHook((p: { at: number | null }) => useStallWarn(p.at, "streaming"), {
      initialProps: { at: start },
    });
    act(() => {
      vi.advanceTimersByTime(16_000); // 告警
    });
    expect(result.current.stalled).toBe(true);

    const frameAt = start + 16_000;
    rerender({ at: frameAt }); // 心跳/任意帧刷新时钟
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.stalled).toBe(false);
  });

  it("lastFrameAt=null（send 起点前）不告警", () => {
    const { result } = renderHook(() => useStallWarn(null, "streaming"));
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(result.current.stalled).toBe(false);
  });
});
