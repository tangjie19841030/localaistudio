import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { detectOfficeCapabilities, type OfficeCapabilities } from "./capabilities.js";

/**
 * PDF/PNG render adapter (P9.2/P10.2 finishing): converts an already-exported
 * OOXML file (.pptx/.docx, written by the toolkit exporters) into PDF or PNG
 * using whatever Office stack this machine really has.
 *
 * Engine priority per conversion:
 * - LibreOffice (soffice --headless --convert-to): preferred, one engine for
 *   both formats. NOTE the limitation: `--convert-to png` renders only the
 *   FIRST page/slide — multipage PNG is out of scope here.
 * - PowerPoint COM (pptx -> pdf via SaveAs 32, pptx -> png via SaveAs 18
 *   which writes a per-slide folder; we keep slide 1 and delete the folder).
 * - Word COM (docx -> pdf via SaveAs 17). Word has no useful PNG export, so
 *   docx->png is LibreOffice-only.
 *
 * When nothing is available the result is `{ ok: false }` and the caller
 * (routes) answers 503 office_unavailable. Results are never faked.
 *
 * All intermediate/output files are expected to live in the project's
 * export/ directory — callers pass that directory as outDir.
 */

export class OfficeRenderError extends Error {}

export type OfficeRenderResult =
  | { ok: true; outputPath: string }
  | { ok: false };

const RENDER_TIMEOUT_MS = 120_000;

/**
 * Kill the WHOLE process tree. child.kill() on Windows terminates only the
 * direct child (soffice.bin / conhost kept running and held the profile lock,
 * cascading every later conversion into failure).
 */
function killTree(child: ReturnType<typeof spawn>): void {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

/** spawn a converter to completion; non-zero exit or timeout -> OfficeRenderError (with its output). */
function runConverter(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group on POSIX so -pid kill reaches helpers.
      detached: process.platform !== "win32",
    });
    let output = "";
    let settled = false;
    const grab = (chunk: Buffer) => {
      if (output.length < 2000) output += chunk.toString("utf8");
    };
    child.stdout?.on("data", grab);
    child.stderr?.on("data", grab);
    const timer = setTimeout(() => {
      killTree(child);
      reject(new OfficeRenderError(`转换超时（${cmd}）`));
    }, RENDER_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new OfficeRenderError(`无法启动 ${cmd}: ${err.message}`));
    });
    child.on("close", (code) => {
      if (settled) return; // timeout already rejected
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        const detail = output.trim().slice(0, 500) || "无输出";
        reject(new OfficeRenderError(`${cmd} 转换失败（退出码 ${code ?? "signal"}）：${detail}`));
      }
    });
  });
}

/**
 * Isolated LibreOffice user profile per conversion: parallel soffice runs
 * sharing the default profile lock each other out (and a crashed previous
 * run wedged the shared one).
 */
function isolatedProfileArgs(inputPath: string, outDir: string, convertTo: string): string[] {
  const profileDir = join(tmpdir(), `studio-lo-${randomUUID()}`).replace(/\\/g, "/");
  return [
    `-env:UserInstallation=file:///${profileDir}`,
    "--headless",
    "--convert-to",
    convertTo,
    "--outdir",
    outDir,
    inputPath,
  ];
}

/** LibreOffice headless convert; output lands in outDir with the same basename. */
async function convertWithLibreOffice(
  inputPath: string,
  outDir: string,
  convertTo: string,
): Promise<string> {
  await runConverter("soffice", isolatedProfileArgs(inputPath, outDir, convertTo));
  const stem = basename(inputPath).replace(/\.[^.]+$/, "");
  const outputPath = join(outDir, `${stem}.${convertTo}`);
  // soffice can exit 0 yet write nothing (bad input); verify before claiming success.
  await fs.access(outputPath);
  return outputPath;
}

/**
 * Run a PowerShell COM script from a temp .ps1 file (-File). The joined
 * -Command one-liner form proved host-killing for multi-statement COM scripts
 * (exit 1 with zero diagnostics), while the file form runs reliably. The
 * launcher lives in the OS temp dir — it is process scaffolding, not a
 * conversion artifact — and is always deleted.
 */
async function runPowerShell(script: string): Promise<void> {
  const file = join(tmpdir(), `studio-office-${randomUUID()}.ps1`);
  // UTF-8 WITH BOM: Windows PowerShell 5.1 reads BOM-less files as ANSI, which
  // garbles every non-ASCII path in the script (project dirs contain Chinese).
  await fs.writeFile(file, "\uFEFF" + script, "utf8");
  try {
    await runConverter("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      file,
    ]);
  } finally {
    await fs.rm(file, { force: true });
  }
}

function psQuote(path: string): string {
  return `'${path.replaceAll("'", "''")}'`;
}

/** PowerPoint COM: pptx -> pdf (SaveAs format 32 = ppSaveAsPDF). */
async function pptxToPdfWithPowerPoint(pptxPath: string, pdfPath: string): Promise<void> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$app = New-Object -ComObject PowerPoint.Application",
    `$pres = $app.Presentations.Open(${psQuote(pptxPath)}, $true, $false, $false)`,
    `$pres.SaveAs(${psQuote(pdfPath)}, 32)`,
    // The artifact is already on disk; flaky COM teardown must not fail the export.
    "try { $pres.Close() } catch { }",
    "try { $app.Quit() } catch { }",
  ].join("; ");
  await runPowerShell(script);
  await fs.access(pdfPath);
}

/** Word COM: docx -> pdf (ExportAsFixedFormat, wdExportFormatPDF = 17). */
async function docxToPdfWithWord(docxPath: string, pdfPath: string): Promise<void> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$app = New-Object -ComObject Word.Application",
    `$doc = $app.Documents.Open(${psQuote(docxPath)}, $false, $true)`,
    `$doc.ExportAsFixedFormat(${psQuote(pdfPath)}, 17)`,
    // The artifact is already on disk; Word sometimes dies before Close/Quit.
    "try { $doc.Close($false) } catch { }",
    "try { $app.Quit() } catch { }",
  ].join("; ");
  await runPowerShell(script);
  await fs.access(pdfPath);
}

/**
 * PowerPoint COM: slide 1 -> png directly via Slide.Export. (SaveAs 18's
 * per-slide folder export proved unreliable with the windowless open.)
 * 1280x720 = the domain canvas at 96-DPI authoring scale.
 */
async function pptxToPngWithPowerPoint(pptxPath: string, pngPath: string): Promise<string> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$app = New-Object -ComObject PowerPoint.Application",
    `$pres = $app.Presentations.Open(${psQuote(pptxPath)}, $true, $false, $false)`,
    `$pres.Slides.Item(1).Export(${psQuote(pngPath)}, 'PNG', 1280, 720)`,
    "$pres.Close()",
    "$app.Quit()",
  ].join("; ");
  await runPowerShell(script);
  await fs.access(pngPath);
  return pngPath;
}

/** pptx -> PDF: LibreOffice first, PowerPoint COM fallback. */
export async function renderPptxToPdf(
  pptxPath: string,
  outDir: string,
  caps?: OfficeCapabilities,
): Promise<OfficeRenderResult> {
  const abilities = caps ?? (await detectOfficeCapabilities());
  if (abilities.libreoffice) {
    const outputPath = await convertWithLibreOffice(pptxPath, outDir, "pdf");
    return { ok: true, outputPath };
  }
  if (abilities.powerpoint) {
    const pdfPath = withExtension(outDir, pptxPath, "pdf");
    await pptxToPdfWithPowerPoint(pptxPath, pdfPath);
    return { ok: true, outputPath: pdfPath };
  }
  return { ok: false };
}

/** docx -> PDF: LibreOffice first, Word COM fallback. */
export async function renderDocxToPdf(
  docxPath: string,
  outDir: string,
  caps?: OfficeCapabilities,
): Promise<OfficeRenderResult> {
  const abilities = caps ?? (await detectOfficeCapabilities());
  if (abilities.libreoffice) {
    const outputPath = await convertWithLibreOffice(docxPath, outDir, "pdf");
    return { ok: true, outputPath };
  }
  if (abilities.word) {
    const pdfPath = withExtension(outDir, docxPath, "pdf");
    await docxToPdfWithWord(docxPath, pdfPath);
    return { ok: true, outputPath: pdfPath };
  }
  return { ok: false };
}

/**
 * pptx -> PNG (first slide only): LibreOffice png or PowerPoint COM folder
 * export; see the file header for the first-page limitation.
 */
export async function renderPptxToPng(
  pptxPath: string,
  outDir: string,
  caps?: OfficeCapabilities,
): Promise<OfficeRenderResult> {
  const abilities = caps ?? (await detectOfficeCapabilities());
  const pngPath = withExtension(outDir, pptxPath, "png");
  if (abilities.libreoffice) {
    // Limitation: --convert-to png emits only the first slide.
    const outputPath = await convertWithLibreOffice(pptxPath, outDir, "png");
    return { ok: true, outputPath };
  }
  if (abilities.powerpoint) {
    const outputPath = await pptxToPngWithPowerPoint(pptxPath, pngPath);
    return { ok: true, outputPath };
  }
  return { ok: false };
}

/**
 * docx -> PNG (first page only, LibreOffice-only; Word COM cannot export PNG).
 * Limitation: --convert-to png emits only the first page.
 */
export async function renderDocxToPng(
  docxPath: string,
  outDir: string,
  caps?: OfficeCapabilities,
): Promise<OfficeRenderResult> {
  const abilities = caps ?? (await detectOfficeCapabilities());
  if (!abilities.libreoffice) return { ok: false };
  const outputPath = await convertWithLibreOffice(docxPath, outDir, "png");
  return { ok: true, outputPath };
}

function withExtension(outDir: string, inputPath: string, ext: string): string {
  const stem = basename(inputPath).replace(/\.[^.]+$/, "");
  return join(outDir, `${stem}.${ext}`);
}
