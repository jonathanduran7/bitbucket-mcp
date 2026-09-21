import {
  AuthError,
  ConfigError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  UpstreamTimeoutError,
} from "./errors.js";
import { paginateAll } from "./pagination.js";
import type { PaginatedResponse } from "./types.js";

export const BITBUCKET_API_BASE_URL = "https://api.bitbucket.org/2.0";

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

export interface BitbucketClientOptions {
  /** Overrides for testing; production code should rely on env vars. */
  email?: string;
  token?: string;
  baseUrl?: string;
  /** Injectable fetch implementation, primarily for tests. */
  fetchImpl?: typeof fetch;
  /** Overridable sleep for tests, to avoid real delays. */
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pure Bitbucket Cloud REST v2.0 client.
 *
 * Deliberately has zero knowledge of profiles, active workspace, or config
 * files — callers (tools) pass `workspace`/`repo` already resolved. Auth is
 * sourced exclusively from BITBUCKET_EMAIL/BITBUCKET_TOKEN (or explicit
 * constructor overrides for tests), never from tool arguments.
 */
export class BitbucketClient {
  private readonly email?: string;
  private readonly token?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: BitbucketClientOptions = {}) {
    this.email = options.email ?? process.env.BITBUCKET_EMAIL;
    this.token = options.token ?? process.env.BITBUCKET_TOKEN;
    this.baseUrl = options.baseUrl ?? BITBUCKET_API_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** Performs a single request and returns the parsed JSON body. */
  async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.requestWithRetry(path, init);
    return (await response.json()) as T;
  }

  /** Performs a single request and returns the raw text body (e.g. diffs). */
  async requestText(path: string, init: RequestInit = {}): Promise<string> {
    const response = await this.requestWithRetry(path, init);
    return await response.text();
  }

  /** Follows `next` links to aggregate every item of a paginated list resource. */
  async listAll<T>(path: string, init: RequestInit = {}): Promise<T[]> {
    const initialUrl = this.resolveUrl(path);
    return paginateAll<T>(initialUrl, async (url) => {
      const response = await this.requestWithRetry(url, init);
      return (await response.json()) as PaginatedResponse<T>;
    });
  }

  private resolveUrl(pathOrUrl: string): string {
    if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
      return pathOrUrl;
    }
    return `${this.baseUrl}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  }

  private authHeader(): string {
    if (!this.token) {
      throw new ConfigError(
        "BITBUCKET_TOKEN is not set. Set BITBUCKET_EMAIL and BITBUCKET_TOKEN before calling any Bitbucket tool."
      );
    }
    if (!this.email) {
      throw new ConfigError(
        "BITBUCKET_EMAIL is not set. Set BITBUCKET_EMAIL and BITBUCKET_TOKEN before calling any Bitbucket tool."
      );
    }
    const encoded = Buffer.from(`${this.email}:${this.token}`).toString("base64");
    return `Basic ${encoded}`;
  }

  private async requestWithRetry(
    pathOrUrl: string,
    init: RequestInit,
    attempt = 0
  ): Promise<Response> {
    // ConfigError must surface before any network call is attempted.
    const authorization = this.authHeader();
    const url = this.resolveUrl(pathOrUrl);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        redirect: "follow",
        ...init,
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          ...init.headers,
        },
      });
    } catch {
      throw new NetworkError();
    }

    if (response.ok) {
      return response;
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthError();
    }

    if (response.status === 404) {
      throw new NotFoundError(url);
    }

    if (response.status === 429 || response.status === 555 || response.status >= 500) {
      if (attempt < MAX_RETRIES) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const waitMs = this.computeBackoffMs(attempt, retryAfterHeader);
        await this.sleep(waitMs);
        return this.requestWithRetry(pathOrUrl, init, attempt + 1);
      }
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;
        throw new RateLimitError(
          Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined
        );
      }
      throw new UpstreamTimeoutError();
    }

    throw new Error(`Unexpected Bitbucket API response: ${response.status} ${response.statusText}`);
  }

  private computeBackoffMs(attempt: number, retryAfterHeader: string | null): number {
    if (retryAfterHeader) {
      const retryAfterSeconds = Number(retryAfterHeader);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
        return retryAfterSeconds * 1000;
      }
    }
    const exponential = BASE_BACKOFF_MS * 2 ** attempt;
    const jitter = Math.random() * BASE_BACKOFF_MS;
    return exponential + jitter;
  }
}
