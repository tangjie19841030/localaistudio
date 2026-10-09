import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { ProjectsStore } from "../../store/projects.js";
import { jailedPath } from "../../codegen/routes.js";
import { sniffImageAsset, sniffVideo } from "./parse/media.js";

/**
 * Project media assets (PPT): content-hash files under <project>/assets,
 * written either by the .pptx importer or the standalone upload route, read
 * back through GET /api/projects/:id/assets/:file. The AI prompt lists these
 * as the ONLY image/video src values it may use, which stops models from
 * inventing public placeholder URLs that silently fail to load.
 */

/** Content-hash asset names; never trust arbitrary paths. */
export const ASSET_FILE_RE = /^[0-9a-f]{40}\.(png|jpe?g|gif|webp|bmp|mp4|webm)$/;

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** MP4 uploads are the realistic heavy case; 200MB covers deck-length clips. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export class PptAssetError extends Error {}

export interface ProjectAssetInfo {
  file: string;
  /** Ready-to-use image object src. */
  src: string;
  ext: string;
  bytes: number;
}

/** Asset file names the current document's image/video src values actually point at. */
export function referencedAssetFiles(doc: unknown): Set<string> {
  const files = new Set<string>();
  const json = typeof doc === "string" ? doc : safeStringify(doc);
  for (const match of json.matchAll(/assets\/([0-9a-f]{40}\.(?:png|jpe?g|gif|webp|bmp|mp4|webm))/g)) {
    files.add(match[1] as string);
  }
  return files;
}

function safeStringify(doc: unknown): string {
  try {
    return JSON.stringify(doc);
  } catch {
    return "";
  }
}

export interface SavedProjectImage extends ProjectAssetInfo {
  sha1: string;
  contentType: string;
}

export function assetsDirFor(store: ProjectsStore, projectId: string): string {
  return join(store.baseDir, projectId, "assets");
}

export function assetUrl(projectId: string, file: string): string {
  return `/api/projects/${projectId}/assets/${file}`;
}

/** On-disk assets of a project (missing directory → empty list, never throws). */
export async function listProjectAssets(store: ProjectsStore, projectId: string): Promise<ProjectAssetInfo[]> {
  const dir = assetsDirFor(store, projectId);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const infos: ProjectAssetInfo[] = [];
  for (const name of names) {
    if (!ASSET_FILE_RE.test(name)) continue;
    const stat = await fs.stat(join(dir, name)).catch(() => null);
    if (stat?.isFile()) {
      infos.push({
        file: name,
        src: assetUrl(projectId, name),
        ext: name.split(".").pop() ?? "",
        bytes: stat.size,
      });
    }
  }
  return infos.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Validate (magic bytes, never the extension), hash and store one uploaded
 * image. Re-uploading identical bytes is a no-op success.
 */
export async function saveProjectImage(
  store: ProjectsStore,
  projectId: string,
  buffer: Buffer,
): Promise<SavedProjectImage> {
  if (buffer.length === 0) throw new PptAssetError("上传内容为空");
  if (buffer.length > MAX_IMAGE_BYTES) throw new PptAssetError("图片超过 20MB 上限");
  const sniffed = sniffImageAsset(buffer);
  if (!sniffed) {
    throw new PptAssetError("不支持的图片格式，仅支持 PNG / JPEG / GIF / WebP / BMP（SVG 与矢量图暂不支持）");
  }
  const file = `${sniffed.sha1}.${sniffed.ext}`;
  // jailedPath defends even content-derived names against a poisoned store base.
  const target = jailedPath(join(store.baseDir, projectId), join("assets", file));
  await fs.mkdir(join(store.baseDir, projectId, "assets"), { recursive: true });
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, buffer);
  }
  return {
    file,
    src: assetUrl(projectId, file),
    ext: sniffed.ext,
    bytes: buffer.length,
    sha1: sniffed.sha1,
    contentType: sniffed.contentType,
  };
}

/**
 * Validate (magic bytes), hash and store one uploaded video. Deliberately a
 * parallel of saveProjectImage instead of a merged function: images cap at
 * 20MB, videos at 200MB, and the error copy differs (~20 duplicated lines
 * accepted for a narrow patch). Re-uploading identical bytes is a no-op.
 */
export async function saveProjectVideo(
  store: ProjectsStore,
  projectId: string,
  buffer: Buffer,
): Promise<SavedProjectImage> {
  if (buffer.length === 0) throw new PptAssetError("上传内容为空");
  if (buffer.length > MAX_VIDEO_BYTES) throw new PptAssetError("视频超过 200MB 上限");
  const kind = sniffVideo(buffer);
  if (!kind) {
    throw new PptAssetError("不支持的视频格式，仅支持 MP4 / WebM（MOV / AVI / WMV 暂不支持，请先转码为 MP4）");
  }
  const sha1 = createHash("sha1").update(buffer).digest("hex");
  const file = `${sha1}.${kind.ext}`;
  // jailedPath defends even content-derived names against a poisoned store base.
  const target = jailedPath(join(store.baseDir, projectId), join("assets", file));
  await fs.mkdir(join(store.baseDir, projectId, "assets"), { recursive: true });
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, buffer);
  }
  return {
    file,
    src: assetUrl(projectId, file),
    ext: kind.ext,
    bytes: buffer.length,
    sha1,
    contentType: kind.contentType,
  };
}
