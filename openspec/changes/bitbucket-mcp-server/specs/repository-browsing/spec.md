# Repository Browsing Specification

## Purpose

Defines read-only tools for browsing repositories and branches within a resolved workspace: `list_repositories`, `get_repository`, `list_branches`, `get_branch`.

## Requirements

### Requirement: List Repositories in a Workspace

The system MUST expose `list_repositories` as a read-only tool that resolves `workspace` per the standard precedence and returns all repositories in that workspace, fully paginated.

#### Scenario: Explicit workspace with multiple repositories

- GIVEN `workspace` is provided explicitly and contains several repositories
- WHEN `list_repositories` is called
- THEN it returns every repository's slug and name, aggregated across all pages

#### Scenario: Workspace unresolvable

- GIVEN no `workspace` argument and no active profile default
- WHEN `list_repositories` is called
- THEN it returns the standard workspace-resolution error without calling Bitbucket

### Requirement: Get Repository Details

The system MUST expose `get_repository` as a read-only tool that resolves `workspace` and requires an explicit `repo` argument, returning repository metadata.

#### Scenario: Repository exists

- GIVEN a resolved workspace and a valid `repo` slug
- WHEN `get_repository` is called
- THEN it returns the repository's details (name, description, main branch, links)

#### Scenario: Repository does not exist

- GIVEN a resolved workspace and a `repo` slug that does not exist
- WHEN `get_repository` is called
- THEN it returns a typed "not found" error naming the workspace and repo

### Requirement: List Branches

The system MUST expose `list_branches` as a read-only tool that resolves `workspace`, requires `repo`, and returns all branches of that repository, fully paginated.

#### Scenario: Repository has multiple branches

- GIVEN a resolved workspace and repo with several branches
- WHEN `list_branches` is called
- THEN it returns every branch name and target commit, aggregated across all pages

#### Scenario: Repo argument missing

- GIVEN `repo` is not provided
- WHEN `list_branches` is called
- THEN it returns a validation error naming `repo` as required, before any Bitbucket call

### Requirement: Get Branch Details

The system MUST expose `get_branch` as a read-only tool that resolves `workspace`, requires `repo` and `branch`, and returns details of that specific branch.

#### Scenario: Branch exists

- GIVEN a resolved workspace/repo and an existing `branch` name
- WHEN `get_branch` is called
- THEN it returns the branch's target commit and metadata

#### Scenario: Branch does not exist

- GIVEN a resolved workspace/repo and a nonexistent `branch` name
- WHEN `get_branch` is called
- THEN it returns a typed "not found" error naming the branch
