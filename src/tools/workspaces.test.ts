import { describe, expect, it, vi } from "vitest";

import type { BitbucketClient } from "../bitbucket/client.js";
import type { ContextResolver } from "../config/context.js";
import type { ProfileStore } from "../config/profiles.js";
import { workspaceTools } from "./workspaces.js";
import type { Deps } from "./types.js";

function makeDeps(listAll: ReturnType<typeof vi.fn>): Deps {
  return {
    bitbucket: { listAll } as unknown as BitbucketClient,
    profiles: {} as unknown as ProfileStore,
    resolve: {} as unknown as ContextResolver,
  };
}

function parseText(result: { content: Array<{ type: "text"; text: string }> }) {
  return JSON.parse(result.content[0]!.text);
}

describe("list_workspaces", () => {
  const tool = workspaceTools.find((t) => t.name === "list_workspaces")!;

  it("calls /user/workspaces", async () => {
    const listAll = vi.fn().mockResolvedValue([]);
    await tool.handler({}, makeDeps(listAll));
    expect(listAll).toHaveBeenCalledWith("/user/workspaces");
  });

  it("supports plain Workspace items", async () => {
    const listAll = vi.fn().mockResolvedValue([
      { uuid: "1", slug: "acme", name: "Acme" },
      { uuid: "2", slug: "beta", name: "Beta" },
    ]);

    const result = await tool.handler({}, makeDeps(listAll));

    expect(parseText(result)).toEqual({
      workspaces: [
        { slug: "acme", name: "Acme" },
        { slug: "beta", name: "Beta" },
      ],
    });
  });

  it("supports {workspace} wrapped items", async () => {
    const listAll = vi.fn().mockResolvedValue([
      { workspace: { uuid: "1", slug: "acme", name: "Acme" } },
      { workspace: { uuid: "2", slug: "beta", name: "Beta" } },
    ]);

    const result = await tool.handler({}, makeDeps(listAll));

    expect(parseText(result)).toEqual({
      workspaces: [
        { slug: "acme", name: "Acme" },
        { slug: "beta", name: "Beta" },
      ],
    });
  });

  it("supports a mix of plain and wrapped items", async () => {
    const listAll = vi.fn().mockResolvedValue([
      { uuid: "1", slug: "acme", name: "Acme" },
      { workspace: { uuid: "2", slug: "beta", name: "Beta" } },
    ]);

    const result = await tool.handler({}, makeDeps(listAll));

    expect(parseText(result)).toEqual({
      workspaces: [
        { slug: "acme", name: "Acme" },
        { slug: "beta", name: "Beta" },
      ],
    });
  });

  it("returns a message for an empty list", async () => {
    const listAll = vi.fn().mockResolvedValue([]);

    const result = await tool.handler({}, makeDeps(listAll));

    expect(parseText(result)).toEqual({
      workspaces: [],
      message: "No workspaces are accessible with the current credentials.",
    });
  });

  it("wraps thrown errors via toErrorResult", async () => {
    const listAll = vi.fn().mockRejectedValue(new Error("boom"));

    const result = await tool.handler({}, makeDeps(listAll));

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Error: boom");
  });
});
