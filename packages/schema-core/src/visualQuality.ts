import { getComponentDef } from "./registry/componentDefs.js";
import type { Page, Tokens } from "./document.js";

const LEAF_LIMIT = 4;
/** Below this HSV saturation a color reads as black/white/gray. */
const NEUTRAL_SATURATION = 0.1;
/** Weighted RGB distance (0-765 scale) below which two colors look the same. */
const SAME_COLOR_DISTANCE = 32;

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
}

function saturation(hex: string): number {
  const r = channel(hex, 1);
  const g = channel(hex, 3);
  const b = channel(hex, 5);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function colorDistance(a: string, b: string): number {
  const sq = (offset: number, weight: number): number => {
    const diff = (channel(a, offset) - channel(b, offset)) * 255;
    return weight * diff * diff;
  };
  return Math.sqrt(sq(1, 2) + sq(3, 4) + sq(5, 3));
}

function linear(value: number): number {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * linear(channel(hex, 1)) + 0.7152 * linear(channel(hex, 3)) + 0.0722 * linear(channel(hex, 5));
}

function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Brand token checks. Models occasionally ship a neutral or text-colored
 * brand, which reads as "no branding at all". Only brand is checked —
 * surface/text/muted/border are allowed (and expected) to be neutral, and a
 * light surface is fine. One problem, one report: a grayscale brand
 * short-circuits before the text-similarity check to avoid double issues.
 */
function brandIssues(brand: string, text: string): string[] {
  if (saturation(brand) < NEUTRAL_SATURATION) {
    return [`brand 色 ${brand} 是黑白灰；请换成有辨识度的品牌色（蓝/青/绿/橙/紫等有彩度的颜色）`];
  }
  if (colorDistance(brand, text) < SAME_COLOR_DISTANCE) {
    return [`brand 色 ${brand} 与正文色 ${text} 几乎相同；请换用有辨识度的品牌色`];
  }
  return [];
}

/** Deterministic checks for obvious visual regressions in generated UI docs. */
export function visualQualityIssues(page: Page, tokens: Tokens): string[] {
  const issues: string[] = [];
  const root = page.nodes.find((node) => node.id === page.rootId);
  if (!root) return issues;

  const rootChildren = root.children
    .map((id) => page.nodes.find((node) => node.id === id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node));
  const flatLeaves = rootChildren.filter((node) => !getComponentDef(node.type)?.container);
  if (flatLeaves.length > LEAF_LIMIT) {
    issues.push(`根节点直接平铺了 ${flatLeaves.length} 个内容节点；请使用 Stack、Grid 或 Card 组织层级`);
  }

  for (const node of page.nodes) {
    if (node.id !== page.rootId && getComponentDef(node.type)?.container && node.children.length === 0) {
      issues.push(`容器节点 "${node.id}" (${node.type}) 为空；请删除它或填入实际内容`);
    }
  }

  const ratio = contrastRatio(tokens.color.text, tokens.color.surface);
  if (ratio < 4.5) {
    issues.push(`正文文字与页面背景对比度过低（${ratio.toFixed(1)}:1）；请调整 text/surface tokens`);
  }
  issues.push(...brandIssues(tokens.color.brand, tokens.color.text));
  return issues;
}
