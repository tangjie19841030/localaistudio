import { describe, expect, it } from "vitest";
import { ToolKitRegistry, ToolKitRegistryError } from "../src/index.js";
import { demoToolkit } from "./fixtures.js";

describe("ToolKitRegistry", () => {
  it("resolves a toolkit only when project type and toolkit id agree", () => {
    const registry = new ToolKitRegistry([demoToolkit]);

    expect(registry.get("ui", "builtin.demo-ui")).toBe(demoToolkit);
    expect(() => registry.get("ppt", "builtin.demo-ui")).toThrow(ToolKitRegistryError);
  });

  it("rejects duplicate ids and unregistered project types", () => {
    expect(() => new ToolKitRegistry([demoToolkit, demoToolkit])).toThrow(ToolKitRegistryError);
    const registry = new ToolKitRegistry([demoToolkit]);
    expect(() => registry.getForProjectType("word")).toThrow(ToolKitRegistryError);
  });
});
