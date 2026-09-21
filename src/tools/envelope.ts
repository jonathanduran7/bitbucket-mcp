import type { ToolResult } from "./types.js";

/** Wraps a successful tool result as the standard MCP text envelope. */
export function toToolResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Wraps a caught error as the standard MCP error envelope. Every error type
 * produced by `src/bitbucket/errors.ts` and `src/config/context.ts` already
 * guarantees its `.message` never contains credential values — this helper
 * relies on that guarantee and never touches `process.env` itself.
 */
export function toErrorResult(error: unknown): ToolResult {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `${name}: ${message}` }],
    isError: true,
  };
}
