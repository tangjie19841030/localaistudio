import { describe, expect, it } from "vitest";
import { createHistory, pushHistory, redoHistory, undoHistory } from "../src/index.js";

describe("generic history", () => {
  it("undoes and redoes arbitrary snapshots", () => {
    const initial = createHistory<{ title: string }>();
    const afterFirst = pushHistory(initial, { title: "before first" }, { transactionId: "one" });
    const undone = undoHistory(afterFirst, { title: "after first" });

    expect(undone?.snapshot).toEqual({ title: "before first" });
    expect(undone?.history.future).toHaveLength(1);

    const redone = redoHistory(undone!.history, undone!.snapshot);
    expect(redone?.snapshot).toEqual({ title: "after first" });
  });

  it("coalesces repeated gestures without losing the first pre-transaction snapshot", () => {
    const initial = createHistory<{ x: number }>();
    const first = pushHistory(initial, { x: 0 }, { transactionId: "drag-1", coalesceKey: "drag:object-1" });
    const second = pushHistory(first, { x: 10 }, { transactionId: "drag-2", coalesceKey: "drag:object-1" });

    expect(second.past).toHaveLength(1);
    expect(undoHistory(second, { x: 20 })?.snapshot).toEqual({ x: 0 });
  });
});
