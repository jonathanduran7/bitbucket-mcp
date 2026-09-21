# Profile Configuration Specification

## Purpose

Defines profiles (name, default workspace, optional default repo), the active profile, and workspace/repo resolution used by every Bitbucket-facing tool. Covers `list_profiles`, `get_active_profile`, `set_active_profile`, `set_default_workspace`, `clear_default_workspace`.

## Requirements

### Requirement: List Configured Profiles

The system MUST expose `list_profiles` as a read-only, local-only operation that returns all configured profiles without contacting Bitbucket.

#### Scenario: Profiles exist

- GIVEN one or more profiles are configured
- WHEN `list_profiles` is called
- THEN it returns each profile's name and configured defaults
- AND makes no Bitbucket API call

#### Scenario: No profiles configured

- GIVEN no profiles exist
- WHEN `list_profiles` is called
- THEN it returns an empty list with a message indicating none are configured, not an error

### Requirement: Get Active Profile

The system MUST expose `get_active_profile` returning the currently active profile's name and resolved defaults, as a local-only read operation.

#### Scenario: Active profile is set

- GIVEN a profile is marked active
- WHEN `get_active_profile` is called
- THEN it returns that profile's name, default workspace, and default repo (if any)

#### Scenario: No active profile set

- GIVEN no profile is marked active
- WHEN `get_active_profile` is called
- THEN it returns a clear "no active profile" result, not an exception

### Requirement: Switch Active Profile

The system MUST expose `set_active_profile` to change which profile is active, as a local configuration change — it MUST NOT be treated as a Bitbucket write operation.

#### Scenario: Switch to an existing profile

- GIVEN a profile named `X` exists
- WHEN `set_active_profile` is called with `X`
- THEN subsequent tool calls resolve workspace/repo defaults from `X`
- AND no Bitbucket API call is made by this tool itself

#### Scenario: Switch to a nonexistent profile

- GIVEN no profile named `Y` exists
- WHEN `set_active_profile` is called with `Y`
- THEN the tool returns an actionable error listing available profile names
- AND the active profile is left unchanged

### Requirement: Set Default Workspace

The system MUST expose `set_default_workspace` to persist a default workspace on the active (or specified) profile, as a local configuration change, not a Bitbucket write.

#### Scenario: Set default workspace on active profile

- GIVEN an active profile exists
- WHEN `set_default_workspace` is called with a workspace slug
- THEN the profile's default workspace is persisted
- AND future tool calls without an explicit `workspace` argument resolve to it

### Requirement: Clear Default Workspace

The system MUST expose `clear_default_workspace` to remove a profile's persisted default workspace as a local configuration change.

#### Scenario: Clear an existing default

- GIVEN the active profile has a default workspace set
- WHEN `clear_default_workspace` is called
- THEN the profile's default workspace is removed
- AND subsequent calls without explicit `workspace` fall back to the error path

#### Scenario: Clear when nothing is set

- GIVEN the active profile has no default workspace
- WHEN `clear_default_workspace` is called
- THEN it succeeds idempotently without error

### Requirement: Workspace Resolution Precedence

For every Bitbucket-facing tool accepting `workspace`, the system MUST resolve it in this order: explicit tool argument, then a process-level environment override (e.g. `BITBUCKET_WORKSPACE`), then the active profile's configured default, then an actionable error naming exactly which value is missing and which tool to call to set it.

This precedence applies to `workspace` only. `repo` is NOT resolved through this chain — per `repository-browsing/spec.md` and `pull-request-management/spec.md`, every tool that needs a repo requires it as an explicit argument, rejected by validation before any resolution or Bitbucket call if omitted. A profile's `defaultRepo` (if set) is informational only, surfaced by `list_profiles`/`get_active_profile`, and is never auto-applied to a tool call.

#### Scenario: Explicit argument overrides everything

- GIVEN the active profile has default workspace `acme` and an environment override of `env-ws` is set
- WHEN a tool is called with `workspace: "other-ws"`
- THEN the tool operates against `other-ws`, ignoring both the environment override and the profile default

#### Scenario: Environment override applies when no explicit argument is passed

- GIVEN the active profile has default workspace `acme` and an environment override of `env-ws` is set
- WHEN a tool resolves workspace without an explicit `workspace` argument
- THEN it uses `env-ws`, ignoring the profile default

#### Scenario: No explicit argument, no environment override, profile default exists

- GIVEN the active profile has default workspace `acme`, no `workspace` argument is passed, and no environment override is set
- WHEN a tool resolves workspace
- THEN it uses `acme`

#### Scenario: Nothing resolvable

- GIVEN no `workspace` argument is passed, no environment override is set, and no active profile has a default workspace
- WHEN a tool attempts to resolve workspace
- THEN it returns an actionable error stating no workspace is configured and naming `set_default_workspace` (or the explicit argument, or the environment override) as the fix
- AND makes no Bitbucket API call
