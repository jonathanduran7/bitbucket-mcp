# Manual Smoke Test Checklist (draft — merges into README in Phase 15)

Checkpoint for tasks.md Phase 10. Run this manually against **at least two
real Bitbucket workspaces** before starting Phase 11 (branches). This is
intentionally NOT automated — it exercises the server end-to-end from a real
MCP client against the real Bitbucket API, which the vitest unit tests
(Phase 14) deliberately do not cover.

## Setup

1. `npm install && npx tsc` (or `npm run build`, once scripted) to produce `dist/`.
2. Set `BITBUCKET_EMAIL` and `BITBUCKET_TOKEN` (API token, not an app password)
   in the environment the MCP client will launch the server with.
3. Optionally seed `${XDG_CONFIG_HOME:-~/.config}/bitbucket-mcp/profiles.json`
   by copying `profiles.example.json` and editing it with a real profile name
   and a workspace slug you have access to (`set_active_profile` only
   switches between existing profiles — it does not create them).
4. Point your MCP client (e.g. Claude Code) at `node dist/index.js` as a
   stdio MCP server.

## Checklist

For each of the two target workspaces, exercise every tool below and
confirm the response is well-formed and matches expectations (no thrown
exceptions, no credential values in any response or error message):

- [ ] `list_workspaces` — returns both target workspaces (slug + name), no
      `workspace` argument needed.
- [ ] `list_profiles` — returns the seeded profile(s), or an explicit "no
      profiles configured" message if none seeded yet.
- [ ] `get_active_profile` — returns the active profile's defaults, or an
      explicit "no active profile" result if none is set.
- [ ] `set_active_profile` — switch to an existing profile; confirm
      `get_active_profile` reflects the change. Then try a nonexistent
      profile name and confirm an actionable error listing available
      profiles, with the active profile left unchanged.
- [ ] `set_default_workspace` — set a default workspace on the active
      profile; confirm a subsequent `list_repositories` call with no
      `workspace` argument resolves to it.
- [ ] `clear_default_workspace` — clear the default; confirm
      `list_repositories` with no `workspace` argument now returns the
      actionable "no workspace configured" error. Call it a second time
      with nothing set and confirm it succeeds idempotently (no error).
- [ ] `list_repositories` — with an explicit `workspace` argument, returns
      every repository in that workspace (paginated correctly if the
      workspace has more than 100 repos, i.e. more than one page).
- [ ] `get_repository` — with a valid `repo` slug, returns repository
      details (name, description, main branch). With an invalid `repo`
      slug, returns a typed "not found" error naming the workspace and
      repo.

## Result Log

| Date | Workspace | Tools exercised | Result | Notes |
|------|-----------|------------------|--------|-------|
| _pending_ | _pending_ | _pending_ | _pending_ | Requires a human operator with real Bitbucket credentials and at least two accessible workspaces — cannot be executed by an automated agent. See apply-progress risk notes. |

**Status**: 10.1 (this checklist) is complete. 10.2 (actual execution against
2 real workspaces) is **NOT YET DONE** — it requires a human with valid
`BITBUCKET_EMAIL`/`BITBUCKET_TOKEN` credentials and access to two real
workspaces to run the checklist above and fill in the Result Log before
Phase 11 starts.
