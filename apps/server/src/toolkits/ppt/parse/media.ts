import { createHash } from "node:crypto";

/**
 * Magic-byte image sniffing (extension/type NEVER trusted from zip names) plus
 * the content-hashed standalone-asset variant shared with the upload route.
 */

export interface ImageKind {
  ext: string;
  contentType: string;
}

export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: "png", contentType: "image/png" };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpeg", contentType: "image/jpeg" };
  }
  if (buf.length >= 6 && buf.subarray(0, 6).toString("ascii") === "GIF87a") {
    return { ext: "gif", contentType: "image/gif" };
  }
  if (buf.length >= 6 && buf.subarray(0, 6).toString("ascii") === "GIF89a") {
    return { ext: "gif", contentType: "image/gif" };
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { ext: "webp", contentType: "image/webp" };
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) {
    return { ext: "bmp", contentType: "image/bmp" };
  }
  return null; // svg/emf/wmf/tiff/mp4/… intentionally unsupported
}

/**
 * Magic-byte video sniffing for the PPT insert-video loop. Only mp4/webm are
 * accepted (browsers play them natively via <video>); mov/avi/wmv fall through
 * to null and the importer renders a grey placeholder with a warning instead.
 * Reuses the ImageKind shape to avoid a parallel type — name is historical.
 */
export function sniffVideo(buf: Buffer): ImageKind | null {
  // MP4: "ftyp" box signature at bytes 4-7.
  if (buf.length >= 8 && buf.subarray(4, 8).toString("ascii") === "ftyp") {
    return { ext: "mp4", contentType: "video/mp4" };
  }
  // WebM: EBML magic 1A 45 DF A3 at bytes 0-4.
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { ext: "webm", contentType: "video/webm" };
  }
  return null;
}

export interface SniffedImage {
  sha1: string;
  ext: string;
  contentType: string;
}

/**
 * Magic-byte sniff + content hash for a standalone image upload (the manual
 * asset-upload route reuses this so imports and uploads can never disagree
 * about accepted formats or naming). Returns null for anything not in the
 * supported raster set (svg/emf/wmf/tiff/… rejected).
 */
export function sniffImageAsset(buf: Buffer): SniffedImage | null {
  const kind = sniffImage(buf);
  if (!kind) return null;
  return { sha1: createHash("sha1").update(buf).digest("hex"), ...kind };
}
