import type { DocumentEnvelope, SelectionScope, ToolKit } from "@studio/studio-core";
import type { ProjectAssetInfo } from "../toolkits/ppt/assets.js";
import { aiToolsForScope } from "./toolkit-scope.js";

/**
 * System prompt construction for toolkit projects: document JSON + the
 * aiTools admitted for the active scope + per-domain writing discipline
 * (canvas geometry, image rules, id hygiene).
 */

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/**
 * Image rules for PPT turns. The model has NO web/search access: the only
 * image srcs that actually render are project assets (imported or uploaded).
 * Without this, models invent plausible-looking placeholder URLs (live repro:
 * a "cover background" that silently failed to load = "ran but nothing
 * happened"). With zero assets the model must use a shape placeholder and ask
 * the user to upload instead of faking an image.
 */
/** Word image discipline (image blocks use the same project-asset URLs). */
export function wordImageGuideLines(assets: ProjectAssetInfo[]): string[] {
  if (assets.length === 0) {
    return [
      "- 你没有联网/搜图能力：当前项目没有任何图片资产，禁止创建 type=image 块、严禁编造公网图片 URL；需要配图时用一段文字描述，或提示用户先上传图片到项目。",
    ];
  }
  return [
    "- 你没有联网/搜图能力；新建或修改 type=image 块时，src 只能使用下面项目图片资产清单里的真实 URL：",
    ...assets.slice(0, 50).map((asset) => `- ${asset.src}（${asset.ext}）`),
    "严禁编造清单外的 URL；用户没提到图片时不要主动加图。",
  ];
}

export function imageGuideLines(assets: ProjectAssetInfo[]): string[] {
  const lines = [
    '- kind="image" 的图片对象：data.src 【只能】使用下面"项目图片资产"清单里的 URL（原样复制），或使用完整的 data:image/... 内嵌数据；给已存在的图片对象换图用 object.editImage。',
    '- 严禁编造或猜测任何公网图片 URL（picsum.photos、unsplash、placeholder、example.com、百度图片等一律禁止）：你没有联网搜索能力，编造的 URL 在画布中只会加载失败，等于没做。',
  ];
  if (assets.length > 0) {
    lines.push("项目图片资产（以下 src 真实可用，可直接用于 data.src，括号内为文件大小）：");
    for (const asset of assets.slice(0, 50)) {
      lines.push(`- ${asset.src}（${formatBytes(asset.bytes)}）`);
    }
    if (assets.length > 50) lines.push(`- ……另有 ${assets.length - 50} 张未列出`);
  } else {
    lines.push(
      '- 当前项目没有任何图片资产：禁止创建 kind="image" 对象。用户要配图/背景图时，改用 shape 色块（可叠加半透明 shape 做遮罩）+ 文字做"配图位"，并在回复里明确提示用户：点击编辑器工具栏「插入图片」上传图片后，再发一次指令让你把图片放到对应位置。',
    );
  }
  return lines;
}

/**
 * Video rules for PPT turns. Videos must come from real project assets
 * (uploaded via the toolbar's 「插入视频」 or imported); the model has no way
 * to fetch media, so a fabricated URL would render a dead <video> element.
 * With no video assets the model must NOT create kind="video" — it should
 * point the user at the toolbar upload and wait for the next turn.
 */
export function videoGuideLines(assets: ProjectAssetInfo[]): string[] {
  const videos = assets.filter((asset) => asset.ext === "mp4" || asset.ext === "webm");
  if (videos.length > 0) {
    return [
      '- kind="video" 的视频对象：data.src 【只能】使用下面"项目视频资产"清单里的 URL（原样复制）；可选 data.poster 用图片资产 URL 做封面帧；用户明确要"插视频/加视频"时用 object.add kind=video，换源/封面用 object.editVideo。',
      "项目视频资产（以下 src 真实可用，可直接用于 data.src，括号内为文件大小）：",
      ...videos.slice(0, 50).map((asset) => `- ${asset.src}（${formatBytes(asset.bytes)}）`),
    ];
  }
  return [
    '- 当前项目没有任何视频资产：禁止创建 kind="video" 对象、严禁编造视频 URL。用户要视频时，在回复里明确提示：点击编辑器工具栏「插入视频」上传视频文件，再发一次指令让你放置到指定位置。',
  ];
}

/** Selection-scope discipline: object ids vs slide/section ids (per project type). */
function scopeSelectionGuide(toolkit: ToolKit, scope: SelectionScope): string {
  return scope.kind === "selection"
    ? toolkit.projectType === "ppt"
      ? [
          "- scope.targetIds 是【对象 id】，不是幻灯片 id：object.add/object.distribute/object.alignMany 的 slideId 必须传该对象所属幻灯片的 id（查文档 JSON 里 objects 数组所在的 slide.id，如 slide-1），绝不能把 slide-1-subtitle-1 这类对象 id 填进 slideId。",
          ...(scope.targetIds.length > 1
            ? [
                `- 用户【多选】了 ${scope.targetIds.length} 个对象：用户的细节诉求（如统一颜色/字号、对齐、删除、成组）必须对 targetIds 中【每一个】对象分别下达命令，不许只改第一个；先查每个 id 的 kind，再选用对应命令（形状用 object.editShape，文本用 object.editText，表格用 object.editTable，图表用 object.editChart）。`,
              ]
            : []),
        ].join("\n")
      : "- scope.targetIds 是【块 id】，不是章节 id：word.block.insert 的 sectionId 必须传该块所属章节的 id（查文档 JSON 里 blockIds 包含该 id 的 section.id）。"
    : "";
}

/** Per-domain content-writing guide (canvas geometry, object recipes, image rules). */
function contentGuideLines(toolkit: ToolKit, assets: ProjectAssetInfo[], scopeGuide: string): string {
  return toolkit.projectType === "ppt"
    ? [
        "内容写法（PPT）：",
        "- 画布固定 1280×720，所有 rect 必须在画布内。",
        "- 正文必须通过 object.add 新增 kind=\"text\" 的对象：data.paragraphs=[{runs:[{text:\"…\"}]}]，可用 data.fontSize（标题 32–44、正文 16–24）与 data.align；object.editText 只能改已有的 kind=\"text\" 对象。",
        "- kind=\"placeholder\" 的虚线灰框（标题/副标题/内容提示）：object.editText 会把它在原地转成真正的文本对象（同一 id、同一位置），直接传 paragraphs 即可，不需要先删除再重建。",
        "- 形状细节用 object.editShape（shape 改类型 rect/round/ellipse/triangle/arrow；fill/stroke 改颜色，传 null 清除；opacity 0.05–1 控制不透明度，「半透明遮罩/压暗底板」就是调这个，不要删对象）；表格用 object.editTable（整体传 cells 矩阵，rows/cols 自动重算）；图表用 object.editChart（chartType/series/title）；幻灯片背景用 slide.setBackground；多个对象互相对齐用 object.alignMany（object.align 只把单个对象贴到幻灯片边缘，多选不要误用）；组合/取消组合用 object.group、object.ungroup；复制对象用 object.duplicate；层级置顶/置底/上下移用 object.reorder（position: front/back/forward/backward）；object.editText 的 fontSize/align/fontFamily 可只传字段不重发全文（fontFamily 可填 微软雅黑/黑体/宋体/楷体/仿宋/Arial/Times New Roman 等）。",
        "- 选区外的对象不能改：如果用户要求修改的对象不在 scope.targetIds 里，不要硬试（会被拦截），直接告诉用户「请先在画布上选中 XX 对象（或整页）再让我改」。",
        ...imageGuideLines(assets),
        ...videoGuideLines(assets),
        scopeGuide,
      ].filter((line) => line !== "")
      .join("\n")
    : [
        "内容写法（Word）：",
        "- 新增段落用 word.block.insert（参数带 sectionId 与 block 内容，字段以工具 schema 为准）；改写已有段落用 word.block.update-text（runs=[{text:\"…\"}]）。",
        "- 章节操作用 word.section.*；只能引用文档中真实存在的 id。",
        "- 选中列表块用 word.list.update（整体传 items）；选中表格用 word.block.update-table-cell 改单个单元格、word.block.update-table 增删行列；标题层级用 word.heading.set-level；图片块用 word.block.update-image（src/width/caption）；选中范围内的增删改用 word.block.insert/remove/move。",
        ...wordImageGuideLines(assets),
        scopeGuide,
      ].filter((line) => line !== "")
      .join("\n");
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Deck-level fields (everything but slides) — carries no object ids. */
function deckHeader(document: JsonRecord): JsonRecord {
  const header: JsonRecord = {};
  for (const key of Object.keys(document)) {
    if (key !== "slides") header[key] = document[key];
  }
  return header;
}

/** {id,title} pairs for every slide: narrative context WITHOUT object ids. */
function deckOutline(slides: unknown[]): { id: unknown; title: unknown }[] {
  return slides.map((raw) => {
    const slide = asRecord(raw);
    return { id: slide.id, title: slide.title };
  });
}

/**
 * Per-scope document view for the PPT prompt. Dumping the WHOLE document let the
 * model see — and therefore reference — object ids outside the turn's frozen
 * scope promise; every such command was rejected by ensureScopeAllows
 * ("命令超出当前范围: …") until the run aborted (T79 live repro: a selection
 * turn on imp-s16-text325 aborted while editing another slide's object).
 * The view is sliced by scope so the model only ever reads ids it may edit:
 *  - file: full document (unchanged, byte-identical).
 *  - container: the target slides in full + a {id,title} outline of the
 *    REMAINING slides, so narrative context survives without leaking object ids.
 *  - selection: the target objects grouped by their owning slide + the deck
 *    outline of every slide ({id,title}, no objects).
 * Word keeps the full document — its prompts never carried this failure mode.
 */
export function scopedDocumentView(envelope: DocumentEnvelope, scope: SelectionScope): unknown {
  if (envelope.projectType !== "ppt") return envelope.document;
  if (scope.kind === "file") return envelope.document;
  const document = asRecord(envelope.document);
  const slides = asArray(document.slides);
  const targetIds = new Set(scope.targetIds);
  if (scope.kind === "container") {
    const targets = slides.filter((raw) => targetIds.has(String(asRecord(raw).id)));
    const remaining = slides.filter((raw) => !targetIds.has(String(asRecord(raw).id)));
    return { ...deckHeader(document), slides: targets, deckOutline: deckOutline(remaining) };
  }
  // selection: only the targets, each next to the slide it belongs to.
  const groups: { slideId: unknown; objects: unknown[] }[] = [];
  for (const raw of slides) {
    const slide = asRecord(raw);
    const objects = asArray(slide.objects).filter((object) => targetIds.has(String(asRecord(object).id)));
    if (objects.length > 0) groups.push({ slideId: slide.id, objects });
  }
  return { ...deckHeader(document), selection: groups, deckOutline: deckOutline(slides) };
}

/** System prompt: document JSON + the aiTools available for this scope. */
export function buildToolkitSystemPrompt(
  toolkit: ToolKit,
  envelope: DocumentEnvelope,
  scope: SelectionScope,
  assets: ProjectAssetInfo[] = [],
): string {
  const allowed = aiToolsForScope(toolkit, scope);
  const toolLines = allowed
    .map((ai) => `- ${ai.id.replace(/\./g, "_")}（${ai.title}）：可调用命令 ${ai.commandIds.join("、")}`)
    .join("\n");
  const scopeGuide = scopeSelectionGuide(toolkit, scope);
  const contentGuide = contentGuideLines(toolkit, assets, scopeGuide);
  return [
    "你是本地设计工作台的 AI 助手，通过调用命令来修改用户的设计文档。",
    `当前文档：${JSON.stringify(scopedDocumentView(envelope, scope))}`,
    `允许修改的范围：scope.kind=${scope.kind}，targetIds=[${scope.targetIds.join("、")}]。`,
    "可用工具（每次调用携带 commands 数组，元素为 {commandId, args}）：",
    toolLines,
    contentGuide,
    "规则：必须通过工具调用来修改；命令失败时根据错误信息修正参数重试；不要声称完成了实际未执行的修改。",
    "id 纪律：只能引用当前文档里真实存在的对象 id，或由你同一批 commands 里更早的创建类命令（slide.add、复制等）产生的 id；严禁猜测或编造 id。引用新建对象的命令必须与创建命令同批，且创建命令在前。",
    "预声明 id：创建类命令（slide.add / word.block.insert 等）支持可选 id 参数（slideId / blockId / sectionId），建议你自己起语义化 id（如 slide-liangdian-1），并在同批后续命令中直接引用——这样可以一次写完整个计划，零试错。",
    "分批节奏：每轮工具调用完成一个独立小任务（如“创建一页并写好该页标题与备注”），做完就停，等待下一轮。不要试图在一轮里完成所有工作；也不要把已完成的工作重复执行。",
  ].join("\n");
}
