import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Office capability detection (P9.2/P10.2 finishing): probe what the CURRENT
 * machine can actually do before offering PDF/PNG conversion. Everything is a
 * real probe — a missing Office install must surface as `false`, never be
 * faked into an optimistic `true`.
 *
 * - PowerPoint / Word: a Windows COM instantiation probe through PowerShell
 *   (New-Object -ComObject ... then Quit immediately). -NonInteractive plus a
 *   hard spawnSync timeout keeps a stuck COM dialog from hanging the server.
 * - LibreOffice: `where soffice` first, then the common install paths.
 *
 * Results are cached for 60s: COM probes launch real processes and must not
 * run per request.
 */

export interface OfficeCapabilities {
  powerpoint: boolean;
  word: boolean;
  libreoffice: boolean;
}

const CACHE_TTL_MS = 60_000;
/** Hard cap per COM probe; a hung first-run dialog must not block the event loop's sibling. */
const COM_PROBE_TIMEOUT_MS = 8_000;
const WHERE_TIMEOUT_MS = 4_000;

const LIBREOFFICE_INSTALL_PATHS = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];

interface CacheEntry {
  at: number;
  value: OfficeCapabilities;
}

let cache: CacheEntry | null = null;

/** Probe result cache accessor (exported for tests to observe caching). */
export function peekOfficeCapabilitiesCache(): CacheEntry | null {
  return cache;
}

export async function detectOfficeCapabilities(): Promise<OfficeCapabilities> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const value: OfficeCapabilities = {
    powerpoint: detectComApplication("PowerPoint.Application"),
    word: detectComApplication("Word.Application"),
    libreoffice: detectLibreOffice(),
  };
  cache = { at: Date.now(), value };
  return value;
}

/**
 * COM instantiation probe. Exit code 0 == the application object was created
 * and quit cleanly. spawnSync (not async) is deliberate: probes are rare, and
 * the timeout guarantees termination of a stuck powershell child.
 */
function detectComApplication(progid: string): boolean {
  // Quit() may throw if the app auto-registered differently; treat any script
  // failure (non-zero exit) as "not usable".
  const script = `try { $app = New-Object -ComObject ${progid}; if ($app) { $app.Quit(); exit 0 } } catch { exit 1 }; exit 1`;
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout: COM_PROBE_TIMEOUT_MS, windowsHide: true },
  );
  return result.status === 0;
}

/** `where soffice` wins (respects PATH); fall back to common install paths. */
function detectLibreOffice(): boolean {
  const where = spawnSync("where", ["soffice"], {
    timeout: WHERE_TIMEOUT_MS,
    windowsHide: true,
  });
  if (where.status === 0) return true;
  return LIBREOFFICE_INSTALL_PATHS.some((path) => existsSync(path));
}
