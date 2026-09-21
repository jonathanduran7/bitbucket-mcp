import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { ConfigError } from "../bitbucket/errors.js";
import { emptyProfilesFile, type ProfilesFile } from "./types.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Resolves the on-disk path for profiles.json:
 * `${XDG_CONFIG_HOME:-~/.config}/bitbucket-mcp/profiles.json`, overridable via
 * `BITBUCKET_PROFILES_PATH`.
 */
export function resolveProfilesPath(): string {
  const override = process.env.BITBUCKET_PROFILES_PATH;
  if (override) {
    return override;
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return path.join(configHome, "bitbucket-mcp", "profiles.json");
}

/**
 * File-backed store for local profile configuration. Never holds credentials.
 *
 * - Missing file → empty in-memory state, not an error.
 * - Corrupt file → actionable error naming the path, file is left untouched.
 * - Every write is atomic (tmp file + rename) and re-applies 0700/0600 perms.
 */
export class ProfileStore {
  private readonly filePath: string;
  private cache: ProfilesFile | undefined;

  constructor(filePath: string = resolveProfilesPath()) {
    this.filePath = filePath;
  }

  async load(): Promise<ProfilesFile> {
    if (this.cache) {
      return this.cache;
    }

    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        this.cache = emptyProfilesFile();
        return this.cache;
      }
      throw new ConfigError(
        `Could not read profiles file at ${this.filePath}: ${describeError(error)}`
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error: unknown) {
      throw new ConfigError(
        `Profiles file at ${this.filePath} is corrupt (invalid JSON) and was left unmodified: ${describeError(error)}`
      );
    }

    if (!isValidProfilesFile(parsed)) {
      throw new ConfigError(
        `Profiles file at ${this.filePath} has an unexpected shape and was left unmodified.`
      );
    }

    this.cache = parsed;
    return this.cache;
  }

  async save(data: ProfilesFile): Promise<void> {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
    await chmod(dir, DIR_MODE);

    const tmpPath = path.join(dir, `.profiles.json.${randomBytes(6).toString("hex")}.tmp`);
    const contents = JSON.stringify(data, null, 2);

    await writeFile(tmpPath, contents, "utf-8");
    await chmod(tmpPath, FILE_MODE);
    await rename(tmpPath, this.filePath);
    await chmod(this.filePath, FILE_MODE);

    this.cache = data;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isValidProfilesFile(value: unknown): value is ProfilesFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) {
    return false;
  }
  if (typeof candidate.profiles !== "object" || candidate.profiles === null) {
    return false;
  }
  if (
    candidate.activeProfile !== undefined &&
    typeof candidate.activeProfile !== "string"
  ) {
    return false;
  }
  return true;
}
