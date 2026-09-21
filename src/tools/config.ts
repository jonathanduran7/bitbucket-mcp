import { z } from "zod";

import { ConfigError } from "../bitbucket/errors.js";
import type { ProfilesFile } from "../config/types.js";
import { toErrorResult, toToolResult } from "./envelope.js";
import type { ToolDefinition } from "./types.js";

const nonEmptyString = z.string().trim().min(1);

/**
 * Resolves which profile a config write should target: the explicit
 * `profile` argument if given, otherwise the currently active profile.
 * Throws an actionable ConfigError (never touches Bitbucket) if the target
 * profile name can't be resolved, or doesn't exist yet in profiles.json.
 *
 * NOTE: this batch has no `create_profile` tool — profiles are seeded by
 * hand-editing profiles.json (see profiles.example.json / README), so these
 * write tools operate on profiles that already exist, matching
 * profile-config/spec.md's "GIVEN an active profile exists" scenarios.
 */
function resolveTargetProfileName(data: ProfilesFile, explicit?: string): string {
  const requested = explicit?.trim();
  const targetName = requested || data.activeProfile;

  if (!targetName) {
    throw new ConfigError(
      "No profile specified and no active profile is set. Pass an explicit `profile` argument or call " +
        "`set_active_profile` first."
    );
  }

  if (!(targetName in data.profiles)) {
    const available = Object.keys(data.profiles);
    throw new ConfigError(
      available.length > 0
        ? `Profile "${targetName}" does not exist. Available profiles: ${available.join(", ")}.`
        : `Profile "${targetName}" does not exist and no profiles are configured yet.`
    );
  }

  return targetName;
}

/** Local, Bitbucket-independent profile tools — see specs/profile-config/spec.md. */
export const configTools: ToolDefinition[] = [
  {
    name: "list_profiles",
    description: "Lists every configured local profile and its defaults. Never contacts Bitbucket.",
    inputSchema: {},
    readOnly: true,
    mutatesLocalConfig: false,
    touchesBitbucket: false,
    handler: async (_args, deps) => {
      try {
        const data = await deps.profiles.load();
        const names = Object.keys(data.profiles);
        if (names.length === 0) {
          return toToolResult({ profiles: [], message: "No profiles are configured." });
        }
        return toToolResult({
          profiles: names.map((name) => ({
            name,
            defaultWorkspace: data.profiles[name]?.defaultWorkspace,
            defaultRepo: data.profiles[name]?.defaultRepo,
            active: name === data.activeProfile,
          })),
        });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
  {
    name: "get_active_profile",
    description: "Returns the currently active profile's name and resolved defaults, if any.",
    inputSchema: {},
    readOnly: true,
    mutatesLocalConfig: false,
    touchesBitbucket: false,
    handler: async (_args, deps) => {
      try {
        const data = await deps.profiles.load();
        if (!data.activeProfile) {
          return toToolResult({ active: false, message: "No active profile is set." });
        }
        const profile = data.profiles[data.activeProfile];
        return toToolResult({
          active: true,
          name: data.activeProfile,
          defaultWorkspace: profile?.defaultWorkspace,
          defaultRepo: profile?.defaultRepo,
        });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
  {
    name: "set_active_profile",
    description: "Switches the active profile to an existing profile. Purely local — never calls Bitbucket.",
    inputSchema: { profile: nonEmptyString },
    readOnly: true,
    mutatesLocalConfig: true,
    touchesBitbucket: false,
    handler: async (args, deps) => {
      try {
        const data = await deps.profiles.load();
        if (!(args.profile in data.profiles)) {
          const available = Object.keys(data.profiles);
          throw new ConfigError(
            available.length > 0
              ? `Profile "${args.profile}" does not exist. Available profiles: ${available.join(", ")}.`
              : `Profile "${args.profile}" does not exist and no profiles are configured yet.`
          );
        }
        const next: ProfilesFile = { ...data, activeProfile: args.profile };
        await deps.profiles.save(next);
        return toToolResult({ active: true, name: args.profile });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
  {
    name: "set_default_workspace",
    description:
      "Persists a default workspace on the active (or explicitly named) profile. Purely local — never calls Bitbucket.",
    inputSchema: { workspace: nonEmptyString, profile: nonEmptyString.optional() },
    readOnly: true,
    mutatesLocalConfig: true,
    touchesBitbucket: false,
    handler: async (args, deps) => {
      try {
        const data = await deps.profiles.load();
        const targetName = resolveTargetProfileName(data, args.profile);
        const next: ProfilesFile = {
          ...data,
          profiles: {
            ...data.profiles,
            [targetName]: { ...data.profiles[targetName], defaultWorkspace: args.workspace },
          },
        };
        await deps.profiles.save(next);
        return toToolResult({ profile: targetName, defaultWorkspace: args.workspace });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
  {
    name: "clear_default_workspace",
    description:
      "Removes the persisted default workspace from the active (or explicitly named) profile. Idempotent. Purely local — never calls Bitbucket.",
    inputSchema: { profile: nonEmptyString.optional() },
    readOnly: true,
    mutatesLocalConfig: true,
    touchesBitbucket: false,
    handler: async (args, deps) => {
      try {
        const data = await deps.profiles.load();
        const targetName = resolveTargetProfileName(data, args.profile);
        const { defaultWorkspace: _removed, ...rest } = data.profiles[targetName] ?? {};
        const next: ProfilesFile = {
          ...data,
          profiles: { ...data.profiles, [targetName]: rest },
        };
        await deps.profiles.save(next);
        return toToolResult({ profile: targetName, defaultWorkspace: undefined });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  },
];
