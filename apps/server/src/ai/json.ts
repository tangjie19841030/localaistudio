/** Extract a JSON object/array from common model markdown wrappers. */
export function normalizeJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function parseModelJson(text: string): unknown | undefined {
  try {
    return JSON.parse(normalizeJsonText(text));
  } catch {
    return undefined;
  }
}
