import { describe, expect, it, vi } from "vitest";

import type { BitbucketClient } from "../bitbucket/client.js";
import { NotFoundError } from "../bitbucket/errors.js";
import type { ContextResolver } from "../config/context.js";
import type { ProfileStore } from "../config/profiles.js";
import { repositoryTools } from "./repositories.js";
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

const repoFixture = {
  uuid: "u1",
  name: "My Repo",
  full_name: "acme/my-repo",
  slug: "my-repo",
  is_private: true,
  description: "desc",
  mainbranch: { name: "main" },
};

describe("list_repositories", () => {
  const tool = repositoryTools.find((t) => t.name === "list_repositories")!;

  it("resolves workspace and lists repositories", async () => {
    const listAll = vi.fn().mockResolvedValue([repoFixture]);
    const resolveWorkspace = vi.fn().mockResolvedValue("acme");

    const result = await tool.handler({}, makeDeps({ listAll, resolveWorkspace }));

    expect(resolveWorkspace).toHaveBeenCalledWith(undefined);
    expect(listAll).toHaveBeenCalledWith("/repositories/acme");
    expect(parseText(result)).toEqual({
      workspace: "acme",
      repositories: [
        {
          slug: "my-repo",
          name: "My Repo",
          fullName: "acme/my-repo",
          isPrivate: true,
          description: "desc",
          mainBranch: "main",
        },
      ],
    });
  });

  it("propagates workspace resolution errors", async () => {
    const listAll = vi.fn();
    const resolveWorkspace = vi.fn().mockRejectedValue(new Error("no workspace"));

    const result = await tool.handler({}, makeDeps({ listAll, resolveWorkspace }));

    expect(result.isError).toBe(true);
    expect(listAll).not.toHaveBeenCalled();
  });
});

describe("get_repository", () => {
  const tool = repositoryTools.find((t) => t.name === "get_repository")!;

  it("returns repository details", async () => {
    const requestJson = vi.fn().mockResolvedValue(repoFixture);
    const resolveWorkspace = vi.fn().mockResolvedValue("acme");

    const result = await tool.handler({ repo: "my-repo" }, makeDeps({ requestJson, resolveWorkspace }));

    expect(requestJson).toHaveBeenCalledWith("/repositories/acme/my-repo");
    expect(parseText(result)).toEqual({
      workspace: "acme",
      slug: "my-repo",
      name: "My Repo",
      fullName: "acme/my-repo",
      isPrivate: true,
      description: "desc",
      mainBranch: "main",
    });
  });

  it("re-throws NotFoundError with a message including the repo name", async () => {
    const requestJson = vi.fn().mockRejectedValue(new NotFoundError("original"));
    const resolveWorkspace = vi.fn().mockResolvedValue("acme");

    const result = await tool.handler({ repo: "ghost-repo" }, makeDeps({ requestJson, resolveWorkspace }));

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("NotFoundError");
    expect(result.content[0]?.text).toContain("ghost-repo");
    expect(result.content[0]?.text).toContain("acme");
  });

  it("passes through non-NotFound errors unchanged", async () => {
    const requestJson = vi.fn().mockRejectedValue(new Error("upstream failure"));
    const resolveWorkspace = vi.fn().mockResolvedValue("acme");

    const result = await tool.handler({ repo: "my-repo" }, makeDeps({ requestJson, resolveWorkspace }));

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Error: upstream failure");
  });
});
