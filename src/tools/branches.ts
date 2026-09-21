import { z } from "zod";

import { NotFoundError } from "../bitbucket/errors.js";
import type { Branch } from "../bitbucket/types.js";
import { toErrorResult, toToolResult } from "./envelope.js";
import type { ToolDefinition } from "./types.js";

const nonEmptyString = z.string().trim().min(1);

function branchSummary(branch: Branch) {
  return {
    name: branch.name,
    targetHash: branch.target.hash,
    targetDate: branch.target.date,
    targetMessage: branch.target.message,
  };
}

/** Builds `/refs/branches` with an optional Bitbucket Query Language name filter. */
function branchesPath(workspace: string, repo: string, nameFilter?: string): string {
  const base = `/repositories/${workspace}/${repo}/refs/branches`;
  if (!nameFilter) {
    return base;
  }
  const query = new URLSearchParams({ q: `name~"${nameFilter}"` });
  return `${base}?${query.toString()}`;
}

/** Read-only branch tools — see specs/repository-browsing/spec.md. */
export const branchTools: ToolDefinition[] = [
  {
    name: "list_branches",
    description:
      "Lists every branch in a repository, fully paginated. Resolves `workspace` via the standard precedence " +
      "(explicit argument > env override > active profile default > error) if not provided. Requires an " +
      "explicit `repo` argument. Accepts an optional `name` filter (partial match) applied via Bitbucket's " +
      "query language.",
    inputSchema: {
      workspace: nonEmptyString.optional(),
      repo: nonEmptyString,
      name: nonEmptyString.optional(),
    },
    readOnly: true,
    touchesBitbucket: true,
    handler: async (args, deps) => {
      try {
        const workspace = await deps.resolve.resolveWorkspace(args.workspace);
        const repo = args.repo;
        const branches = await deps.bitbucket.listAll<Branch>(branchesPath(workspace, repo, args.name));
        return toToolResult({ workspace, repo, branches: branches.map(branchSummary) });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
  {
    name: "get_branch",
    description:
      "Returns details for a specific branch. Requires `repo` and `branch`, and resolves `workspace` via the standard precedence.",
    inputSchema: {
      workspace: nonEmptyString.optional(),
      repo: nonEmptyString,
      branch: nonEmptyString,
    },
    readOnly: true,
    touchesBitbucket: true,
    handler: async (args, deps) => {
      let workspace: string | undefined;
      const repo = args.repo;
      try {
        workspace = await deps.resolve.resolveWorkspace(args.workspace);
        const branch = await deps.bitbucket.requestJson<Branch>(
          `/repositories/${workspace}/${repo}/refs/branches/${encodeURIComponent(args.branch)}`
        );
        return toToolResult({ workspace, repo, ...branchSummary(branch) });
      } catch (error) {
        if (error instanceof NotFoundError) {
          return toErrorResult(
            new NotFoundError(`branch "${args.branch}" in repository "${workspace}/${repo}"`)
          );
        }
        return toErrorResult(error);
      }
    },
  },
];
