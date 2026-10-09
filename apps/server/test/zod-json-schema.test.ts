import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodParametersToJsonSchema } from "../src/ai/zodJsonSchema.js";
import { STUDIO_TOOLS } from "@studio/schema-core";

describe("zodParametersToJsonSchema（Ollama tools 载荷）", () => {
  it("object + string/number/boolean/enum → JSON Schema 形状", () => {
    const schema = z.object({
      type: z.string(),
      props: z.record(z.unknown()).optional(),
      index: z.number().optional(),
      flag: z.boolean(),
      tone: z.enum(["brand", "neutral"]),
    });
    const json = zodParametersToJsonSchema(schema);
    expect(json.type).toBe("object");
    const props = json.properties as Record<string, { type?: string; enum?: string[] }>;
    expect(props.type?.type).toBe("string");
    expect(props.index?.type).toBe("number");
    expect(props.flag?.type).toBe("boolean");
    expect(props.tone?.enum).toEqual(["brand", "neutral"]);
    expect(json.required).toEqual(["type", "flag", "tone"]);
  });

  it("全部 STUDIO_TOOLS 的 parameters 都能转成 object JSON Schema", () => {
    for (const tool of STUDIO_TOOLS) {
      const json = zodParametersToJsonSchema(tool.parameters);
      expect(json.type).toBe("object");
      expect(typeof json.properties).toBe("object");
    }
  });
});
