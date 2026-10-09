import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** Same http(s)-only URL rule as schema-core project.ts — javascript:/data: must not pass. */
const httpUrl = z.string().url().refine((v) => /^https?:\/\//i.test(v), "仅支持 http(s) 链接");

export const settingsSchema = z.object({
  provider: z.enum(["mock", "openai-compat", "ollama"]).default("mock"),
  openai: z
    .object({
      baseUrl: httpUrl.default("https://api.openai.com/v1"),
      apiKey: z.string().default(""),
      model: z.string().default(""),
    })
    .default({}),
  ollama: z
    .object({
      baseUrl: httpUrl.default("http://127.0.0.1:11434"),
      model: z.string().default(""),
    })
    .default({}),
  temperature: z.number().min(0).max(2).default(0.2),
  // U7 image generation rides on the openai-compat credentials (same baseUrl
  // + apiKey); only the model is separate. Empty model = feature disabled
  // (routes answer 501, workbench hides the entry). zod default backfills
  // older settings.json files — no migration command.
  imageGen: z
    .object({
      model: z.string().default(""),
    })
    .default({}),
});

export type StudioSettings = z.infer<typeof settingsSchema>;

/** GET response: never exposes the raw apiKey (spec §9.2). */
export interface MaskedSettings extends StudioSettings {
  openai: StudioSettings["openai"] & { apiKey: "" };
  hasKey: boolean;
  keyHint: string;
}

export function defaultSettings(): StudioSettings {
  return settingsSchema.parse({});
}

export function maskSettings(settings: StudioSettings): MaskedSettings {
  const apiKey = settings.openai.apiKey;
  return {
    ...settings,
    openai: { ...settings.openai, apiKey: "" },
    hasKey: apiKey.length > 0,
    keyHint: apiKey.length >= 4 ? apiKey.slice(-4) : "",
  };
}

const settingsFile = (dataDir: string) => join(dataDir, "settings.json");
const tmpFile = (dataDir: string) => join(dataDir, "settings.json.tmp");

/**
 * Read the persisted settings. Missing or corrupt file falls back to defaults
 * (corrupt file is still logged loudly, never thrown).
 */
export async function readSettings(dataDir: string): Promise<StudioSettings> {
  let raw: string;
  try {
    raw = await fs.readFile(settingsFile(dataDir), "utf8");
  } catch {
    return defaultSettings();
  }
  try {
    return settingsSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.warn(`[server] settings.json 损坏，回退默认配置: ${(err as Error).message}`);
    return defaultSettings();
  }
}

/** Atomic write: tmp file first, then rename over the target. */
export async function writeSettings(dataDir: string, settings: StudioSettings): Promise<void> {
  const tmp = tmpFile(dataDir);
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2), "utf8");
  await fs.rename(tmp, settingsFile(dataDir));
}
