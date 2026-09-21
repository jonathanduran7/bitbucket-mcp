import type { Workspace } from "../bitbucket/types.js";
import { toErrorResult, toToolResult } from "./envelope.js";
import type { ToolDefinition } from "./types.js";

/**
 * Workspace discovery — see specs/workspace-discovery/spec.md.
 * Deliberately takes no `workspace` argument: its whole purpose is to
 * enumerate the workspaces the authenticated account can access.
 */
export const workspaceTools: ToolDefinition[] = [
  {
    name: "list_workspaces",
    description:
      "Lists every Bitbucket workspace the authenticated credentials can access, fully paginated. Takes no arguments.",
    inputSchema: {},
    readOnly: true,
    touchesBitbucket: true,
    handler: async (_args, deps) => {
      try {
        // Bitbucket has no bare "/workspaces" list endpoint for a user's own
        // credentials — that path 404s even with valid, correctly-scoped
        // tokens. The account-scoped endpoint is "/user/workspaces".
        const items = await deps.bitbucket.listAll<Workspace | { workspace: Workspace }>(
          "/user/workspaces"
        );
        const workspaces = items.map((item) => ("workspace" in item ? item.workspace : item));
        if (workspaces.length === 0) {
          return toToolResult({
            workspaces: [],
            message: "No workspaces are accessible with the current credentials.",
          });
        }
        return toToolResult({
          workspaces: workspaces.map((workspace) => ({
            slug: workspace.slug,
            name: workspace.name,
          })),
        });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
];
