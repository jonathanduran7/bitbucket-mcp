/**
 * Local profile configuration types. Never store credentials here —
 * credentials always come from environment variables.
 */

export interface Profile {
  defaultWorkspace?: string;
  defaultRepo?: string;
}

export interface ProfilesFile {
  version: 1;
  activeProfile?: string;
  profiles: Record<string, Profile>;
}

export function emptyProfilesFile(): ProfilesFile {
  return { version: 1, profiles: {} };
}
