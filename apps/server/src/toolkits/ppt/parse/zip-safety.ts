import JSZip from "jszip";
import { PptImportError } from "./errors.js";

/**
 * Zip opening with bomb guards: entry count, total/media size, per-entry size
 * and compression ratio are all bounded before any part is read.
 */

const MAX_ENTRIES = 2000;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_ENTRY_BYTES = 30 * 1024 * 1024;
const MAX_MEDIA_BYTES = 150 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;

export interface SafeZip {
  zip: JSZip;
  readText(partPath: string): Promise<string | null>;
  readBuffer(partPath: string): Promise<Buffer | null>;
}

/** jszip stores the sizes only on its internal _data payload. */
function entrySizes(entry: JSZip.JSZipObject): { uncompressed: number; compressed: number } {
  // @ts-expect-error jszip's internal compressed payload carries the sizes.
  const data = entry._data as { uncompressedSize?: number; compressedSize?: number } | null | undefined;
  return { uncompressed: data?.uncompressedSize ?? 0, compressed: data?.compressedSize ?? 0 };
}

/** Reject oversized entries/totals and abnormal compression ratios (zip bombs). */
function assertZipLimits(entries: JSZip.JSZipObject[]): void {
  let total = 0;
  let mediaTotal = 0;
  for (const entry of entries) {
    const size = entrySizes(entry).uncompressed;
    total += size;
    if (entry.name.startsWith("ppt/media/")) mediaTotal += size;
    if (size > MAX_ENTRY_BYTES) {
      throw new PptImportError("文件内单个部件过大，已拒绝（可能是压缩炸弹）");
    }
  }
  if (total > MAX_TOTAL_BYTES || mediaTotal > MAX_MEDIA_BYTES) {
    throw new PptImportError("解压后体积超过上限（200MB），已拒绝");
  }
  for (const entry of entries) {
    const { compressed, uncompressed } = entrySizes(entry);
    if (compressed >= 1024 && uncompressed / compressed > MAX_COMPRESSION_RATIO) {
      throw new PptImportError("压缩比异常（可能是压缩炸弹），已拒绝");
    }
  }
}

export async function openZip(buffer: Uint8Array): Promise<SafeZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new PptImportError("文件已加密或不是有效的 .pptx（无法作为压缩包打开）");
  }
  const entries = Object.values(zip.files);
  if (entries.length === 0 || !zip.file("ppt/presentation.xml")) {
    throw new PptImportError("不是有效的 .pptx：缺少 ppt/presentation.xml");
  }
  if (entries.length > MAX_ENTRIES) {
    throw new PptImportError(`文件结构过于复杂（${entries.length} 个内部文件，上限 ${MAX_ENTRIES}）`);
  }
  assertZipLimits(entries);
  return {
    zip,
    async readText(partPath) {
      const file = zip.file(partPath);
      if (!file) return null;
      return file.async("string");
    },
    async readBuffer(partPath) {
      const file = zip.file(partPath);
      if (!file) return null;
      return file.async("nodebuffer");
    },
  };
}
