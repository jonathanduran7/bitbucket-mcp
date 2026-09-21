import type { ZodRawShape, ZodTypeAny, objectOutputType } from "zod";

import type { BitbucketClient } from "../bitbucket/client.js";
import type { ContextResolver } from "../config/context.js";
import type { ProfileStore } from "../config/profiles.js";

export interface Deps {
  bitbucket: BitbucketClient;
  profiles: ProfileStore;
  resolve: ContextResolver;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ToolDefinition<S extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  inputSchema: S;
  /** true when this tool never mutates Bitbucket (may still mutate local config). */
  readOnly: boolean;
  /** true when this tool writes to the local profiles.json (never to Bitbucket). */
  mutatesLocalConfig?: boolean;
  /**
   * true only for tools that actually call the Bitbucket API (drives the MCP
   * `openWorldHint` annotation). false for local-only config/profile tools,
   * which never leave the process. Kept separate from `readOnly` /
   * `mutatesLocalConfig` because neither of those two fields alone can
   * distinguish "local-only read" from "Bitbucket read" — see design.md's
   * openWorldHint mapping decision.
   */
  touchesBitbucket: boolean;
  handler: (args: objectOutputType<S, ZodTypeAny>, deps: Deps) => Promise<ToolResult>;
}
