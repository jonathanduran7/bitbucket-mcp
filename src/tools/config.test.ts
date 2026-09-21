import { describe, expect, it } from "vitest";

import type { BitbucketClient } from "../bitbucket/client.js";
import type { ContextResolver } from "../config/context.js";
import type { ProfileStore } from "../config/profiles.js";
import type { ProfilesFile } from "../config/types.js";
import { configTools } from "./config.js";
import type { Deps } from "./types.js";

/** Minimal fake satisfying load/save, same pattern as fakeProfileStore in context.test.ts. */
function fakeProfileStore(initial: ProfilesFile): ProfileStore & { saved?: ProfilesFile } {
  let data = initial;
  const store = {
    load: async () => data,
    save: async (next: ProfilesFile) => {
      data = next;
      store.saved = next;
    },
  } as unknown as ProfileStore & { saved?: ProfilesFile };
  return store;
}

function makeDeps(profiles: ProfileStore): Deps {
  return {
    bitbucket: {} as unknown as BitbucketClient,
    profiles,
    resolve: {} as unknown as ContextResolver,
  };
}

function getTool(name: string) {
  const tool = configTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

function parseText(result: { content: Array<{ type: "text"; text: string }> }) {
  return JSON.parse(result.content[0]!.text);
}

describe("configTools", () => {
  describe("list_profiles", () => {
    it("returns empty list message when no profiles exist", async () => {
      const store = fakeProfileStore({ version: 1, profiles: {} });
      const tool = getTool("list_profiles");

      const result = await tool.handler({}, makeDeps(store));

      expect(result.isError).toBeUndefined();
      expect(parseText(result)).toEqual({ profiles: [], message: "No profiles are configured." });
    });

    it("lists profiles with active flag and defaults", async () => {
      const store = fakeProfileStore({
        version: 1,
        activeProfile: "acme",
        profiles: {
          acme: { defaultWorkspace: "acme-ws", defaultRepo: "acme-repo" },
          other: {},
        },
      });
      const tool = getTool("list_profiles");

      const result = await tool.handler({}, makeDeps(store));

      expect(parseText(result)).toEqual({
        profiles: [
          { name: "acme", defaultWorkspace: "acme-ws", defaultRepo: "acme-repo", active: true },
          { name: "other", defaultWorkspace: undefined, defaultRepo: undefined, active: false },
        ],
      });
    });
  });

  describe("get_active_profile", () => {
    it("reports no active profile when none is set", async () => {
      const store = fakeProfileStore({ version: 1, profiles: {} });
      const tool = getTool("get_active_profile");

      const result = await tool.handler({}, makeDeps(store));

      expect(parseText(result)).toEqual({ active: false, message: "No active profile is set." });
    });

    it("returns the active profile's resolved defaults", async () => {
      const store = fakeProfileStore({
        version: 1,
        activeProfile: "acme",
        profiles: { acme: { defaultWorkspace: "acme-ws" } },
      });
      const tool = getTool("get_active_profile");

      const result = await tool.handler({}, makeDeps(store));

      expect(parseText(result)).toEqual({
        active: true,
        name: "acme",
        defaultWorkspace: "acme-ws",
        defaultRepo: undefined,
      });
    });
  });

  describe("set_active_profile", () => {
    it("returns a ConfigError when the profile does not exist", async () => {
      const store = fakeProfileStore({ version: 1, profiles: { acme: {} } });
      const tool = getTool("set_active_profile");

      const result = await tool.handler({ profile: "ghost" }, makeDeps(store));

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("ConfigError");
      expect(result.content[0]?.text).toContain('"ghost"');
      expect(result.content[0]?.text).toContain("acme");
    });

    it("switches the active profile when it exists", async () => {
      const store = fakeProfileStore({
        version: 1,
        activeProfile: "acme",
        profiles: { acme: {}, other: {} },
      });
      const tool = getTool("set_active_profile");

      const result = await tool.handler({ profile: "other" }, makeDeps(store));

      expect(parseText(result)).toEqual({ active: true, name: "other" });
      expect(store.saved?.activeProfile).toBe("other");
    });
  });

  describe("set_default_workspace", () => {
    it("uses the explicit profile argument over the active profile", async () => {
      const store = fakeProfileStore({
        version: 1,
        activeProfile: "acme",
        profiles: { acme: {}, other: {} },
      });
      const tool = getTool("set_default_workspace");

      const result = await tool.handler(
        { workspace: "other-ws", profile: "other" },
        makeDeps(store)
      );

      expect(parseText(result)).toEqual({ profile: "other", defaultWorkspace: "other-ws" });
      expect(store.saved?.profiles.other?.defaultWorkspace).toBe("other-ws");
    });

    it("falls back to the active profile when no explicit profile is given", async () => {
      const store = fakeProfileStore({
        version: 1,
        activeProfile: "acme",
        profiles: { acme: {} },
      });
      const tool = getTool("set_default_workspace");

      const result = await tool.handler({ workspace: "acme-ws" }, makeDeps(store));

      expect(parseText(result)).toEqual({ profile: "acme", defaultWorkspace: "acme-ws" });
    });

    it("returns a ConfigError when no profile can be resolved", async () => {
      const store = fakeProfileStore({ version: 1, profiles: {} });
      const tool = getTool("set_default_workspace");

      const result = await tool.handler({ workspace: "ws" }, makeDeps(store));

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("ConfigError");
      expect(result.content[0]?.text).toMatch(/no active profile/i);
    });
  });

  describe("clear_default_workspace", () => {
    it("removes the default workspace from the target profile", async () => {
      const store = fakeProfileStore({
        version: 1,
        activeProfile: "acme",
        profiles: { acme: { defaultWorkspace: "acme-ws", defaultRepo: "keep-me" } },
      });
      const tool = getTool("clear_default_workspace");

      const result = await tool.handler({}, makeDeps(store));

      expect(parseText(result)).toEqual({ profile: "acme", defaultWorkspace: undefined });
      expect(store.saved?.profiles.acme).toEqual({ defaultRepo: "keep-me" });
    });

    it("is idempotent when there is no default workspace to clear", async () => {
      const store = fakeProfileStore({
        version: 1,
        activeProfile: "acme",
        profiles: { acme: {} },
      });
      const tool = getTool("clear_default_workspace");

      const first = await tool.handler({}, makeDeps(store));
      const second = await tool.handler({}, makeDeps(store));

      expect(first.isError).toBeUndefined();
      expect(second.isError).toBeUndefined();
      expect(parseText(second)).toEqual({ profile: "acme", defaultWorkspace: undefined });
    });
  });
});
