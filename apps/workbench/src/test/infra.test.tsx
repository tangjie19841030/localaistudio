import { render, screen } from "@testing-library/react";

// 基础设施自检（Task 9 审查采纳）：
// 1) vitest globals 可用（describe/it/expect 裸用）——保护后续任务的测试风格；
// 2) RTL 自动清理生效（重复标签只命中一次）；
// 3) jsdom 提供 fetch/Response/AbortController（Task 12 API client 依赖）；
// 4) jest-dom 匹配器可用；
// 5) fake-indexeddb 已全局生效（Task 11 Dexie 依赖）。

describe("测试基础设施自检", () => {
  it("globals + jest-dom 匹配器可用", () => {
    render(<h1>唯一标签</h1>);
    expect(screen.getByRole("heading", { name: "唯一标签" })).toBeInTheDocument();
  });

  it("RTL 自动清理：前一个用例的 DOM 不泄漏", () => {
    // 上一个用例渲染过同标签；若 auto-cleanup 未生效，这里会命中 2 个
    render(<h1>唯一标签</h1>);
    expect(screen.getAllByRole("heading", { name: "唯一标签" })).toHaveLength(1);
  });

  it("jsdom 提供 fetch/Response/AbortController", () => {
    expect(typeof fetch).toBe("function");
    expect(typeof Response).toBe("function");
    expect(typeof AbortController).toBe("function");
  });

  it("fake-indexeddb 已全局生效", async () => {
    const req = indexedDB.open("infra-check");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(db.name).toBe("infra-check");
    db.close();
    indexedDB.deleteDatabase("infra-check");
  });
});
