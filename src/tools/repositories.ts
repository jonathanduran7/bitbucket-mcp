import { z } from "zod";

import { NotFoundError } from "../bitbucket/errors.js";
import type { Repository } from "../bitbucket/types.js";
import { toErrorResult, toToolResult } from "./envelope.js";
import type { ToolDefinition } from "./types.js";

const nonEmptyString = z.string().trim().min(1);

function repoSummary(repo: Repository) {
  return {
    slug: repo.slug,
    name: repo.name,
    fullName: repo.full_name,
    isPrivate: repo.is_private,
    description: repo.description,
    mainBranch: repo.mainbranch?.name,
  };
}

/** Read-only repository tools — see specs/repository-browsing/spec.md. */
export const repositoryTools: ToolDefinition[] = [
  {
    name: "list_repositories",
    description:
      "Lists every repository in a workspace, fully paginated. Resolves `workspace` via the standard precedence " +
      "(explicit argument > BITBUCKET_WORKSPACE env override > active profile default > error) if not provided.",
    inputSchema: { workspace: nonEmptyString.optional() },
    readOnly: true,
    touchesBitbucket: true,
    handler: async (args, deps) => {
      try {
        const workspace = await deps.resolve.resolveWorkspace(args.workspace);
        const repos = await deps.bitbucket.listAll<Repository>(`/repositories/${workspace}`);
        return toToolResult({ workspace, repositories: repos.map(repoSummary) });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
  {
    name: "get_repository",
    description:
      "Returns details for a specific repository. Requires `repo` and resolves `workspace` via the standard precedence.",
    inputSchema: { workspace: nonEmptyString.optional(), repo: nonEmptyString },
    readOnly: true,
    touchesBitbucket: true,
    handler: async (args, deps) => {
      let workspace: string | undefined;
      try {
        workspace = await deps.resolve.resolveWorkspace(args.workspace);
        const repository = await deps.bitbucket.requestJson<Repository>(
          `/repositories/${workspace}/${args.repo}`
        );
        return toToolResult({ workspace, ...repoSummary(repository) });
      } catch (error) {
        if (error instanceof NotFoundError) {
          return toErrorResult(new NotFoundError(`repository "${args.repo}" in workspace "${workspace}"`));
        }
        return toErrorResult(error);
      }
    },
  },
];
