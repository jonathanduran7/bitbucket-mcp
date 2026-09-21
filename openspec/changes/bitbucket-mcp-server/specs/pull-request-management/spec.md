# Pull Request Management Specification

## Purpose

Defines read and write tools over pull requests within a resolved workspace/repo: `list_pull_requests`, `get_pull_request`, `get_pr_commits`, `get_pr_diff`, `list_pr_comments`, `create_pr_comment`, `create_pull_request`, `update_pull_request`. Merge, approve, and decline are explicitly out of scope.

## Requirements

### Requirement: List Pull Requests

The system MUST expose `list_pull_requests` as a read-only tool that resolves `workspace`, requires `repo`, supports filtering by state (e.g. open/merged/declined), and returns results fully paginated.

#### Scenario: Open pull requests exist

- GIVEN a resolved workspace/repo with open PRs
- WHEN `list_pull_requests` is called with no state filter
- THEN it returns open PRs by default, aggregated across all pages

#### Scenario: Filter by state

- GIVEN a resolved workspace/repo
- WHEN `list_pull_requests` is called with `state: "MERGED"`
- THEN only merged pull requests are returned

### Requirement: Get Pull Request Details

The system MUST expose `get_pull_request` as a read-only tool requiring `repo` and a PR identifier, returning full PR metadata.

#### Scenario: PR exists

- GIVEN a resolved workspace/repo and a valid PR id
- WHEN `get_pull_request` is called
- THEN it returns title, description, author, source/destination branches, and state

#### Scenario: PR does not exist

- GIVEN a resolved workspace/repo and an invalid PR id
- WHEN `get_pull_request` is called
- THEN it returns a typed "not found" error naming the PR id

### Requirement: List PR Commits

The system MUST expose `get_pr_commits` as a read-only tool returning all commits belonging to a PR, fully paginated.

#### Scenario: PR has multiple commits

- GIVEN a valid PR with several commits
- WHEN `get_pr_commits` is called
- THEN it returns every commit's hash, message, and author, aggregated across all pages

### Requirement: Get PR Diff with Size Control

The system MUST expose `get_pr_diff` as a read-only tool returning the PR's diff, and MUST enforce a size limit with explicit truncation when the diff exceeds it, rather than returning unbounded payloads.

#### Scenario: Diff within limit

- GIVEN a PR with a small diff
- WHEN `get_pr_diff` is called
- THEN the full diff is returned

#### Scenario: Diff exceeds size limit

- GIVEN a PR with a very large diff
- WHEN `get_pr_diff` is called
- THEN the response is truncated at the defined limit
- AND the response explicitly indicates truncation occurred, so the caller does not mistake it for the complete diff

### Requirement: List PR Comments

The system MUST expose `list_pr_comments` as a read-only tool returning all comments on a PR, fully paginated.

#### Scenario: PR has comments

- GIVEN a PR with multiple comments, some inline and some general
- WHEN `list_pr_comments` is called
- THEN it returns every comment's author, content, and location (if inline), aggregated across all pages

### Requirement: Create PR Comment

The system MUST expose `create_pr_comment` as a write tool that posts a new comment to an existing PR, requiring `repo`, PR id, and comment content.

#### Scenario: Successful comment creation

- GIVEN a valid PR and non-empty comment content
- WHEN `create_pr_comment` is called
- THEN a new comment is created on Bitbucket
- AND the tool returns the created comment's id and content

#### Scenario: Empty comment content

- GIVEN comment content is empty or whitespace-only
- WHEN `create_pr_comment` is called
- THEN it returns a validation error before making any Bitbucket call

### Requirement: Create Pull Request

The system MUST expose `create_pull_request` as a write tool that opens a new PR, requiring `repo`, source branch, destination branch, and title.

#### Scenario: Successful PR creation

- GIVEN valid source/destination branches that both exist and a non-empty title
- WHEN `create_pull_request` is called
- THEN a new PR is created on Bitbucket
- AND the tool returns the created PR's id and URL

#### Scenario: Source or destination branch missing

- GIVEN the source or destination branch does not exist in the repository
- WHEN `create_pull_request` is called
- THEN it returns a typed error naming the missing branch, without creating a partial PR

### Requirement: Update Pull Request

The system MUST expose `update_pull_request` as a write tool limited to updating PR metadata (title, description, destination branch, reviewers), and MUST NOT perform merge, approve, or decline actions.

#### Scenario: Update title and description

- GIVEN an existing open PR
- WHEN `update_pull_request` is called with a new title and description
- THEN the PR is updated on Bitbucket
- AND the tool returns the updated PR metadata

#### Scenario: Attempt to change PR state via update

- GIVEN a caller attempts to pass a merge/approve/decline action through `update_pull_request`
- WHEN the tool validates input
- THEN it rejects the request with an error stating those actions are out of scope for this tool
