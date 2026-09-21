import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError } from "../bitbucket/errors.js";
import { ContextResolver } from "./context.js";
import type { ProfileStore } from "./profiles.js";
import type { ProfilesFile } from "./types.js";

/** Minimal fake satisfying the only method ContextResolver actually calls. */
function fakeProfileStore(data: ProfilesFile): ProfileStore {
  return { load: async () => data } as unknown as ProfileStore;
}

const ORIGINAL_WORKSPACE_ENV = process.env.BITBUCKET_WORKSPACE;

describe("ContextResolver.resolveWorkspace", () => {
  beforeEach(() => {
    delete process.env.BITBUCKET_WORKSPACE;
  });

  afterEach(() => {
    if (ORIGINAL_WORKSPACE_ENV === undefined) {
      delete process.env.BITBUCKET_WORKSPACE;
    } else {
      process.env.BITBUCKET_WORKSPACE = ORIGINAL_WORKSPACE_ENV;
    }
  });

  it("prefers the explicit argument over env and profile", async () => {
    process.env.BITBUCKET_WORKSPACE = "env-workspace";
    const store = fakeProfileStore({
      version: 1,
      activeProfile: "acme",
      profiles: { acme: { defaultWorkspace: "profile-workspace" } },
    });
    const resolver = new ContextResolver(store);

    await expect(resolver.resolveWorkspace("arg-workspace")).resolves.toBe("arg-workspace");
  });

  it("falls back to the BITBUCKET_WORKSPACE env override when no argument is given", async () => {
    process.env.BITBUCKET_WORKSPACE = "env-workspace";
    const store = fakeProfileStore({
      version: 1,
      activeProfile: "acme",
      profiles: { acme: { defaultWorkspace: "profile-workspace" } },
    });
    const resolver = new ContextResolver(store);

    await expect(resolver.resolveWorkspace(undefined)).resolves.toBe("env-workspace");
  });

  it("falls back to the active profile's default workspace when no arg or env is set", async () => {
    const store = fakeProfileStore({
      version: 1,
      activeProfile: "acme",
      profiles: { acme: { defaultWorkspace: "profile-workspace" } },
    });
    const resolver = new ContextResolver(store);

    await expect(resolver.resolveWorkspace(undefined)).resolves.toBe("profile-workspace");
  });

  it("throws an actionable ConfigError when nothing resolves, without any HTTP request", async () => {
    const store = fakeProfileStore({ version: 1, profiles: {} });
    const resolver = new ContextResolver(store);

    await expect(resolver.resolveWorkspace(undefined)).rejects.toBeInstanceOf(ConfigError);
    await expect(resolver.resolveWorkspace(undefined)).rejects.toThrow(/workspace/i);
  });
});
