import { describe, expect, it } from "vitest";

import { BitbucketClient } from "./client.js";
import { AuthError, ConfigError, NetworkError, NotFoundError, RateLimitError, UpstreamTimeoutError } from "./errors.js";

/**
 * These tests exercise the status-code-to-typed-error mapping that lives in
 * `BitbucketClient` (the only place that mapping is actually implemented).
 * `fetchImpl` is always a local fake — no real network call is ever made,
 * matching design.md's "unit-only, fetch injected" testing strategy.
 */

const EMAIL = "secret-user@example.com";
const TOKEN = "super-secret-token-value";

function clientWithFakeFetch(fetchImpl: typeof fetch): BitbucketClient {
  return new BitbucketClient({
    email: EMAIL,
    token: TOKEN,
    fetchImpl,
    sleep: async () => {},
  });
}

function jsonResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({}), { status, headers });
}

describe("BitbucketClient status code -> typed error mapping", () => {
  it("maps 401 to AuthError", async () => {
    const client = clientWithFakeFetch(async () => jsonResponse(401));
    await expect(client.requestJson("/x")).rejects.toBeInstanceOf(AuthError);
  });

  it("maps 403 to AuthError", async () => {
    const client = clientWithFakeFetch(async () => jsonResponse(403));
    await expect(client.requestJson("/x")).rejects.toBeInstanceOf(AuthError);
  });

  it("maps 404 to NotFoundError", async () => {
    const client = clientWithFakeFetch(async () => jsonResponse(404));
    await expect(client.requestJson("/x")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("maps 429 (after exhausting retries) to RateLimitError, honoring Retry-After", async () => {
    const client = clientWithFakeFetch(async () => jsonResponse(429, { "Retry-After": "7" }));
    let caught: unknown;
    try {
      await client.requestJson("/x");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RateLimitError);
    expect((caught as RateLimitError).retryAfterSeconds).toBe(7);
  });

  it("maps 555 (after exhausting retries) to UpstreamTimeoutError", async () => {
    const client = clientWithFakeFetch(async () => jsonResponse(555));
    await expect(client.requestJson("/x")).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  it("maps a generic 5xx (after exhausting retries) to UpstreamTimeoutError", async () => {
    const client = clientWithFakeFetch(async () => jsonResponse(503));
    await expect(client.requestJson("/x")).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  it("maps a fetch-level failure to NetworkError", async () => {
    const client = clientWithFakeFetch(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    await expect(client.requestJson("/x")).rejects.toBeInstanceOf(NetworkError);
  });

  it("throws ConfigError before any fetch call when credentials are missing", async () => {
    let fetchCalled = false;
    const client = new BitbucketClient({
      email: undefined,
      token: undefined,
      fetchImpl: (async () => {
        fetchCalled = true;
        return jsonResponse(200);
      }) as typeof fetch,
      sleep: async () => {},
    });

    await expect(client.requestJson("/x")).rejects.toBeInstanceOf(ConfigError);
    expect(fetchCalled).toBe(false);
  });

  it("never leaks the configured email or token in any thrown error message", async () => {
    const client = clientWithFakeFetch(async () => jsonResponse(401));
    try {
      await client.requestJson("/x");
      throw new Error("expected requestJson to reject");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(EMAIL);
      expect(message).not.toContain(TOKEN);
    }
  });
});
