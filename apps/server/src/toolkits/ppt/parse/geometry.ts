import { SLIDE_HEIGHT, SLIDE_WIDTH, type Rect } from "@studio/ppt-toolkit";
import { asObj, intAttr, strAttr, type XmlNode } from "./xml-util.js";

/**
 * Geometry: EMU space → fixed 1280x720 canvas, equal contain fit, centered,
 * with the affine group-transform math (scale + translate; rot/flip dropped)
 * and flipped-rect normalization shared by every object collector.
 */

export const EMU_PER_PX = 9525;

export interface Fit {
  scale: number; // px per EMU
  offsetX: number;
  offsetY: number;
}

export function computeFit(srcWEmu: number, srcHEmu: number): Fit {
  const srcW = srcWEmu / EMU_PER_PX;
  const srcH = srcHEmu / EMU_PER_PX;
  const rawScale = Math.min(SLIDE_WIDTH / srcW, SLIDE_HEIGHT / srcH);
  // Degenerate sldSz (0/missing) must not poison every rect with Infinity.
  const scale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
  return {
    scale: scale / EMU_PER_PX,
    offsetX: Number.isFinite(srcW) ? (SLIDE_WIDTH - srcW * scale) / 2 : 0,
    offsetY: Number.isFinite(srcH) ? (SLIDE_HEIGHT - srcH * scale) / 2 : 0,
  };
}

/** Affine 2D transform in EMU space (scale + translate only; rot/flip dropped). */
export interface Affine {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export const IDENTITY: Affine = { sx: 1, sy: 1, tx: 0, ty: 0 };

export function compose(parent: Affine, child: Affine): Affine {
  return {
    sx: parent.sx * child.sx,
    sy: parent.sy * child.sy,
    tx: parent.tx + parent.sx * child.tx,
    ty: parent.ty + parent.sy * child.ty,
  };
}

export function groupAffine(xfrm: XmlNode | undefined): Affine {
  const off = asObj(xfrm?.off);
  const ext = asObj(xfrm?.ext);
  const chOff = asObj(xfrm?.chOff);
  const chExt = asObj(xfrm?.chExt);
  const ox = intAttr(off, "x") ?? 0;
  const oy = intAttr(off, "y") ?? 0;
  const cx = intAttr(ext, "cx") ?? 0;
  const cy = intAttr(ext, "cy") ?? 0;
  const chx = intAttr(chOff, "x") ?? 0;
  const chy = intAttr(chOff, "y") ?? 0;
  const chcx = intAttr(chExt, "cx") ?? 1;
  const chcy = intAttr(chExt, "cy") ?? 1;
  const sx = cx / chcx;
  const sy = cy / chcy;
  const flipH = strAttr(xfrm, "flipH") === "1";
  const flipV = strAttr(xfrm, "flipV") === "1";
  return {
    sx: flipH ? -sx : sx,
    sy: flipV ? -sy : sy,
    tx: flipH ? ox + cx + chx * sx : ox - chx * sx,
    ty: flipV ? oy + cy + chy * sy : oy - chy * sy,
  };
}

export function toCanvasRect(xfrm: XmlNode | undefined, matrix: Affine, fit: Fit): Rect | null {
  const off = asObj(xfrm?.off);
  const ext = asObj(xfrm?.ext);
  const ox = intAttr(off, "x");
  const oy = intAttr(off, "y");
  const cx = intAttr(ext, "cx");
  const cy = intAttr(ext, "cy");
  if (ox === undefined || oy === undefined || cx === undefined || cy === undefined) return null;
  if (cx <= 0 || cy <= 0) return null;
  const xEmu = matrix.tx + matrix.sx * ox;
  const yEmu = matrix.ty + matrix.sy * oy;
  const rawX = xEmu * fit.scale + fit.offsetX;
  const rawY = yEmu * fit.scale + fit.offsetY;
  const rawW = matrix.sx * cx * fit.scale;
  const rawH = matrix.sy * cy * fit.scale;
  // Normalize flipped transforms into a positive canvas rectangle. The domain
  // stores rectangles only; preserving the bounds keeps group flips usable.
  const left = Math.min(rawX, rawX + rawW);
  const top = Math.min(rawY, rawY + rawH);
  const width = Math.abs(rawW);
  const height = Math.abs(rawH);
  // NaN/Infinity (bad transform / degenerate slide size) → drop this object;
  // it must not reach finalize validation and kill the whole import.
  if (![left, top, width, height].every(Number.isFinite)) return null;
  let x = Math.round(left * 100) / 100;
  let y = Math.round(top * 100) / 100;
  let w = Math.round(width * 100) / 100;
  let h = Math.round(height * 100) / 100;
  // Symmetric bring-in for ALL four edges: real decks commonly park objects
  // just outside the right/bottom edge; previously only negatives were pulled
  // back so one bleed object rejected the entire file at schema validation.
  x = Math.min(Math.max(x, 0), SLIDE_WIDTH - 1);
  y = Math.min(Math.max(y, 0), SLIDE_HEIGHT - 1);
  w = Math.max(1, Math.min(w, SLIDE_WIDTH - x));
  h = Math.max(1, Math.min(h, SLIDE_HEIGHT - y));
  return { x, y, w, h };
}
