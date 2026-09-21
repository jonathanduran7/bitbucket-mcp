import { z } from "zod";

import { NotFoundError, UpstreamTimeoutError } from "../bitbucket/errors.js";
import type { Comment, Commit, PullRequest, PullRequestState } from "../bitbucket/types.js";
import { toErrorResult, toToolResult } from "./envelope.js";
import type { ToolDefinition } from "./types.js";

const nonEmptyString = z.string().trim().min(1);
const prState = z.enum(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]);

const DEFAULT_DIFF_MAX_CHARS = 100_000;
const HARD_DIFF_MAX_CHARS = 400_000;

function prSummary(pr: PullRequest) {
  return {
    id: pr.id,
    title: pr.title,
    description: pr.description,
    state: pr.state,
    author: pr.author?.display_name,
    sourceBranch: pr.source.branch.name,
    destinationBranch: pr.destination.branch.name,
    createdOn: pr.created_on,
    updatedOn: pr.updated_on,
    url: pr.links?.html?.href,
  };
}

function commitSummary(commit: Commit) {
  return {
    hash: commit.hash,
    message: commit.message,
    date: commit.date,
    author: commit.author?.raw,
  };
}

function commentSummary(comment: Comment) {
  return {
    id: comment.id,
    content: comment.content.raw,
    author: comment.user?.display_name,
    createdOn: comment.created_on,
    inline: comment.inline,
  };
}

function pullRequestsBasePath(workspace: string, repo: string): string {
  return `/repositories/${workspace}/${repo}/pullrequests`;
}

/**
 * Truncates a diff to at most `maxChars`, cutting at the last newline before
 * the limit so a line is never split mid-way. Response shape always includes
 * `truncated`/`returnedChars` so a caller can never mistake a truncated diff
 * for the complete one.
 */
function truncateDiff(diff: string, maxChars: number) {
  if (diff.length <= maxChars) {
    return { diff, truncated: false as const, returnedChars: diff.length };
  }
  const slice = diff.slice(0, maxChars);
  const lastNewline = slice.lastIndexOf("\n");
  const cut = lastNewline > 0 ? slice.slice(0, lastNewline) : slice;
  return {
    diff: cut,
    truncated: true as const,
    returnedChars: cut.length,
    hint:
      `Diff truncated at ${cut.length} characters (limit was ${maxChars}). Call get_pr_diff again with a ` +
      `larger \`maxChars\` (up to ${HARD_DIFF_MAX_CHARS}), or use get_pr_commits for a smaller, per-commit view.`,
  };
}

/** Verifies a branch exists before letting a mutation proceed, so we never leave a partial PR. */
async function assertBranchExists(
  deps: Parameters<ToolDefinition["handler"]>[1],
  workspace: string,
  repo: string,
  branchName: string,
  role: "source" | "destination"
): Promise<void> {
  try {
    await deps.bitbucket.requestJson(
      `/repositories/${workspace}/${repo}/refs/branches/${encodeURIComponent(branchName)}`
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw new NotFoundError(`${role} branch "${branchName}" in repository "${workspace}/${repo}"`);
    }
    throw error;
  }
}

const reviewerList = z.array(nonEmptyString).optional();

function mapReviewers(reviewers?: string[]): Array<{ account_id: string }> | undefined {
  return reviewers?.map((accountId) => ({ account_id: accountId }));
}

/** Pull request tools — see specs/pull-request-management/spec.md. */
export const pullRequestTools: ToolDefinition[] = [
  {
    name: "list_pull_requests",
    description:
      "Lists pull requests in a repository, fully paginated. Requires an explicit `repo` argument and resolves " +
      '`workspace` via the standard precedence. Filters by `state` (OPEN | MERGED | DECLINED | SUPERSEDED), ' +
      'defaulting to "OPEN".',
    inputSchema: {
      workspace: nonEmptyString.optional(),
      repo: nonEmptyString,
      state: prState.optional(),
    },
    readOnly: true,
    touchesBitbucket: true,
    handler: async (args, deps) => {
      try {
        const workspace = await deps.resolve.resolveWorkspace(args.workspace);
        const repo = args.repo;
        const state: PullRequestState = args.state ?? "OPEN";
        const query = new URLSearchParams({ state });
        const prs = await deps.bitbucket.listAll<PullRequest>(
          `${pullRequestsBasePath(workspace, repo)}?${query.toString()}`
        );
        return toToolResult({ workspace, repo, state, pullRequests: prs.map(prSummary) });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
  {
    name: "get_pull_request",
    description:
      "Returns full metadata for a single pull request. Requires `repo` and `pr_id`, and resolves `workspace` via the standard precedence.",
    inputSchema: {
      workspace: nonEmptyString.optional(),
      repo: nonEmptyString,
      pr_id: z.number().int().positive(),
    },
    readOnly: true,
    touchesBitbucket: true,
    handler: async (args, deps) => {
      try {
        const workspace = await deps.resolve.resolveWorkspace(args.workspace);
        const repo = args.repo;
        try {
          const pr = await deps.bitbucket.requestJson<PullRequest>(
            `${pullRequestsBasePath(workspace, repo)}/${args.pr_id}`
          );
          return toToolResult({ workspace, repo, ...prSummary(pr) });
        } catch (error) {
          if (error instanceof NotFoundError) {
            throw new NotFoundError(`pull request "${args.pr_id}" in repository "${workspace}/${repo}"`);
          }
          throw error;
        }
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
  {
    name: "get_pr_commits",
    description: "Lists every commit belonging to a pull request, fully paginated. Requires an explicit `repo` argument.",
    inputSchema: {
      workspace: nonEmptyString.optional(),
      repo: nonEmptyString,
      pr_id: z.number().int().positive(),
    },
    readOnly: true,
    touchesBitbucket: true,
    handler: async (args, deps) => {
      try {
        const workspace = await deps.resolve.resolveWorkspace(args.workspace);
        const repo = args.repo;
        const commits = await deps.bitbucket.listAll<Commit>(
          `${pullRequestsBasePath(workspace, repo)}/${args.pr_id}/commits`
        );
        return toToolResult({ workspace, repo, prId: args.pr_id, commits: commits.map(commitSummary) });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
  {
    name: "get_pr_diff",
    description:
      "Returns the unified diff for a pull request as plain text, capped by default at 100,000 characters " +
      "(`maxChars`, hard cap 400,000). Truncation always lands on a line boundary and the response always " +
      "reports `truncated`/`returnedChars` so a truncated diff is never mistaken for the complete one. On very " +
      "large diffs Bitbucket may time out (HTTP 555); prefer `get_pr_commits` or a smaller `maxChars` instead of retrying.",
    inputSchema: {
      workspace: nonEmptyString.optional(),
      repo: nonEmptyString,
      pr_id: z.number().int().positive(),
      maxChars: z.number().int().positive().max(HARD_DIFF_MAX_CHARS).optional(),
    },
    readOnly: true,
    touchesBitbucket: true,
    handler: async (args, deps) => {
      try {
        const workspace = await deps.resolve.resolveWorkspace(args.workspace);
        const repo = args.repo;
        const maxChars = args.maxChars ?? DEFAULT_DIFF_MAX_CHARS;
        try {
          const diffText = await deps.bitbucket.requestText(
            `${pullRequestsBasePath(workspace, repo)}/${args.pr_id}/diff`
          );
          return toToolResult({ workspace, repo, prId: args.pr_id, ...truncateDiff(diffText, maxChars) });
        } catch (error) {
          if (error instanceof UpstreamTimeoutError) {
            throw new UpstreamTimeoutError(
              "Bitbucket timed out generating this diff (HTTP 555), likely because it is very large. " +
                "Use get_pr_commits for a per-commit view instead of retrying, or retry get_pr_diff with a smaller maxChars."
            );
          }
          throw error;
        }
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
  {
    name: "list_pr_comments",
    description: "Lists every comment (inline and general) on a pull request, fully paginated. Requires an explicit `repo` argument.",
    inputSchema: {
      workspace: nonEmptyString.optional(),
      repo: nonEmptyString,
      pr_id: z.number().int().positive(),
    },
    readOnly: true,
    touchesBitbucket: true,
    handler: async (args, deps) => {
      try {
        const workspace = await deps.resolve.resolveWorkspace(args.workspace);
        const repo = args.repo;
        const comments = await deps.bitbucket.listAll<Comment>(
          `${pullRequestsBasePath(workspace, repo)}/${args.pr_id}/comments`
        );
        return toToolResult({ workspace, repo, prId: args.pr_id, comments: comments.map(commentSummary) });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
  {
    name: "create_pr_comment",
    description:
      "Posts a new comment on a pull request. Requires non-empty `content` — validated before any Bitbucket call. WRITE tool.",
    inputSchema: {
      workspace: nonEmptyString.optional(),
      repo: nonEmptyString,
      pr_id: z.number().int().positive(),
      content: nonEmptyString,
    },
    readOnly: false,
    touchesBitbucket: true,
    handler: async (args, deps) => {
      try {
        const workspace = await deps.resolve.resolveWorkspace(args.workspace);
        const repo = args.repo;
        const comment = await deps.bitbucket.requestJson<Comment>(
          `${pullRequestsBasePath(workspace, repo)}/${args.pr_id}/comments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: { raw: args.content } }),
          }
        );
        return toToolResult({ workspace, repo, prId: args.pr_id, ...commentSummary(comment) });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
  {
    name: "create_pull_request",
    description:
      "Opens a new pull request. Requires `title`, `sourceBranch`, and `destinationBranch`; both branches are " +
      "verified to exist before the PR is created so no partial PR is ever left behind. WRITE tool.",
    inputSchema: {
      workspace: nonEmptyString.optional(),
      repo: nonEmptyString,
      title: nonEmptyString,
      sourceBranch: nonEmptyString,
      destinationBranch: nonEmptyString,
      description: z.string().optional(),
      reviewers: reviewerList,
      closeSourceBranch: z.boolean().optional(),
      draft: z.boolean().optional(),
    },
    readOnly: false,
    touchesBitbucket: true,
    handler: async (args, deps) => {
      try {
        const workspace = await deps.resolve.resolveWorkspace(args.workspace);
        const repo = args.repo;

        await assertBranchExists(deps, workspace, repo, args.sourceBranch, "source");
        await assertBranchExists(deps, workspace, repo, args.destinationBranch, "destination");

        const pr = await deps.bitbucket.requestJson<PullRequest>(pullRequestsBasePath(workspace, repo), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: args.title,
            description: args.description,
            source: { branch: { name: args.sourceBranch } },
            destination: { branch: { name: args.destinationBranch } },
            reviewers: mapReviewers(args.reviewers),
            close_source_branch: args.closeSourceBranch,
            draft: args.draft,
          }),
        });
        return toToolResult({ workspace, repo, ...prSummary(pr) });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
  {
    name: "update_pull_request",
    description:
      "Updates a pull request's title, description, destination branch, and/or reviewers. Does NOT support " +
      "merge, approve, or decline — passing a `state` is explicitly rejected. WRITE tool.",
    inputSchema: {
      workspace: nonEmptyString.optional(),
      repo: nonEmptyString,
      pr_id: z.number().int().positive(),
      title: nonEmptyString.optional(),
      description: z.string().optional(),
      destinationBranch: nonEmptyString.optional(),
      reviewers: reviewerList,
      state: z.unknown().optional(),
    },
    readOnly: false,
    touchesBitbucket: true,
    handler: async (args, deps) => {
      try {
        if (args.state !== undefined) {
          throw new Error(
            "update_pull_request cannot change PR state. Merge, approve, and decline are out of scope for this " +
              "tool (and this MVP) — remove `state` from the request."
          );
        }

        const workspace = await deps.resolve.resolveWorkspace(args.workspace);
        const repo = args.repo;

        const body: Record<string, unknown> = {};
        if (args.title !== undefined) body.title = args.title;
        if (args.description !== undefined) body.description = args.description;
        if (args.destinationBranch !== undefined) {
          body.destination = { branch: { name: args.destinationBranch } };
        }
        if (args.reviewers !== undefined) body.reviewers = mapReviewers(args.reviewers);

        const pr = await deps.bitbucket.requestJson<PullRequest>(
          `${pullRequestsBasePath(workspace, repo)}/${args.pr_id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        return toToolResult({ workspace, repo, ...prSummary(pr) });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
];
