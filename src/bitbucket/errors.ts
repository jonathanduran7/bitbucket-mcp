/**
 * Typed Bitbucket client errors.
 *
 * IMPORTANT: no constructor here accepts or exposes a token/email value.
 * Callers must never pass credentials into these errors, even for debugging.
 */

export class AuthError extends Error {
  constructor(message = "Authentication or authorization failed against the Bitbucket API.") {
    super(message);
    this.name = "AuthError";
  }
}

export class NotFoundError extends Error {
  constructor(public readonly resource: string) {
    super(`Not found: ${resource}`);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds?: number) {
    super(
      retryAfterSeconds
        ? `Rate limited by Bitbucket API. Retry after ${retryAfterSeconds}s.`
        : "Rate limited by Bitbucket API."
    );
    this.name = "RateLimitError";
  }
}

export class UpstreamTimeoutError extends Error {
  constructor(message = "The Bitbucket API did not respond in time.") {
    super(message);
    this.name = "UpstreamTimeoutError";
  }
}

export class NetworkError extends Error {
  constructor(message = "Network failure while contacting the Bitbucket API.") {
    super(message);
    this.name = "NetworkError";
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type BitbucketClientError =
  | AuthError
  | NotFoundError
  | RateLimitError
  | UpstreamTimeoutError
  | NetworkError
  | ConfigError;
