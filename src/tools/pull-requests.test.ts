import { describe, expect, it, vi } from "vitest";

import type { BitbucketClient } from "../bitbucket/client.js";
import { NotFoundError, UpstreamTimeoutError } from "../bitbucket/errors.js";
import type { ContextResolver } from "../config/context.js";
import type { ProfileStore } from "../config/profiles.js";
import { pullRequestTools } from "./pull-requests.js";
import type { Deps } from "./types.js";

function makeDeps(opts: {
  listAll?: ReturnType<typeof vi.fn>;
  requestJson?: ReturnType<typeof vi.fn>;
  requestText?: ReturnType<typeof vi.fn>;
  resolveWorkspace?: ReturnType<typeof vi.fn>;
}): Deps {
  return {
    bitbucket: {
      listAll: opts.listAll,
      requestJson: opts.requestJson,
      requestText: opts.requestText,
    } as unknown as BitbucketClient,
    profiles: {} as unknown as ProfileStore,
    resolve: {
      resolveWorkspace: opts.resolveWorkspace ?? vi.fn().mockResolvedValue("acme"),
    } as unknown as ContextResolver,
  };
}

function getTool(name: string) {
  const tool = pullRequestTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

function parseText(result: { content: Array<{ type: "text"; text: string }> }) {
  return JSON.parse(result.content[0]!.text);
}

const prFixture = {
  id: 42,
  title: "My PR",
  description: "desc",
  state: "OPEN",
  author: { display_name: "Jane" },
  source: { branch: { name: "feature" } },
  destination: { branch: { name: "main" } },
  created_on: "2024-01-01",
  updated_on: "2024-01-02",
  links: { html: { href: "https://bitbucket.org/pr/42" } },
};

describe("list_pull_requests", () => {
  const tool = getTool("list_pull_requests");

  it("defaults state to OPEN", async () => {
    const listAll = vi.fn().mockResolvedValue([prFixture]);

    const result = await tool.handler({ repo: "my-repo" }, makeDeps({ listAll }));

    const expectedQuery = new URLSearchParams({ state: "OPEN" }).toString();
    expect(listAll).toHaveBeenCalledWith(
      `/repositories/acme/my-repo/pullrequests?${expectedQuery}`
    );
    const body = parseText(result);
    expect(body.state).toBe("OPEN");
    expect(body.pullRequests).toHaveLength(1);
  });

  it("respects an explicit state filter", async () => {
    const listAll = vi.fn().mockResolvedValue([]);

    await tool.handler({ repo: "my-repo", state: "MERGED" }, makeDeps({ listAll }));

    const expectedQuery = new URLSearchParams({ state: "MERGED" }).toString();
    expect(listAll).toHaveBeenCalledWith(
      `/repositories/acme/my-repo/pullrequests?${expectedQuery}`
    );
  });
});

describe("get_pull_request", () => {
  const tool = getTool("get_pull_request");

  it("returns PR summary", async () => {
    const requestJson = vi.fn().mockResolvedValue(prFixture);

    const result = await tool.handler({ repo: "my-repo", pr_id: 42 }, makeDeps({ requestJson }));

    expect(requestJson).toHaveBeenCalledWith("/repositories/acme/my-repo/pullrequests/42");
    expect(parseText(result)).toMatchObject({ id: 42, title: "My PR" });
  });

  it("re-throws NotFoundError with an enriched message", async () => {
    const requestJson = vi.fn().mockRejectedValue(new NotFoundError("orig"));

    const result = await tool.handler({ repo: "my-repo", pr_id: 99 }, makeDeps({ requestJson }));

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("NotFoundError");
    expect(result.content[0]?.text).toContain("99");
    expect(result.content[0]?.text).toContain("acme/my-repo");
  });
});

describe("get_pr_commits", () => {
  const tool = getTool("get_pr_commits");

  it("lists commits", async () => {
    const listAll = vi.fn().mockResolvedValue([
      { hash: "abc", message: "msg", date: "2024-01-01", author: { raw: "Jane <j@x.com>" } },
    ]);

    const result = await tool.handler({ repo: "my-repo", pr_id: 42 }, makeDeps({ listAll }));

    expect(listAll).toHaveBeenCalledWith("/repositories/acme/my-repo/pullrequests/42/commits");
    expect(parseText(result).commits).toEqual([
      { hash: "abc", message: "msg", date: "2024-01-01", author: "Jane <j@x.com>" },
    ]);
  });
});

describe("get_pr_diff", () => {
  const tool = getTool("get_pr_diff");

  it("returns a short diff untruncated", async () => {
    const requestText = vi.fn().mockResolvedValue("diff --git a/f b/f\n+line\n");

    const result = await tool.handler({ repo: "my-repo", pr_id: 42 }, makeDeps({ requestText }));

    const body = parseText(result);
    expect(body.truncated).toBe(false);
    expect(body.diff).toBe("diff --git a/f b/f\n+line\n");
  });

  it("truncates a diff exceeding maxChars at the last newline", async () => {
    const line = "x".repeat(10);
    const lines = Array.from({ length: 10 }, (_, i) => `${line}${i}`);
    const diff = lines.join("\n");
    const maxChars = 25;
    const requestText = vi.fn().mockResolvedValue(diff);

    const result = await tool.handler(
      { repo: "my-repo", pr_id: 42, maxChars },
      makeDeps({ requestText })
    );

    const body = parseText(result);
    expect(body.truncated).toBe(true);
    expect(body.diff.length).toBeLessThanOrEqual(maxChars);
    expect(body.diff.endsWith("\n")).toBe(false);
    expect(diff.startsWith(body.diff)).toBe(true);
    expect(body.returnedChars).toBe(body.diff.length);
    expect(body.hint).toMatch(/truncated/i);
  });

  it("re-throws UpstreamTimeoutError with a specific message", async () => {
    const requestText = vi.fn().mockRejectedValue(new UpstreamTimeoutError());

    const result = await tool.handler({ repo: "my-repo", pr_id: 42 }, makeDeps({ requestText }));

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("UpstreamTimeoutError");
    expect(result.content[0]?.text).toContain("get_pr_commits");
  });
});

describe("list_pr_comments", () => {
  const tool = getTool("list_pr_comments");

  it("lists comments", async () => {
    const listAll = vi.fn().mockResolvedValue([
      {
        id: 1,
        content: { raw: "nice" },
        user: { display_name: "Jane" },
        created_on: "2024-01-01",
      },
    ]);

    const result = await tool.handler({ repo: "my-repo", pr_id: 42 }, makeDeps({ listAll }));

    expect(listAll).toHaveBeenCalledWith("/repositories/acme/my-repo/pullrequests/42/comments");
    expect(parseText(result).comments).toEqual([
      { id: 1, content: "nice", author: "Jane", createdOn: "2024-01-01", inline: undefined },
    ]);
  });
});

describe("create_pr_comment", () => {
  const tool = getTool("create_pr_comment");

  it("posts a comment", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      id: 5,
      content: { raw: "hello" },
      user: { display_name: "Jane" },
      created_on: "2024-01-01",
    });

    const result = await tool.handler(
      { repo: "my-repo", pr_id: 42, content: "hello" },
      makeDeps({ requestJson })
    );

    expect(requestJson).toHaveBeenCalledWith(
      "/repositories/acme/my-repo/pullrequests/42/comments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ content: { raw: "hello" } }),
      })
    );
    expect(parseText(result)).toMatchObject({ id: 5, content: "hello" });
  });
});

describe("create_pull_request", () => {
  const tool = getTool("create_pull_request");

  it("verifies both branches exist before POSTing", async () => {
    const requestJson = vi.fn().mockImplementation((path: string) => {
      if (path.includes("/refs/branches/")) {
        return Promise.resolve({ name: "branch", target: { hash: "abc" } });
      }
      return Promise.resolve(prFixture);
    });

    await tool.handler(
      {
        repo: "my-repo",
        title: "My PR",
        sourceBranch: "feature",
        destinationBranch: "main",
      },
      makeDeps({ requestJson })
    );

    expect(requestJson).toHaveBeenCalledWith(
      "/repositories/acme/my-repo/refs/branches/feature"
    );
    expect(requestJson).toHaveBeenCalledWith("/repositories/acme/my-repo/refs/branches/main");
    expect(requestJson).toHaveBeenCalledWith(
      "/repositories/acme/my-repo/pullrequests",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("fails with an enriched NotFoundError and never POSTs when the source branch is missing", async () => {
    const requestJson = vi.fn().mockImplementation((path: string) => {
      if (path.endsWith("/refs/branches/feature")) {
        return Promise.reject(new NotFoundError("orig"));
      }
      return Promise.resolve({ name: "main", target: { hash: "abc" } });
    });

    const result = await tool.handler(
      {
        repo: "my-repo",
        title: "My PR",
        sourceBranch: "feature",
        destinationBranch: "main",
      },
      makeDeps({ requestJson })
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("NotFoundError");
    expect(result.content[0]?.text).toContain("source branch");
    expect(result.content[0]?.text).toContain("feature");
    expect(requestJson).not.toHaveBeenCalledWith(
      "/repositories/acme/my-repo/pullrequests",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("fails with an enriched NotFoundError and never POSTs when the destination branch is missing", async () => {
    const requestJson = vi.fn().mockImplementation((path: string) => {
      if (path.endsWith("/refs/branches/main")) {
        return Promise.reject(new NotFoundError("orig"));
      }
      return Promise.resolve({ name: "feature", target: { hash: "abc" } });
    });

    const result = await tool.handler(
      {
        repo: "my-repo",
        title: "My PR",
        sourceBranch: "feature",
        destinationBranch: "main",
      },
      makeDeps({ requestJson })
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("NotFoundError");
    expect(result.content[0]?.text).toContain("destination branch");
    expect(result.content[0]?.text).toContain("main");
    expect(requestJson).not.toHaveBeenCalledWith(
      "/repositories/acme/my-repo/pullrequests",
      expect.objectContaining({ method: "POST" })
    );
  });
});

describe("update_pull_request", () => {
  const tool = getTool("update_pull_request");

  it("updates title/description/destination/reviewers via PUT", async () => {
    const requestJson = vi.fn().mockResolvedValue(prFixture);

    const result = await tool.handler(
      {
        repo: "my-repo",
        pr_id: 42,
        title: "New title",
        destinationBranch: "develop",
        reviewers: ["acc-1"],
      },
      makeDeps({ requestJson })
    );

    expect(requestJson).toHaveBeenCalledWith(
      "/repositories/acme/my-repo/pullrequests/42",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          title: "New title",
          destination: { branch: { name: "develop" } },
          reviewers: [{ account_id: "acc-1" }],
        }),
      })
    );
    expect(result.isError).toBeUndefined();
  });

  it("rejects a `state` argument with an explicit Error and never calls Bitbucket", async () => {
    const requestJson = vi.fn();

    const result = await tool.handler(
      { repo: "my-repo", pr_id: 42, state: "MERGED" },
      makeDeps({ requestJson })
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/cannot change PR state/i);
    expect(requestJson).not.toHaveBeenCalled();
  });
});
