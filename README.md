# Local AI UI Studio

仅供个人使用、默认离线运行的 AI UI 设计与代码生成工具（本地版 "Figma Make Lite"）。
需求文档见 `docs/requirements.md`。

## 快速开始（需 Node >= 22、pnpm >= 11）

```bash
pnpm install
pnpm dev        # 同时启动 server(127.0.0.1:8787) 与 workbench(localhost:5173)
```

浏览器打开 http://localhost:5173 —— 新建项目 → 打开 → 编辑文档名 → Ctrl+S 保存。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 并行启动 server 与 workbench（dev 模式） |
| `pnpm test` | 所有包的单元/组件/集成测试 |
| `pnpm typecheck` | 全部 TypeScript 严格检查（含 e2e 目录） |
| `pnpm build` | 类型检查 + 构建 |
| `pnpm e2e` | Playwright E2E（首次运行前执行 `pnpm exec playwright install chromium`） |

## 结构

```
apps/server        Hono 本地服务（模型代理/文件/预览进程/截图，逐步交付）
apps/workbench     React 三栏工作台（Vite + Tailwind + Zustand + Dexie）
packages/schema-core  纯 TS：页面 Schema、zod 校验、工厂函数
packages/ui-kit    组件唯一真源（P1 起填充，工作台预览与导出项目共用）
e2e/               Playwright 验收测试
data/              运行时数据（含设置与项目，gitignore；可用 STUDIO_DATA_DIR 重定向）
```

## 安全原则

- 本地服务仅监听 127.0.0.1；项目数据默认只写入 `data/` 下应用专属目录。
- API key 等敏感配置存 `data/settings.json`（不入 git）。
