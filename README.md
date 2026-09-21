# bitbucket-mcp

MCP (Model Context Protocol) server for Bitbucket Cloud. Exposes workspace,
repository, branch, and pull request operations as MCP tools so an MCP
client (Claude Code, Codex, etc.) can browse and interact with Bitbucket
Cloud on your behalf, plus a small set of local-only tools to manage
multiple Bitbucket workspace "profiles" without editing config by hand.

This is an MVP: read-heavy tool surface, a focused set of write tools
(comments and pull request creation/update), no merge/approve/decline,
issues, pipelines, or webhooks. See [Out of scope](#out-of-scope--next-steps)
below.

## Quick start

```bash
npm install
npm run build   # compiles src/ -> dist/
```

Then point your MCP client at `node dist/index.js`, passing `BITBUCKET_EMAIL`
and `BITBUCKET_TOKEN` as environment variables (see [Using this server from
an MCP client](#using-this-server-from-an-mcp-client) for the full config
JSON). See [Creating a Bitbucket API token](#creating-a-bitbucket-api-token)
if you don't have one yet.

## Installation

Requires Node.js >= 20.

```bash
npm install
npm run build   # compiles src/ -> dist/ via tsc
```

For local development without building first, you can also run it directly
with `npx tsx src/index.ts` (requires `tsx` — not a project dependency by
default, install it ad hoc with `npx -y tsx src/index.ts` if you don't have
it globally).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `BITBUCKET_EMAIL` | Yes | Atlassian account email used for Basic Auth. |
| `BITBUCKET_TOKEN` | Yes | Bitbucket API token (see below). Never an app password. |
| `BITBUCKET_PROFILES_PATH` | No | Overrides where `profiles.json` lives. Default: `${XDG_CONFIG_HOME:-~/.config}/bitbucket-mcp/profiles.json`. |
| `BITBUCKET_WORKSPACE` | No | Process-level override for workspace resolution. Takes precedence over the active profile's default, but not over an explicit `workspace` tool argument. |

The server fails fast at startup if `BITBUCKET_EMAIL` or `BITBUCKET_TOKEN`
is missing, naming the missing variable — it never starts accepting tool
calls without valid credentials configured.

### Creating a Bitbucket API token

Bitbucket Cloud **app passwords are deprecated** (disabled starting
2026-06-09). This server authenticates exclusively with an **API token**
over Basic Auth (`email:api_token`).

1. Go to [Atlassian account settings → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Create a token scoped for Bitbucket. Double-check the exact granular
   scope names shown at creation time — classic and granular scopes
   currently coexist, and the names differ slightly. At minimum you need:
   - `account` / `read:workspace` — for `list_workspaces`
   - `repository` (read) — for repository and branch tools
   - `pullrequest` (read) — for PR read tools, commits, diff, comments
   - `pullrequest:write` — for `create_pr_comment`, `create_pull_request`, `update_pull_request`
3. Set `BITBUCKET_EMAIL` to the Atlassian account email and `BITBUCKET_TOKEN`
   to the generated token.

## Profiles (`profiles.json`)

Profiles let you keep more than one default workspace (e.g. `personal` vs
`work`) without passing `workspace` on every call, and switch between them
with a tool call instead of editing a file.

- **Location**: `${XDG_CONFIG_HOME:-~/.config}/bitbucket-mcp/profiles.json`,
  overridable via `BITBUCKET_PROFILES_PATH`.
- **Format** — see [`profiles.example.json`](./profiles.example.json) for a
  full example with fictitious data:

  ```json
  {
    "version": 1,
    "activeProfile": "personal",
    "profiles": {
      "personal": { "defaultWorkspace": "my-workspace", "defaultRepo": "my-repo" }
    }
  }
  ```

- **Credentials never go in this file.** `BITBUCKET_EMAIL`/`BITBUCKET_TOKEN`
  always come from the environment — `profiles.json` only ever stores
  workspace/repo defaults per named profile.
- **Permissions**: the containing directory is created/kept at `0700` and
  the file itself at `0600`, re-applied on every write (not only on
  creation). Writes are atomic (`profiles.json.tmp` + `rename`) so a crash
  mid-write never corrupts the file.
- **Missing file** → treated as empty state in memory, not an error (no
  profiles configured yet). **Corrupt file** → an actionable error naming
  the file path; the file is left untouched, never overwritten.
- This MVP has no `set_active_profile`-creates-profile flow — seed
  `profiles.json` by copying `profiles.example.json` into place (respecting
  the permissions above) and editing it before using the profile tools.

### Switching the active profile

- `set_active_profile({ profile: "work" })` — switches to an existing
  profile. Errors with an actionable message (listing available profiles)
  if the name doesn't exist; the active profile is left unchanged on error.
- `get_active_profile()` — returns the current active profile and its
  resolved defaults, or an explicit "no active profile" result.
- `set_default_workspace({ workspace: "acme-ws" })` — persists a default
  workspace on the active (or an explicitly named) profile.
- `clear_default_workspace()` — removes the persisted default. Idempotent:
  calling it twice with nothing set does not error.

### `workspace` vs `repo` resolution

`workspace` has a 4-level precedence: **explicit tool argument > process
env override (`BITBUCKET_WORKSPACE`) > active profile's default > actionable
error** (no HTTP request is ever attempted on the error path).

`repo` is **always an explicit, required tool argument** on every tool that
needs one — it has **no** env override and **no** profile-default
auto-application, even though a profile may record a `defaultRepo` for your
own reference (surfaced by `list_profiles`/`get_active_profile`). This is a
deliberate asymmetry: workspace-level defaults make sense for "my usual
workspace", but silently defaulting the *repository* you're about to read
or write against was judged too easy to get wrong.

## Using this server from an MCP client

Point your MCP client at the built server over stdio. Example
configuration (Claude Code / Codex-style JSON config):

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "node",
      "args": ["/absolute/path/to/bitbucket-mcp/dist/index.js"],
      "env": {
        "BITBUCKET_EMAIL": "you@example.com",
        "BITBUCKET_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

For local development without a build step, swap the `command`/`args` for:

```json
{ "command": "npx", "args": ["-y", "tsx", "/absolute/path/to/bitbucket-mcp/src/index.ts"] }
```

## Tools

18 tools total: 13 talk to the Bitbucket API, 5 are local-only (never make a
network call, only read/write `profiles.json`).

### Read-only (Bitbucket)

| Tool | Description |
|---|---|
| `list_workspaces` | Lists every workspace the credentials can access. No arguments. |
| `list_repositories` | Lists every repository in a workspace, fully paginated. |
| `get_repository` | Details for a single repository (`repo` required). |
| `list_branches` | Lists every branch in a repository, fully paginated. Optional `name` partial filter. |
| `get_branch` | Details for a single branch (`repo` + `branch` required). |
| `list_pull_requests` | Lists PRs in a repository, filterable by `state` (default `OPEN`). |
| `get_pull_request` | Full metadata for a single PR. |
| `get_pr_commits` | Every commit on a PR, fully paginated. |
| `get_pr_diff` | Unified diff as plain text, capped at 100,000 chars by default (`maxChars` optional, hard cap 400,000). See below. |
| `list_pr_comments` | Every comment (inline + general) on a PR, fully paginated. |

### Write (Bitbucket)

| Tool | Description |
|---|---|
| `create_pr_comment` | Posts a comment on a PR. Rejects empty content before any Bitbucket call. |
| `create_pull_request` | Opens a PR. Verifies source and destination branches exist first — never leaves a partial PR behind. |
| `update_pull_request` | Updates title/description/destination branch/reviewers only. Explicitly rejects `state` — merge/approve/decline are out of scope. |

### Local-only (never touch Bitbucket)

| Tool | Description |
|---|---|
| `list_profiles` | Lists configured profiles and their defaults. |
| `get_active_profile` | Returns the active profile's name and defaults. |
| `set_active_profile` | Switches the active profile (must already exist). |
| `set_default_workspace` | Persists a default workspace on a profile. |
| `clear_default_workspace` | Removes a profile's default workspace. Idempotent. |

`set_active_profile`, `set_default_workspace`, and `clear_default_workspace`
are marked `readOnly` from Bitbucket's point of view (they never touch the
Bitbucket API) but flagged `mutatesLocalConfig: true`, so they do write to
`profiles.json` on disk even though they carry the MCP `readOnlyHint`
w.r.t. the remote API.

### `get_pr_diff` size limit

`get_pr_diff` returns a plain-text unified diff. To stay well inside any MCP
client's context budget it is truncated by default at **100,000 characters**
(~25k tokens), always cut at the last full line before the limit so no line
is ever split mid-way. Pass `maxChars` to raise the limit, up to a hard cap
of **400,000**. The response always includes `{ diff, truncated,
returnedChars, hint? }` — a truncated diff can never be mistaken for the
complete one. On very large diffs Bitbucket itself may time out (HTTP 555);
prefer `get_pr_commits` for a per-commit view, or retry with a smaller
`maxChars`, instead of repeatedly retrying the same large diff.

## Manual smoke test

Because this server talks to the real Bitbucket API, end-to-end behavior is
verified manually against real workspaces rather than with automated
integration tests (see [Testing](#testing) below). Checklist:

1. `npm install && npm run build`.
2. Set `BITBUCKET_EMAIL`/`BITBUCKET_TOKEN` (API token) in the environment
   your MCP client launches the server with.
3. Optionally seed `profiles.json` by copying `profiles.example.json` into
   `${XDG_CONFIG_HOME:-~/.config}/bitbucket-mcp/profiles.json` and editing
   it with a real profile name and a workspace slug you have access to.
4. Point your MCP client at `node dist/index.js` as a stdio MCP server (see
   the config example above).
5. Against at least two real, accessible workspaces, exercise every tool
   and confirm each response is well-formed with no thrown exceptions and
   no credential values ever appearing in any response or error message:
   `list_workspaces`, `list_profiles`, `get_active_profile`,
   `set_active_profile` (including a nonexistent-profile error case),
   `set_default_workspace`, `clear_default_workspace` (including the
   idempotent no-op case), `list_repositories`, `get_repository` (including
   a not-found case), `list_branches`, `get_branch`, `list_pull_requests`,
   `get_pull_request`, `get_pr_commits`, `get_pr_diff`, `list_pr_comments`,
   `create_pr_comment`, `create_pull_request`, `update_pull_request`
   (including the rejected-`state` case).

## Testing

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```

Automated tests are **unit-only**, covering the purest and most
error-prone logic in the system with an injected `fetch`/`ProfileStore` —
no real HTTP call is ever made in the test suite:

- `src/config/context.test.ts` — the 4-level `workspace` precedence (arg >
  env > active profile > actionable error).
- `src/bitbucket/pagination.test.ts` — `next`-link traversal (full URL,
  never a hand-built `?page=N`), multi-page aggregation, single-page
  termination.
- `src/bitbucket/errors.test.ts` — HTTP status code → typed error mapping
  (401/403 → `AuthError`, 404 → `NotFoundError`, 429 → `RateLimitError`,
  555/5xx → `UpstreamTimeoutError`, network failure → `NetworkError`,
  missing credentials → `ConfigError` before any request), plus a check
  that no thrown error ever contains the configured email or token.

Tool handlers and end-to-end HTTP behavior are **not** covered by automated
tests in this MVP — that's the manual smoke test above.

## Out of scope / next steps

Deliberately not implemented in this MVP:

- Approving, declining, or merging pull requests (`update_pull_request`
  explicitly rejects any `state` change).
- Issues.
- Pipelines.
- Webhooks.
- A `create_profile` tool — profiles are seeded by hand (copy
  `profiles.example.json`, edit, place at the resolved `profiles.json`
  path).
- Automated integration/E2E tests against the real Bitbucket API (no
  fixtures exist for it yet — verification is the manual checklist above).
