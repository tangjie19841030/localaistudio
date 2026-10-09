import {
  componentPropKeys,
  listComponentDefs,
  presetById,
  type Page,
  type StudioDocument,
} from "@studio/schema-core";
import { pageViewForPrompt, pickPage } from "./pageSelection.js";
import type { ChatMode, ChatRequestBody } from "./routes.js";

/**
 * System-prompt builders, extracted from routes.ts to keep that file under
 * the 400-line limit (the streaming-visibility frames needed the room).
 * Pure functions: prompt text in, prompt text out — no I/O, no send calls.
 */

const MODE_HINTS: Record<ChatMode, string> = {
  plan: "plan：返回 JSON，包含规划说明（结构/组件/层级/风险），本次不生成完整文档。",
  generate:
    'generate：返回 JSON，形如 { "plan": "...", "document": <完整 StudioDocument> }，document 必须通过 schema 校验。',
  patch:
    'patch：返回 JSON，形如 { "plan": "...", "ops": [ ... ] }，ops 只允许 tokens.set / node.add / node.remove / node.update / node.move / setFrame。',
};

/**
 * Canvas contract (P5-4): spatial instructions via setFrame. Only patch and
 * generate modes emit it — plan mode never produces ops or documents.
 */
function canvasContract(mode: ChatMode): string {
  if (mode !== "patch" && mode !== "generate") return "";
  return [
    "画布空间契约：用户要求位置/尺寸/旋转变化（如「移到右上角」「放大」）时，用 setFrame 表达：",
    '{"op":"setFrame","nodeId":"<节点id>","frame":{"x":320,"y":80,"w":240,"h":120,"rotation":0}}。',
    "坐标语义：原点为页面画布左上角，单位 px；x/y 是节点左上角，w/h 是尺寸，rotation 为顺时针角度（0-360，可省略默认 0）；页面画布默认 1440×900。",
    "仅当用户明确要求移动/调整该节点时才发 setFrame，不要为用户未提及的节点凭空发明坐标。",
  ].join("\n");
}

/**
 * Page-navigation contract (W3-A): a node may carry a click-to-navigate action.
 * Only patch/generate emit it — plan mode produces no node JSON. pageId is a
 * document-level invariant (checkStudioDocument), so the model is told to reuse
 * an existing page id instead of inventing one.
 */
function navContract(mode: ChatMode): string {
  if (mode !== "patch" && mode !== "generate") return "";
  return [
    "页面跳转契约：需要点击后切换到另一页的节点（如按钮、导航项），在节点 JSON 上加 \"action\":{\"type\":\"navigate\",\"pageId\":\"<目标页id>\"}。",
    "pageId 必须是文档已有页的 id（见上方页面列表），不要发明新页；导出的 demo 里点击该节点即切到目标页。",
    "仅当用户明确要求跳转/切页时才添加 action，不要为用户未提及的节点凭空发明跳转。",
  ].join("\n");
}

/** Responsive-breakpoint contract (W4-A): per-node viewport overrides for whitelisted layout props. */
function breakpointContract(mode: ChatMode): string {
  if (mode !== "patch" && mode !== "generate") return "";
  return [
    "响应式断点契约：需要逐节点响应式的布局（如\"平板 2 列、手机 1 列\"），在该节点 JSON 上加",
    "\"breakpoints\":{\"tablet\":{\"columns\":2},\"mobile\":{\"columns\":1}}。",
    "仅白名单属性可覆盖：Grid.columns/Grid.gap、MetricGrid.columns、Stack.gap；tablet/mobile 二选一或都有；",
    "desktop 不允许覆盖（基础值写在 props 里）。",
    "不要为用户未提及响应式的节点凭空添加 breakpoints。",
  ].join("\n");
}

/** Vector-graphics contract (W5): model-facing mirror of the svgSubset.ts whitelist. */
function svgBoxContract(mode: ChatMode): string {
  if (mode !== "patch" && mode !== "generate") return "";
  return [
    "矢量图形契约：设计稿可用 SvgBox 组件放置简单图标/插画/Logo（如 Hero 装饰、空状态插画、徽标）。",
    'props: {"source":"<svg viewBox=\\"0 0 24 24\\"><path d=\\"...\\"/></svg>","alt":"说明"}。',
    "source 必须是单根 <svg>；仅允许这些元素：svg/path/circle/rect/line/polyline/polygon/g/defs；仅允许几何与填充属性（viewBox/d/fill/stroke/stroke-width 等），禁止 script、事件属性（on*）、style、href/xlink:href、外链引用（url(...)）；总长不超过 20000 字符；不要用 CSS 语法或渐变。",
    '最小正例：<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/></svg>。',
    "仅当内容无法用既有组件表达时才使用 SvgBox（文字用 Text/Heading、图形化数据用图表组件）；同一图标的重复使用应复用同一 source。",
  ].join("\n");
}

function componentCatalog(): string {
  return listComponentDefs()
    .map((d) => `- ${d.type}（${d.title}，${d.container ? "容器" : "叶子"}；属性：${componentPropKeys(d).join("、") || "无"}）`)
    .join("\n");
}

/** Narrow patch context to the scope subtrees of the TARGET page (T21 §3.6);
 *  whole page when nothing matches. The digest stays a StudioDocument (single
 *  page view) so the prompt shape and mock's docFromContext are unchanged. */
function subtreeDigest(doc: StudioDocument, nodeIds: string[], pageId: string | null): StudioDocument {
  const page = pickPage(doc, pageId).page;
  const table = new Map(page.nodes.map((n) => [n.id, n]));
  const inScope = new Set<string>();
  const collect = (id: string): void => {
    const node = table.get(id);
    if (!node || inScope.has(id)) return;
    inScope.add(id);
    node.children.forEach(collect);
  };
  nodeIds.forEach(collect);
  const nodes = page.nodes.filter((n) => inScope.has(n.id));
  const view: Page = nodes.length === 0 ? page : { ...page, nodes };
  return { ...doc, pages: [view] };
}

/**
 * Patch-mode scope constraint: names the only nodes the model may touch.
 * Empty string outside patch mode / without nodeIds, so the prompt is unchanged there.
 */
function scopeConstraint(mode: ChatMode, scope: ChatRequestBody["scope"]): string {
  const nodeIds = mode === "patch" ? scope?.nodeIds : undefined;
  if (!nodeIds?.length) return "";
  return [
    `允许修改的节点 id（仅这些，共 ${nodeIds.length} 个）：${nodeIds.join("、")}`,
    "选中容器内新增子节点：如果上述范围内的节点是容器，可以用 insert_node 把新组件追加到该容器；parentId 必须是范围内的容器。新节点 id 由工具自动生成，不需要预先列在范围内。",
    "不可修改：上述列表之外的任何现有节点、rootId、documentVersion；未获授权时不得改动 tokens。",
    "超出范围的操作会被拦截并要求重做，请严格收敛。",
  ].join("\n");
}

/**
 * Tool-calling contract (P6-3). Without this the real model answers with an
 * empty change set: it has tools attached but was never told to use them
 * (verified live against a real OpenAI-compat endpoint - empty ops, no tool call).
 */
function toolContract(mode: ChatMode): string {
  if (mode === "plan") return "";
  const generateRule =
    mode === "generate"
      ? [
          "- propose_document{document}：提交完整页面文档。",
          "生成模式正确流程：调用 list_components 确认组件后，直接在一次 propose_document 里提交完整的整页文档（root 下所有节点一次性给出）。",
          "⚠ 生成模式禁止逐个调用 insert_node 搭建页面——每个节点单独插会很快耗尽步数预算；insert_node 只用于页面已存在后的局部微调。",
        ].join("\n")
      : "- propose_document{document}：仅在需要整页重建时使用。";
  return [
    "工具调用：你可以调用以下工具来读取与修改文档，而不是一次输出整页 JSON。",
    "- read_document{}：读取当前文档结构（不确定现有节点时先调用）。",
    "- list_components{}：查看可用组件与它们的属性。",
    "- insert_node{type,parentId?,index?,props?}：在指定父节点下插入组件（仅用于局部修改）。",
    "- update_props{nodeId,props}：修改节点属性（文案、样式、列定义等）。",
    "- remove_node{nodeId}：删除节点及其子树。",
    "- move_node{nodeId,newParentId,index?}：移动节点。",
    "- set_frame{nodeId,frame{x,y,w,h,rotation?}}：设置画布位置与尺寸。",
    "- set_token{path,value}：修改设计令牌。",
    generateRule,
    "规则：需要修改就必须调用工具；不要在没有调用任何工具的情况下声称已完成。",
    "工具返回的错误信息是可读的，请据此修正参数后重试，而不是放弃。",
  ].join("\n");
}

/**
 * Token-only patch requests have no node ids, so the generic scope text is
 * intentionally empty. Spell out the semantic palette mapping here; otherwise
 * a model sees permission to call set_token but no concrete value to submit and
 * may finish with an empty tool batch for a request such as "换成暖色".
 */
function tokenContract(mode: ChatMode, scope: ChatRequestBody["scope"]): string {
  if (mode !== "patch" || scope?.allowAllTokens !== true) return "";
  const warm = presetById("warm")?.tokens.color;
  if (!warm) return "";
  const warmValues = Object.entries(warm)
    .map(([key, value]) => `["color","${key}"] → "${value}"`)
    .join("；");
  const nodeRule = scope.nodeIds?.length
    ? "当前仍有节点范围约束；对于本次主题请求只调用 set_token，不要调用 update_props、insert_node、remove_node 或 move_node。其它非令牌请求继续遵守节点范围权限。"
    : "此请求没有节点修改范围；只调用 set_token，不要调用 update_props、insert_node、remove_node 或 move_node。其它非令牌请求仍须遵守节点范围权限。";
  return [
    "令牌专用修改规则（当前 scope.allowAllTokens=true）：",
    "用户提出主题、配色、换色、暖色或品牌色等请求时，这是明确的设计令牌修改请求；必须实际调用一个或多个 set_token，不能以空工具批次或文字确认代替。",
    `自然语言“整体换成暖色品牌色/暖色主题”对应暖橙配色，请逐个调用 set_token(path,value) 应用这些颜色值：${warmValues}。path 必须是二元素数组，value 必须是 #RRGGBB。`,
    nodeRule,
  ].join("\n");
}

/**
 * Visual-quality rules. Without them models emit flat default-styled stacks
 * (verified live: functional pages with default tokens, gap 4 grids, no
 * hierarchy). Every name/prop below exists in listComponentDefs() or
 * tokensSchema, so the model can act on each rule without inventing fields.
 */
function designGuide(): string {
  return [
    "视觉质量规范（每次产出都必须满足，不是可选项）：",
    "1. 结构：禁止把内容平铺在一个容器里。Header 起头，Section/Card 分区，Grid 多列，Stack 控制纵向节奏；相关内容聚成一组，组间留白大于组内留白。",
    "2. 密度与对齐：Grid 的 columns 按内容取 2-4、gap 属性取 2-4（对应 8-16px；默认 gap=4 对应 16px）；横向排列一律用 Grid（Stack 仅支持纵向），同一排卡片宽高一致，禁止错位。",
    "3. 层级：页面主标题 Heading level=1、区块 level=2、卡内 level=3；辅助说明用 Text{muted:true}；关键数字/标题突出、次要信息弱化，禁止整页同一字号。",
    "4. 色彩：generate 模式必须在 tokens 中给出成套协调配色（不要保留默认值）；brand 必须是有辨识度的品牌色（有彩度的蓝/青/绿/橙/紫等），禁止黑、白、灰或与 text 几乎相同的颜色作为 brand；brand 只用于主按钮与关键强调（少于页面 10% 面积），accent 用于选中/高亮，success/warning/danger 只表达状态，surface/border 承载卡片与分隔，text/muted/border/surface 等中性角色允许使用黑白灰与浅色；禁止大面积高饱和底色或每个卡片换一种颜色。",
    "5. 质感：radius.card 取 8-12、radius.control 取 6-8；卡片靠 1px border 加留白区分层级，不堆阴影。",
    "6. 间距：区块间 Stack gap 属性取 4-6（对应 16-24px），卡内内容不贴边（Card.padded=true）；全页间距取 8/16/24 的节奏，不要随机值。",
    "7. 内容真实感：所有文案、数字、列表必须是与主题匹配的真实感中文（数字带单位与趋势，状态用 Badge tone 区分），禁止保留「示例、选项一、0、卡片」等默认占位。",
    "8. 操作层级：主操作 Button{variant:\"primary\"} 每屏最多 1-2 个；次操作 secondary/ghost；危险操作 danger；尺寸按场景选 sm/md/lg。",
    "10. 页面骨架：root 下只允许放 AppShell、Container、Section、Stack、Grid、Card 等布局容器；标题、输入框、按钮、文本等内容必须嵌套在布局容器内，禁止把多个叶子节点直接平铺到 root。",
    "11. 居中卡片页：登录/注册/设置等单任务页面必须使用 Container → Stack(align:center) → Card(padded:true) → Stack 的层级；Card 内按标题、说明、表单、主按钮分组，Stack gap 取 4-6。禁止创建空 Stack 或仅靠连续叶子节点模拟布局。",
  ].join("\n");
}

export function buildSystemPrompt(
  bundle: { meta: { productType: string; targetUsers: string; goal: string; brandRules: string }; document: StudioDocument },
  mode: ChatMode,
  scope: ChatRequestBody["scope"],
  pageId: string | null = null,
): string {
  const { meta, document } = bundle;
  const goal = [meta.productType, meta.targetUsers, meta.goal].filter(Boolean).join(" / ");
  const { page, pageList } = pageViewForPrompt(document, pageId);
  const docJson =
    mode === "patch" && scope?.nodeIds?.length
      ? JSON.stringify(subtreeDigest(document, scope.nodeIds, pageId))
      : JSON.stringify({ ...document, pages: [page] });
  return [
    "你是本地 UI 设计工作台的 AI 助手，根据用户需求产出结构化 JSON。",
    "可用组件目录：",
    componentCatalog(),
    `项目目标：${goal || "未填写"}`,
    `品牌规则：${meta.brandRules || "无"}`,
    designGuide(),
    `文档共 ${document.pages.length} 页：${pageList}`,
    `当前文档（mode=patch 时为选中子树）：${docJson}`,
    "以上 JSON 是当前活动页的视图；其他页面无法通过工具修改（v1 无建页/删页工具）。",
    "props 只能使用目录列出的属性字段；未声明字段会使整页提案被拒绝并要求修正。",
    canvasContract(mode),
    navContract(mode),
    breakpointContract(mode),
    svgBoxContract(mode),
    scopeConstraint(mode, scope),
    toolContract(mode),
    tokenContract(mode, scope),
    `输出要求（mode=${mode}）：${MODE_HINTS[mode]}`,
    "只输出 JSON，不要 markdown 代码围栏。",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
