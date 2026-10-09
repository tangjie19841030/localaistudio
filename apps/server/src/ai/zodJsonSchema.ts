import type { z } from "zod";

/**
 * Minimal zod → JSON Schema for StudioTool parameters (object props with
 * string/number/boolean/enum/array/optional). Ollama's /api/chat tools field
 * needs a JSON Schema; StudioTool still re-validates args with zod on execute.
 */
export function zodParametersToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convert(schema) as Record<string, unknown>;
}

function convert(schema: z.ZodTypeAny): unknown {
  const def = schema._def as { typeName?: string; innerType?: z.ZodTypeAny; type?: z.ZodTypeAny; value?: unknown; values?: unknown[]; shape?: () => Record<string, z.ZodTypeAny>; defaultValue?: () => unknown; options?: z.ZodTypeAny[]; in?: z.ZodTypeAny };
  const typeName = def.typeName ?? "";

  switch (typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return convert((def.innerType ?? def.type) as z.ZodTypeAny);
    case "ZodObject": {
      const shape = typeof def.shape === "function" ? def.shape() : {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = convert(value);
        if (!isOptional(value)) required.push(key);
      }
      return { type: "object", properties, ...(required.length ? { required } : {}) };
    }
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodArray":
      return { type: "array", items: convert(def.type as z.ZodTypeAny) };
    case "ZodEnum":
      return { type: "string", enum: def.values as string[] };
    case "ZodLiteral":
      return { const: def.value };
    case "ZodUnion": {
      const options = (def.options ?? []) as z.ZodTypeAny[];
      return { anyOf: options.map(convert) };
    }
    case "ZodRecord":
      return { type: "object", additionalProperties: true };
    case "ZodAny":
    case "ZodUnknown":
      return {};
    default:
      return {};
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const typeName = (schema._def as { typeName?: string }).typeName;
  return typeName === "ZodOptional" || typeName === "ZodDefault";
}
