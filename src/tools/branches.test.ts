import { describe, expect, it, vi } from "vitest";

import type { BitbucketClient } from "../bitbucket/client.js";
import { NotFoundError } from "../bitbucket/errors.js";
import type { ContextResolver } from "../config/context.js";
import type { ProfileStore } from "../config/profiles.js";
import { branchTools } from "./branches.js";
import type { Deps } from "./types.js";

function makeDeps(opts: {
  listAll?: ReturnType<typeof vi.fn>;
  requestJson?: ReturnType<typeof vi.fn>;
  resolveWorkspace?: ReturnType<typeof vi.fn>;
}): Deps {
  return {
    bitbucket: {
      listAll: opts.listAll,
      requestJson: opts.requestJson,
    } as unknown as BitbucketClient,
    profiles: {} as unknown as ProfileStore,
    resolve: {
      resolveWorkspace: opts.resolveWorkspace ?? vi.fn().mockResolvedValue("acme"),
    } as unknown as ContextResolver,
  };
}

function parseText(result: { content: Array<{ type: "text"; text: string }> }) {
  return JSON.parse(result.content[0]!.text);
}

const branchFixture = {
  name: "main",
  target: { hash: "abc123", date: "2024-01-01", message: "init" },
};

describe("list_branches", () => {
  const tool = branchTools.find((t) => t.name === "list_branches")!;

  it("lists branches without a name filter", async () => {
    const listAll = vi.fn().mockResolvedValue([branchFixture]);

    const result = await tool.handler({ repo: "my-repo" }, makeDeps({ listAll }));

    expect(listAll).toHaveBeenCalledWith("/repositories/acme/my-repo/refs/branches");
    expect(parseText(result)).toEqual({
      workspace: "acme",
      repo: "my-repo",
      branches: [
        { name: "main", targetHash: "abc123", targetDate: "2024-01-01", targetMessage: "init" },
      ],
    });
  });

  it("builds the q=name~\"...\" query when a name filter is given", async () => {
    const listAll = vi.fn().mockResolvedValue([]);

    await tool.handler({ repo: "my-repo", name: "feature" }, makeDeps({ listAll }));

    const expectedQuery = new URLSearchParams({ q: 'name~"feature"' }).toString();
    expect(listAll).toHaveBeenCalledWith(
      `/repositories/acme/my-repo/refs/branches?${expectedQuery}`
    );
  });
});

describe("get_branch", () => {
  const tool = branchTools.find((t) => t.name === "get_branch")!;

  it("returns branch details", async () => {
    const requestJson = vi.fn().mockResolvedValue(branchFixture);

    const result = await tool.handler(
      { repo: "my-repo", branch: "main" },
      makeDeps({ requestJson })
    );

    expect(requestJson).toHaveBeenCalledWith("/repositories/acme/my-repo/refs/branches/main");
    expect(parseText(result)).toEqual({
      workspace: "acme",
      repo: "my-repo",
      name: "main",
      targetHash: "abc123",
      targetDate: "2024-01-01",
      targetMessage: "init",
    });
  });

  it("re-throws NotFoundError with an enriched message", async () => {
    const requestJson = vi.fn().mockRejectedValue(new NotFoundError("original"));

    const result = await tool.handler(
      { repo: "my-repo", branch: "ghost-branch" },
      makeDeps({ requestJson })
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("NotFoundError");
    expect(result.content[0]?.text).toContain("ghost-branch");
    expect(result.content[0]?.text).toContain("acme/my-repo");
  });
});
