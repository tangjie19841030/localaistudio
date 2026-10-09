import type { Page, Rect } from "@studio/schema-core";
import { CANVAS_PAGE } from "./canvasGeometry";
import { DEVICE_PAGE } from "./devicePresets";
import type { Viewport } from "../../state/editorStore";

/**
 * Page rect used for drag clamping and fit-to-view. Frames are PAGE-ABSOLUTE
 * and the size follows the device preset (defaults to the desktop baseline
 * CANVAS_PAGE / schema-core AUTO_LAYOUT_PAGE) — the document argument is
 * accepted for call-site symmetry with the frame model.
 */
export function pageRect(doc: Page, device: Viewport = "desktop"): Rect {
  void doc;
  const size = DEVICE_PAGE[device];
  return { x: CANVAS_PAGE.x, y: CANVAS_PAGE.y, w: size.w, h: size.h };
}
