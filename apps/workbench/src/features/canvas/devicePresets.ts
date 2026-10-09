import type { Viewport } from "../../state/editorStore";

/**
 * Device page presets (page px) for the free canvas and the preview paper.
 * Sizes match the 视口 labels in PreviewSurface (桌面 1440×900 / 平板 1024×768 /
 * 手机 390×844); desktop mirrors schema-core AUTO_LAYOUT_PAGE.
 */
export const DEVICE_PAGE: Record<Viewport, { w: number; h: number }> = {
  desktop: { w: 1440, h: 900 },
  tablet: { w: 1024, h: 768 },
  mobile: { w: 390, h: 844 },
};
