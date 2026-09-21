#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { BitbucketClient } from "./bitbucket/client.js";
import { ContextResolver } from "./config/context.js";
import { ProfileStore } from "./config/profiles.js";
import { toolRegistry, type Deps } from "./tools/registry.js";

/**
 * Fails fast if required credentials are missing, before the server starts
 * accepting any tool call. Never logs the values themselves.
 */
function assertRequiredEnv(): void {
  const missing: string[] = [];
  if (!process.env.BITBUCKET_EMAIL) {
    missing.push("BITBUCKET_EMAIL");
  }
  if (!process.env.BITBUCKET_TOKEN) {
    missing.push("BITBUCKET_TOKEN");
  }
  if (missing.length > 0) {
    console.error(
      `bitbucket-mcp: missing required environment variable(s): ${missing.join(", ")}. ` +
        "Set them (see .env.example) before starting the server."
    );
    process.exit(1);
  }
}

function buildDeps(): Deps {
  const bitbucket = new BitbucketClient();
  const profiles = new ProfileStore();
  const resolve = new ContextResolver(profiles);
  return { bitbucket, profiles, resolve };
}

function registerTools(server: McpServer, deps: Deps): void {
  for (const tool of toolRegistry) {
    const readOnlyHint = tool.readOnly && !tool.mutatesLocalConfig;
    // openWorldHint is only true for tools that actually call the Bitbucket
    // API; local-only config reads/writes never leave the process. Derived
    // from the explicit `touchesBitbucket` field rather than `readOnly` /
    // `mutatesLocalConfig`, since neither of those alone can distinguish a
    // local-only read (e.g. list_profiles) from a Bitbucket read.
    const openWorldHint = tool.touchesBitbucket;

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint,
          openWorldHint,
          destructiveHint: false,
        },
      },
      (args) => tool.handler(args, deps)
    );
  }
}

async function main(): Promise<void> {
  assertRequiredEnv();

  const deps = buildDeps();

  const server = new McpServer({
    name: "bitbucket-mcp",
    version: "0.1.0",
  });

  registerTools(server, deps);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("bitbucket-mcp: fatal error during startup:", error instanceof Error ? error.message : error);
  process.exit(1);
});
