import type { PptSlideObject } from "@studio/ppt-toolkit";

/**
 * Title cleanup: imported templates often carry placeholder filler (lorem ipsum,
 * "Click here to...") or short fragments that survive truncation. When the raw
 * title falls into either bucket, walk to the next meaningful text source on
 * the slide; if none, fall back to "未命名页". Centralized here so the matcher
 * list is the one place to extend.
 */

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /lorem\s+ipsum/i,
  /dolor\s+sit\s+amet/i,
  /click\s+here\s+to/i,
  /sample\s+text/i,
  /placeholder/i,
  /请输入(您的)?标题/,
  /在此处输入/,
  /单击此处/,
];

const FALLBACK_TITLE = "未命名页";

/** Trivial after whitespace strip and pattern match = treat as placeholder. */
export function isPlaceholderTitle(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length <= 1) return true; // e.g. "第"
  return PLACEHOLDER_PATTERNS.some((re) => re.test(trimmed));
}

/** First non-empty, non-placeholder run from any text/placeholder on the slide,
 * in z-order, skipping the title source already tried. */
function fallbackTextSource(
  slideObjects: PptSlideObject[],
  skipTitleText: string,
): string | undefined {
  for (const obj of slideObjects) {
    if (obj.kind === "placeholder") {
      const text = obj.text?.trim();
      if (text && text !== skipTitleText && !isPlaceholderTitle(text)) return text;
    }
  }
  for (const obj of slideObjects) {
    if (obj.kind === "text") {
      for (const p of obj.paragraphs) {
        for (const r of p.runs) {
          const text = r.text.trim();
          if (text && text !== skipTitleText && !isPlaceholderTitle(text)) return text;
        }
      }
    }
  }
  return undefined;
}

/** Resolve a slide title: keep real titles, replace placeholder/fragment
 * titles with the next meaningful text on the slide, else "未命名页". */
export function resolveSlideTitle(
  slideObjects: PptSlideObject[],
  slideNo: number,
  rawTitle: string,
): string {
  if (!isPlaceholderTitle(rawTitle)) return rawTitle.slice(0, 200);
  const candidate = fallbackTextSource(slideObjects, rawTitle.trim());
  const finalTitle = candidate ?? FALLBACK_TITLE;
  return finalTitle.slice(0, 200) || `幻灯片 ${slideNo}`;
}
