import type { NodeRecord, StudioDocument } from "../document.js";
import { docOfPages, node } from "./types.js";

// ============================================================
// Blog Site — 博客站点组合（列表 list + 文章详情 post）
// ============================================================

/** Blog list top: nav, hero, search, category tabs. */
function listTop(docName: string): NodeRecord[] {
  return [
    node("bs-list-root", "Container", { maxWidth: "md" }, [
      "bs-list-nav", "bs-list-hero", "bs-list-search", "bs-list-tabs",
      "bs-list-featured", "bs-list-latest", "bs-list-page", "bs-list-footer",
    ]),
    node("bs-list-nav", "Nav", { items: ["首页", "前端", "AI 工作流", "设计系统", "关于"] }),
    node("bs-list-hero", "Hero", {
      title: docName,
      subtitle: "关于前端工程、本地 AI 与设计系统的实践笔记。",
      ctaText: "订阅更新",
    }),
    node("bs-list-search", "SearchInput", { placeholder: "搜索文章标题或标签…", value: "" }),
    node("bs-list-tabs", "Tabs", {
      items: ["全部 24", "前端 9", "AI 工作流 7", "设计系统 8"],
      activeIndex: 0,
    }),
  ];
}

/** Blog list body: featured post card and latest posts. */
function listBody(): NodeRecord[] {
  return [
    node("bs-list-featured", "Section", { title: "编辑精选", description: "" }, [
      "bs-list-featured-card",
    ]),
    node("bs-list-featured-card", "Card", {
      title: "在本地跑通 70 亿参数模型之后，我删掉了所有订阅制 AI",
      padded: true,
    }, ["bs-list-featured-stack"]),
    node("bs-list-featured-stack", "Stack", { gap: 2, align: "stretch" }, [
      "bs-list-featured-meta", "bs-list-featured-desc", "bs-list-featured-btn",
    ]),
    node("bs-list-featured-meta", "Text", { content: "AI 工作流 · 2026-09-12 · 约 12 分钟读完", muted: true }),
    node("bs-list-featured-desc", "Text", {
      content: "从模型选型、量化压缩到提示词工程，完整记录把大模型塞进 16GB 内存笔记本的全过程。",
    }),
    node("bs-list-featured-btn", "Button", { label: "阅读全文", variant: "primary", size: "md" }),
    node("bs-list-latest", "Section", { title: "最新文章", description: "" }, ["bs-list-posts"]),
    node("bs-list-posts", "List", {
      items: [
        {
          title: "设计令牌落地指南：从 Figma 变量到 CSS 自定义属性",
          description: "让设计稿与代码共用同一份颜色契约",
          meta: "09-10",
        },
        {
          title: "React 19 并发渲染踩坑记",
          description: "useTransition 在表单场景的三个误区",
          meta: "09-05",
        },
        {
          title: "Tailwind v4 主题系统解析",
          description: "CSS 变量驱动的暗色模式切换",
          meta: "08-28",
        },
        {
          title: "我把构建时间从 4 分钟压到 40 秒",
          description: "缓存策略、按需编译与依赖瘦身",
          meta: "08-21",
        },
        {
          title: "组件库版本发布自动化实践",
          description: "changesets + GitHub Actions 全流程",
          meta: "08-15",
        },
      ],
    }),
  ];
}

/** Blog list close: pagination and footer. */
function listClose(): NodeRecord[] {
  return [
    node("bs-list-page", "Pagination", { page: 1, pageCount: 4 }),
    node("bs-list-footer", "Footer", {
      columns: [
        { title: "栏目", links: ["前端", "AI 工作流", "设计系统"] },
        { title: "订阅", links: ["RSS", "邮件通讯"] },
      ],
      copyright: "© 2026 隔壁老陈的实验室",
    }),
  ];
}

/** Post detail top: breadcrumb, title, meta and opening paragraphs. */
function postTop(): NodeRecord[] {
  return [
    node("bs-post-root", "Container", { maxWidth: "md" }, [
      "bs-post-crumb", "bs-post-header", "bs-post-badge", "bs-post-meta",
      "bs-post-divider", "bs-post-p1", "bs-post-p2", "bs-post-p3",
      "bs-post-code", "bs-post-points", "bs-post-related", "bs-post-footer",
    ]),
    node("bs-post-crumb", "Breadcrumb", { items: ["首页", "博客", "文章详情"] }),
    node("bs-post-header", "Header", {
      title: "在本地跑通 70 亿参数模型之后，我删掉了所有订阅制 AI",
      subtitle: "从模型选型到提示词工程的完整记录",
    }),
    node("bs-post-badge", "Badge", { label: "AI 工作流", tone: "brand" }),
    node("bs-post-meta", "Text", { content: "2026-09-12 发布 · 约 12 分钟读完 · 陈默", muted: true }),
    node("bs-post-divider", "Divider", { orientation: "horizontal", label: "" }),
    node("bs-post-p1", "Text", {
      content: "订阅费一个月 200 元，一年就是 2400 元，而我的需求其实只有三类：补全代码、总结文档、生成测试数据。这篇笔记记录我把这三类需求全部搬回本地的过程。",
    }),
  ];
}

/** Post detail body: paragraphs, code sample, key takeaways, related posts, footer. */
function postBody(): NodeRecord[] {
  return [
    node("bs-post-p2", "Text", {
      content: "模型选型上我最终选了 7B 量级的开源模型：4bit 量化后占用约 5GB 显存，在一块入门级显卡上就能跑到每秒 30 个 token，已经覆盖日常补全场景。",
    }),
    node("bs-post-p3", "Text", {
      content: "提示词工程比想象中更重要。同样是补全函数，把上下文从「整个文件」裁剪到「相关类型定义 + 相邻函数」之后，命中率从 41% 提升到了 78%。",
    }),
    node("bs-post-code", "Card", { title: "初始化本地推理引擎", padded: true }, ["bs-post-code-block"]),
    node("bs-post-code-block", "CodeBlock", {
      code: "const engine = await createEngine({ model: \"qwen3-7b-q4\", ctx: 8192 });",
      language: "ts",
    }),
    node("bs-post-points", "Section", { title: "关键结论", description: "" }, ["bs-post-points-list"]),
    node("bs-post-points-list", "KeyValList", {
      items: [
        { key: "显存占用", value: "4bit 量化后约 5.2 GB" },
        { key: "生成速度", value: "约 30 token/s" },
        { key: "补全命中率", value: "78%（上下文裁剪后）" },
        { key: "月成本", value: "电费约 6 元" },
      ],
    }),
    node("bs-post-related", "Section", { title: "相关阅读", description: "" }, ["bs-post-related-list"]),
    node("bs-post-related-list", "List", {
      items: [
        { title: "提示词工程入门：上下文裁剪的四个原则", meta: "08-30" },
        { title: "本地向量检索：给笔记装上记忆", meta: "08-18" },
      ],
    }),
    node("bs-post-footer", "Footer", {
      columns: [{ title: "订阅", links: ["RSS", "邮件通讯"] }],
      copyright: "© 2026 隔壁老陈的实验室",
    }),
  ];
}

/** Builds the two-page blog site: list + post detail. */
export function buildBlogSite(docName: string): StudioDocument {
  return docOfPages(docName, [
    {
      id: "bs-list",
      name: "博客列表",
      rootId: "bs-list-root",
      nodes: [...listTop(docName), ...listBody(), ...listClose()],
    },
    {
      id: "bs-post",
      name: "文章详情",
      rootId: "bs-post-root",
      nodes: [...postTop(), ...postBody()],
    },
  ]);
}
