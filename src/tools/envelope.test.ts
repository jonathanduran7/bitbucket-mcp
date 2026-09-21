import { describe, expect, it } from "vitest";

import { toErrorResult, toToolResult } from "./envelope.js";

describe("toToolResult", () => {
  it("wraps data as pretty-printed JSON in content[0].text", () => {
    const result = toToolResult({ foo: "bar", n: 1 });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: JSON.stringify({ foo: "bar", n: 1 }, null, 2),
    });
  });

  it("handles arrays and primitives", () => {
    const result = toToolResult([1, 2, 3]);
    expect(result.content[0]?.text).toBe(JSON.stringify([1, 2, 3], null, 2));
  });
});

describe("toErrorResult", () => {
  it("uses error.name and error.message for a real Error instance", () => {
    class MyError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "MyError";
      }
    }

    const result = toErrorResult(new MyError("something broke"));

    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "MyError: something broke",
    });
  });

  it("uses the default Error name for a plain Error", () => {
    const result = toErrorResult(new Error("plain failure"));

    expect(result.content[0]?.text).toBe("Error: plain failure");
    expect(result.isError).toBe(true);
  });

  it('falls back to "Error" as the name when given a plain string', () => {
    const result = toErrorResult("just a string");

    expect(result.content[0]).toEqual({
      type: "text",
      text: "Error: just a string",
    });
    expect(result.isError).toBe(true);
  });

  it("stringifies non-Error, non-string values", () => {
    const result = toErrorResult({ some: "object" });

    expect(result.content[0]?.text).toBe(`Error: ${String({ some: "object" })}`);
    expect(result.isError).toBe(true);
  });
});
