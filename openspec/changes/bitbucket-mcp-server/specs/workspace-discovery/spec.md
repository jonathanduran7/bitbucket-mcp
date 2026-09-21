# Workspace Discovery Specification

## Purpose

Defines `list_workspaces`, the only tool that discovers which Bitbucket workspaces the authenticated account can access. It requires no workspace resolution since its purpose is precisely to enumerate them.

## Requirements

### Requirement: List Accessible Workspaces

The system MUST expose `list_workspaces` as a read-only tool that returns all workspaces the authenticated credentials can access, fully paginated, with no `workspace` argument required.

#### Scenario: Multiple workspaces accessible

- GIVEN the authenticated account has access to two or more workspaces
- WHEN `list_workspaces` is called
- THEN it returns the slug and name of every accessible workspace, aggregated across all pages

#### Scenario: No workspaces accessible

- GIVEN the authenticated account has access to zero workspaces
- WHEN `list_workspaces` is called
- THEN it returns an empty list with a clear message, not an error

#### Scenario: Credentials invalid

- GIVEN `BITBUCKET_TOKEN` is invalid or expired
- WHEN `list_workspaces` is called
- THEN it returns the typed auth error from the client, without leaking credential values
