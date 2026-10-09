import { describe, expect, it } from "vitest";
import {
  ISSUE_KIND_LABELS,
  ISSUE_KIND_SEVERITY,
  affectedStudioIds,
  auditPage,
  auditPages,
  summarize,
  type A11yElementMetric,
  type ElementMetric,
  type Issue,
  type IssueKind,
  type PageMetrics,
  type PageSeoMetrics,
} from "../src/visual/audit.js";
import { VIEWPORTS, viewportByName } from "../src/visual/viewports.js";

const EMPTY_SEO: PageSeoMetrics = {
  title: "页面",
  description: "说明",
  lang: "zh-CN",
  viewportMeta: true,
  h1Count: 1,
};

function metrics(patch: Partial<PageMetrics> = {}): PageMetrics {
  return {
    viewport: "desktop",
    docScrollWidth: 1440,
    docClientWidth: 1440,
    elements: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    a11y: [],
    seo: { ...EMPTY_SEO },
    ...patch,
  };
}

function element(patch: Partial<ElementMetric> = {}): ElementMetric {
  return {
    selector: "div",
    text: "",
    scrollWidth: 100,
    clientWidth: 100,
    rect: { x: 0, y: 0, width: 100, height: 20 },
    interactive: false,
    ancestorSelectors: [],
    ...patch,
  };
}

const kinds = (issues: Issue[]) => issues.map((i) => i.kind);

describe("viewports：三视口单一真源", () => {
  it("包含 desktop/tablet/mobile 及规格尺寸", () => {
    expect(VIEWPORTS.map((v) => v.name)).toEqual(["desktop", "tablet", "mobile"]);
    expect(VIEWPORTS.map((v) => [v.width, v.height])).toEqual([
      [1440, 900],
      [1024, 768],
      [390, 844],
    ]);
  });

  it("viewportByName 返回对应规格", () => {
    expect(viewportByName("mobile")).toEqual({ name: "mobile", width: 390, height: 844 });
    expect(viewportByName("tablet").width).toBe(1024);
  });
});

describe("auditPage：空 metrics", () => {
  it("无元素无错误 → 空清单", () => {
    expect(auditPage(metrics())).toEqual([]);
  });
});

describe("auditPage：横向溢出", () => {
  it("正例：scrollWidth 明显超过 clientWidth → error 级 horizontal-overflow", () => {
    const issues = auditPage(metrics({ docScrollWidth: 1600, docClientWidth: 1440 }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("horizontal-overflow");
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.viewport).toBe("desktop");
    expect(issues[0]!.message).toContain("横向溢出");
    expect(issues[0]!.message).toContain("1600");
    expect(issues[0]!.message).toContain("1440");
  });

  it("反例：相等宽度不报", () => {
    expect(auditPage(metrics({ docScrollWidth: 1440, docClientWidth: 1440 }))).toEqual([]);
  });

  it("反例：亚像素容差（+1px）不误报", () => {
    expect(auditPage(metrics({ docScrollWidth: 1441, docClientWidth: 1440 }))).toEqual([]);
  });

  it("正例：超出容差 1px 后（+2px）才报", () => {
    expect(kinds(auditPage(metrics({ docScrollWidth: 1442, docClientWidth: 1440 })))).toEqual([
      "horizontal-overflow",
    ]);
  });
});

describe("auditPage：文本截断", () => {
  it("正例：有文本且 scrollWidth 超出 → warn 级 text-truncation，带 selector", () => {
    const issues = auditPage(
      metrics({
        elements: [
          element({ selector: "div.card > h3", text: "很长的标题文本", scrollWidth: 240, clientWidth: 120 }),
        ],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("text-truncation");
    expect(issues[0]!.severity).toBe("warn");
    expect(issues[0]!.selector).toBe("div.card > h3");
    expect(issues[0]!.message).toContain("文本截断");
  });

  it("反例：空文本元素即使溢出也不报", () => {
    expect(
      auditPage(metrics({ elements: [element({ text: "", scrollWidth: 400, clientWidth: 100 })] })),
    ).toEqual([]);
  });

  it("反例：亚像素容差（clientWidth + 1）不误报", () => {
    expect(
      auditPage(metrics({ elements: [element({ text: "刚好", scrollWidth: 101, clientWidth: 100 })] })),
    ).toEqual([]);
  });

  it("带 data-studio-id 时写入 studioIds", () => {
    const issues = auditPage(
      metrics({
        elements: [
          element({ selector: "h3", studioId: "node-1", text: "标题", scrollWidth: 200, clientWidth: 100 }),
        ],
      }),
    );
    expect(issues[0]!.studioIds).toEqual(["node-1"]);
  });
});

describe("auditPage：交互元素重叠", () => {
  const overlapping = (patch: Partial<ElementMetric> = {}) => [
    element({
      selector: "button.a",
      studioId: "btn-a",
      interactive: true,
      rect: { x: 0, y: 0, width: 100, height: 40 },
    }),
    element({
      selector: "button.b",
      studioId: "btn-b",
      interactive: true,
      rect: { x: 50, y: 0, width: 100, height: 40 },
      ...patch,
    }),
  ];

  it("正例：两个交互元素交集超过较小面积 25% → warn 级 overlap", () => {
    const issues = auditPage(metrics({ elements: overlapping() }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("overlap");
    expect(issues[0]!.severity).toBe("warn");
    expect(issues[0]!.selectors).toEqual(["button.a", "button.b"]);
    expect(issues[0]!.studioIds).toEqual(["btn-a", "btn-b"]);
    expect(issues[0]!.message).toContain("控件重叠");
  });

  it("反例：非交互元素重叠不报", () => {
    const els = overlapping().map((e) => ({ ...e, interactive: false }));
    expect(auditPage(metrics({ elements: els }))).toEqual([]);
  });

  it("反例：一方非交互不报", () => {
    const els = overlapping();
    els[1] = { ...els[1]!, interactive: false };
    expect(auditPage(metrics({ elements: els }))).toEqual([]);
  });

  it("反例：嵌套的交互元素（祖先/后代）不算重叠", () => {
    const els = [
      element({
        selector: "a.wrapper",
        interactive: true,
        rect: { x: 0, y: 0, width: 200, height: 40 },
      }),
      element({
        selector: "a.wrapper > button.icon",
        interactive: true,
        rect: { x: 4, y: 4, width: 32, height: 32 },
        ancestorSelectors: ["a.wrapper", "body"],
      }),
    ];
    expect(auditPage(metrics({ elements: els }))).toEqual([]);
  });

  it("反例：细缝交集（低于较小面积 25%）不算重叠", () => {
    // 交集 5x40 = 200；较小面积 100x40 = 4000 → 5% < 25%
    const issues = auditPage(
      metrics({ elements: overlapping({ rect: { x: 95, y: 0, width: 100, height: 40 } }) }),
    );
    expect(issues).toEqual([]);
  });

  it("反例：零面积矩形不算重叠", () => {
    const issues = auditPage(
      metrics({ elements: overlapping({ rect: { x: 0, y: 0, width: 0, height: 40 } }) }),
    );
    expect(issues).toEqual([]);
  });

  it("反例：完全不相交不报", () => {
    const issues = auditPage(
      metrics({ elements: overlapping({ rect: { x: 300, y: 0, width: 100, height: 40 } }) }),
    );
    expect(issues).toEqual([]);
  });
});

describe("auditPage：console / pageerror / requestfailed", () => {
  it("正例：每条 console 错误一条 error 级 issue", () => {
    const issues = auditPage(metrics({ consoleErrors: ["boom", "bang"] }));
    expect(kinds(issues)).toEqual(["console-error", "console-error"]);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
    expect(issues[0]!.message).toContain("boom");
  });

  it("正例：page error 为 error 级", () => {
    const issues = auditPage(metrics({ pageErrors: ["TypeError: x"] }));
    expect(kinds(issues)).toEqual(["page-error"]);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toContain("TypeError: x");
  });

  it("正例：失败请求为 warn 级", () => {
    const issues = auditPage(metrics({ failedRequests: ["/missing.png"] }));
    expect(kinds(issues)).toEqual(["request-failed"]);
    expect(issues[0]!.severity).toBe("warn");
    expect(issues[0]!.message).toContain("/missing.png");
  });

  it("反例：空数组不产生 issue", () => {
    expect(auditPage(metrics({ consoleErrors: [], pageErrors: [], failedRequests: [] }))).toEqual([]);
  });
});

describe("auditPages：多视口汇总", () => {
  it("按视口拼接并给每条 issue 打上正确视口标记", () => {
    const issues = auditPages([
      metrics({ viewport: "desktop", consoleErrors: ["e1"] }),
      metrics({ viewport: "mobile", docScrollWidth: 500, docClientWidth: 390 }),
    ]);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ viewport: "desktop", kind: "console-error" });
    expect(issues[1]).toMatchObject({ viewport: "mobile", kind: "horizontal-overflow" });
  });

  it("空输入 → 空清单", () => {
    expect(auditPages([])).toEqual([]);
  });
});

describe("summarize", () => {
  it("总数、分类计数、error/warn 计数正确", () => {
    const issues = auditPages([
      metrics({ viewport: "desktop", consoleErrors: ["a", "b"], pageErrors: ["c"] }),
      metrics({
        viewport: "mobile",
        docScrollWidth: 500,
        docClientWidth: 390,
        failedRequests: ["/x.png"],
        elements: [element({ text: "长文本", scrollWidth: 300, clientWidth: 100 })],
      }),
    ]);
    const s = summarize(issues);
    expect(s.total).toBe(6);
    expect(s.byKind["console-error"]).toBe(2);
    expect(s.byKind["page-error"]).toBe(1);
    expect(s.byKind["horizontal-overflow"]).toBe(1);
    expect(s.byKind["request-failed"]).toBe(1);
    expect(s.byKind["text-truncation"]).toBe(1);
    expect(s.byKind.overlap).toBe(0);
    expect(s.errorCount).toBe(4);
    expect(s.warnCount).toBe(2);
  });

  it("空清单 → 全零且各 kind 键齐全", () => {
    const s = summarize([]);
    expect(s).toEqual({
      total: 0,
      byKind: {
        "horizontal-overflow": 0,
        "text-truncation": 0,
        overlap: 0,
        "console-error": 0,
        "page-error": 0,
        "request-failed": 0,
        "a11y-image-alt": 0,
        "a11y-control-name": 0,
        "a11y-link-name": 0,
        "a11y-heading-order": 0,
        "seo-title": 0,
        "seo-description": 0,
        "seo-h1": 0,
      },
      errorCount: 0,
      warnCount: 0,
    });
  });
});

describe("affectedStudioIds", () => {
  it("去重并跳过没有 studioIds 的 issue", () => {
    const issues = auditPages([
      metrics({
        viewport: "desktop",
        consoleErrors: ["no-node"],
        elements: [
          element({ selector: "h3", studioId: "n1", text: "长", scrollWidth: 300, clientWidth: 10 }),
          element({ selector: "p", studioId: "n1", text: "长", scrollWidth: 300, clientWidth: 10 }),
          element({ selector: "span", studioId: "n2", text: "长", scrollWidth: 300, clientWidth: 10 }),
        ],
      }),
    ]);
    expect(affectedStudioIds(issues)).toEqual(["n1", "n2"]);
  });

  it("无 studioId → 空数组", () => {
    expect(affectedStudioIds(auditPage(metrics({ pageErrors: ["x"] })))).toEqual([]);
  });
});

function a11yMetric(patch: Partial<A11yElementMetric>): A11yElementMetric {
  return {
    selector: "div > img",
    kind: "image",
    text: "",
    accessibleName: "",
    ...patch,
  };
}

function seoMetrics(patch: Partial<PageSeoMetrics> = {}): PageSeoMetrics {
  return { ...EMPTY_SEO, ...patch };
}

describe("auditPage：图片 alt", () => {
  it("正例：img 缺 alt → error 级 a11y-image-alt，带 selector 与 studioId", () => {
    const issues = auditPage(
      metrics({ a11y: [a11yMetric({ selector: "div > img", studioId: "n1", accessibleName: "" })] }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("a11y-image-alt");
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.selector).toBe("div > img");
    expect(issues[0]!.studioIds).toEqual(["n1"]);
    expect(issues[0]!.message).toContain("alt");
  });

  it("正例：alt 全是空白仍报错", () => {
    const issues = auditPage(
      metrics({ a11y: [a11yMetric({ accessibleName: "   " })] }),
    );
    expect(issues[0]!.kind).toBe("a11y-image-alt");
  });

  it("反例：非 image 类型忽略；image 有 alt 不报", () => {
    expect(
      auditPage(
        metrics({
          a11y: [
            a11yMetric({ kind: "control", accessibleName: "提交" }),
            a11yMetric({ kind: "image", accessibleName: "logo" }),
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe("auditPage：控件 / 链接可访问名", () => {
  it("正例：button 无文本 → a11y-control-name error", () => {
    const issues = auditPage(
      metrics({
        a11y: [
          a11yMetric({ kind: "control", selector: "div > button", studioId: "n2", text: "", accessibleName: "" }),
        ],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("a11y-control-name");
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.studioIds).toEqual(["n2"]);
  });

  it("正例：a[href] 无文本 → a11y-link-name error", () => {
    const issues = auditPage(
      metrics({
        a11y: [
          a11yMetric({ kind: "link", selector: "body > a", studioId: "n3", text: "", accessibleName: "" }),
        ],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("a11y-link-name");
    expect(issues[0]!.severity).toBe("error");
  });

  it("反例：控件 / 链接有可访问名不报", () => {
    expect(
      auditPage(
        metrics({
          a11y: [
            a11yMetric({ kind: "control", text: "提交", accessibleName: "提交" }),
            a11yMetric({ kind: "link", text: "了解更多", accessibleName: "了解更多" }),
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe("auditPage：标题层级", () => {
  it("正例：h1 直接接 h3 → warn 级 a11y-heading-order，带前一个 selector", () => {
    const issues = auditPage(
      metrics({
        a11y: [
          a11yMetric({ kind: "heading", selector: "h1", level: 1, text: "标题", accessibleName: "标题" }),
          a11yMetric({ kind: "heading", selector: "h3", level: 3, text: "子节", accessibleName: "子节", studioId: "n4" }),
        ],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("a11y-heading-order");
    expect(issues[0]!.severity).toBe("warn");
    expect(issues[0]!.selector).toBe("h3");
    expect(issues[0]!.studioIds).toEqual(["n4"]);
    expect(issues[0]!.message).toContain("h1");
    expect(issues[0]!.message).toContain("h3");
  });

  it("反例：顺序 h1 -> h2 -> h3 不报", () => {
    expect(
      auditPage(
        metrics({
          a11y: [
            a11yMetric({ kind: "heading", level: 1, text: "T" }),
            a11yMetric({ kind: "heading", level: 2, text: "S" }),
            a11yMetric({ kind: "heading", level: 3, text: "SS" }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("反例：往上回到低层级 (h3 -> h2) 不算跳级", () => {
    expect(
      auditPage(
        metrics({
          a11y: [
            a11yMetric({ kind: "heading", level: 3 }),
            a11yMetric({ kind: "heading", level: 2 }),
            a11yMetric({ kind: "heading", level: 1 }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("反例：单一标题不报", () => {
    expect(auditPage(metrics({ a11y: [a11yMetric({ kind: "heading", level: 2 })] }))).toEqual([]);
  });
});

describe("auditPage：SEO", () => {
  it("正例：title 为空 → seo-title error", () => {
    const issues = auditPage(metrics({ seo: seoMetrics({ title: "" }) }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("seo-title");
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toContain("标题");
  });

  it("正例：description 为空 → seo-description warn", () => {
    const issues = auditPage(metrics({ seo: seoMetrics({ description: "" }) }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("seo-description");
    expect(issues[0]!.severity).toBe("warn");
  });

  it("正例：h1 数量为 0 / 2 → seo-h1 warn", () => {
    expect(auditPage(metrics({ seo: seoMetrics({ h1Count: 0 }) }))[0]!.kind).toBe("seo-h1");
    const two = auditPage(metrics({ seo: seoMetrics({ h1Count: 2 }) }));
    expect(two).toHaveLength(1);
    expect(two[0]!.kind).toBe("seo-h1");
    expect(two[0]!.severity).toBe("warn");
    expect(two[0]!.message).toContain("2");
  });

  it("反例：title / description / h1 都健康 → 空清单", () => {
    expect(auditPage(metrics({ seo: seoMetrics() }))).toEqual([]);
  });

  it("反例：description 仅含空白仍算缺失", () => {
    const issues = auditPage(metrics({ seo: seoMetrics({ description: "  \t\n  " }) }));
    expect(issues[0]!.kind).toBe("seo-description");
  });
});

describe("ISSUE_KIND_LABELS / ISSUE_KIND_SEVERITY", () => {
  it("ISSUE_KIND_LABELS 与 IssueKind 一一对应且非空", () => {
    const kinds = Object.keys(ISSUE_KIND_LABELS) as IssueKind[];
    expect(kinds.length).toBeGreaterThanOrEqual(13);
    for (const kind of kinds) {
      expect(ISSUE_KIND_LABELS[kind]).not.toBe("");
    }
  });

  it("ISSUE_KIND_SEVERITY 与 IssueKind 一一对应且只取 error / warn", () => {
    const kinds = Object.keys(ISSUE_KIND_SEVERITY) as IssueKind[];
    for (const kind of kinds) {
      const s = ISSUE_KIND_SEVERITY[kind];
      expect(s === "error" || s === "warn").toBe(true);
    }
  });

  it("关键标签 / 严重级别与设计 §4.3 一致", () => {
    expect(ISSUE_KIND_LABELS["a11y-image-alt"]).toContain("alt");
    expect(ISSUE_KIND_LABELS["seo-title"]).toContain("标题");
    expect(ISSUE_KIND_SEVERITY["a11y-heading-order"]).toBe("warn");
    expect(ISSUE_KIND_SEVERITY["seo-description"]).toBe("warn");
  });
});

describe("auditPages：a11y / seo 视口汇总", () => {
  it("每视口独立判定，三视口各报一条 seo-title", () => {
    const empty = seoMetrics({ title: "" });
    const issues = auditPages([
      metrics({ viewport: "desktop", seo: empty }),
      metrics({ viewport: "tablet", seo: empty }),
      metrics({ viewport: "mobile", seo: empty }),
    ]);
    expect(issues).toHaveLength(3);
    expect(issues.every((i) => i.kind === "seo-title")).toBe(true);
    expect(issues.map((i) => i.viewport)).toEqual(["desktop", "tablet", "mobile"]);
  });
});

describe("affectedStudioIds（新 a11y）", () => {
  it("a11y-image-alt 的 studioId 进 affectedStudioIds", () => {
    const issues = auditPage(
      metrics({
        a11y: [a11yMetric({ studioId: "img-1", accessibleName: "" })],
      }),
    );
    expect(affectedStudioIds(issues)).toEqual(["img-1"]);
  });

  it("seo-* 不带 studioId / selectors → 空数组", () => {
    const issues = auditPage(metrics({ seo: seoMetrics({ title: "" }) }));
    expect(affectedStudioIds(issues)).toEqual([]);
  });
});
