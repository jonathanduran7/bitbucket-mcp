import { branchTools } from "./branches.js";
import { configTools } from "./config.js";
import { pullRequestTools } from "./pull-requests.js";
import { repositoryTools } from "./repositories.js";
import type { ToolDefinition } from "./types.js";
import { workspaceTools } from "./workspaces.js";

export type { Deps, ToolDefinition, ToolResult } from "./types.js";

/**
 * Aggregated registry of every MCP tool exposed by this server.
 *
 * Complete as of tasks.md Phase 13: workspaces (Phase 6), profile read/write
 * tools (Phases 7-8), repositories (Phase 9), branches (Phase 11), and pull
 * requests (Phase 12) — 18 tools total. Remaining phases (14-16) are tests,
 * README, and example config — they do not add tools.
 */
export const toolRegistry: ToolDefinition[] = [
  ...workspaceTools,
  ...configTools,
  ...repositoryTools,
  ...branchTools,
  ...pullRequestTools,
];
