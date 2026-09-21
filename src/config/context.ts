import { z } from "zod";

import { ConfigError } from "../bitbucket/errors.js";
import type { ProfileStore } from "./profiles.js";

const nonEmptyString = z.string().trim().min(1);

/**
 * Resolves `workspace` for every Bitbucket-facing tool with a strict 4-level
 * precedence: explicit tool argument > process env override
 * (BITBUCKET_WORKSPACE) > active profile default > actionable error. Never
 * issues an HTTP request itself, and never on the error path.
 *
 * `repo` is intentionally NOT resolved here — per repository-browsing/spec.md
 * and pull-request-management/spec.md, every tool that needs a repo requires
 * it as an explicit argument, validated by Zod before this resolver runs.
 * A profile's `defaultRepo` (if set) is informational only, surfaced by
 * `list_profiles`/`get_active_profile`, not auto-applied to tool calls.
 */
export class ContextResolver {
  constructor(private readonly profiles: ProfileStore) {}

  async resolveWorkspace(explicit?: string): Promise<string> {
    const fromArg = normalize(explicit);
    if (fromArg) {
      return fromArg;
    }

    const fromEnv = normalize(process.env.BITBUCKET_WORKSPACE);
    if (fromEnv) {
      return fromEnv;
    }

    const fromProfile = normalize(await this.activeDefaultWorkspace());
    if (fromProfile) {
      return fromProfile;
    }

    throw new ConfigError(
      "No workspace is configured. Pass an explicit `workspace` argument, set the BITBUCKET_WORKSPACE " +
        "environment variable, or call `set_active_profile` followed by `set_default_workspace` to persist one."
    );
  }

  private async activeDefaultWorkspace(): Promise<string | undefined> {
    const activeProfile = await this.loadActiveProfile();
    return activeProfile?.defaultWorkspace;
  }

  private async loadActiveProfile() {
    const data = await this.profiles.load();
    if (!data.activeProfile) {
      return undefined;
    }
    return data.profiles[data.activeProfile];
  }
}

function normalize(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const result = nonEmptyString.safeParse(value);
  return result.success ? result.data : undefined;
}
