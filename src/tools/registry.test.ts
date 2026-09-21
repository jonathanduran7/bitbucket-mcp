import { describe, expect, it } from "vitest";

import { toolRegistry } from "./registry.js";

describe("toolRegistry", () => {
  it("has exactly 18 tools", () => {
    expect(toolRegistry).toHaveLength(18);
  });

  it("has unique tool names", () => {
    const names = toolRegistry.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every tool has a handler function", () => {
    for (const tool of toolRegistry) {
      expect(typeof tool.handler).toBe("function");
    }
  });
});
