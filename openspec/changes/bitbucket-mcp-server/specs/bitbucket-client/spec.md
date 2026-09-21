# Bitbucket Client Specification

## Purpose

Defines the behavior of the pure Bitbucket Cloud REST client: authentication, pagination, error mapping, and rate-limit handling. The client receives `workspace`/`repo` already resolved and has no knowledge of profiles or active workspace.

## Requirements

### Requirement: Authentication via Environment Credentials

The client MUST authenticate every request using credentials sourced only from `BITBUCKET_EMAIL` and `BITBUCKET_TOKEN` environment variables, and MUST NOT accept credentials from tool arguments or config files.

#### Scenario: Authenticated request succeeds

- GIVEN valid `BITBUCKET_EMAIL`/`BITBUCKET_TOKEN` are set
- WHEN the client issues a request to a Bitbucket resource
- THEN the request includes the derived auth header
- AND a successful response is parsed and returned to the caller

#### Scenario: Credentials absent at call time

- GIVEN `BITBUCKET_TOKEN` is unset
- WHEN any client method is invoked
- THEN it MUST return a typed configuration error before attempting the HTTP call

### Requirement: Full Pagination Traversal

The client MUST support traversing Bitbucket's paginated list responses (`values`, `page`, `pagelen`, `size`, `next`) and MUST NOT assume the first page contains the complete result set.

#### Scenario: List spans multiple pages

- GIVEN a list resource with more items than one page
- WHEN a tool requests the full list
- THEN the client follows `next` links until exhausted
- AND the caller receives all aggregated items, not just page one

#### Scenario: List fits in a single page

- GIVEN a list resource with fewer items than `pagelen`
- WHEN a tool requests the list
- THEN the client returns the single page without unnecessary follow-up requests

### Requirement: Typed Error Mapping

The client MUST map HTTP failure responses (401, 403, 404, 429, 5xx, network failure) to typed, distinguishable error objects that calling code and tools can branch on.

#### Scenario: Resource not found

- GIVEN a request for a nonexistent workspace, repository, branch, or pull request
- WHEN Bitbucket responds 404
- THEN the client raises a typed "not found" error identifying the resource

#### Scenario: Insufficient permissions

- GIVEN the authenticated account lacks access to a resource
- WHEN Bitbucket responds 401 or 403
- THEN the client raises a typed auth/permission error, without echoing credentials

### Requirement: Rate Limit Backoff

The client MUST detect HTTP 429 responses and MUST honor any `Retry-After` header with a backoff before surfacing a typed rate-limit error to the caller if retries are exhausted.

#### Scenario: Rate limited with Retry-After

- GIVEN Bitbucket responds 429 with a `Retry-After` header
- WHEN the client processes the response
- THEN it waits at least the indicated duration before retrying, up to a bounded retry limit
- AND if still rate-limited after the limit, returns a typed rate-limit error naming the wait time
