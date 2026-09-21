# MCP Server Runtime Specification

## Purpose

Bootstraps the MCP server, registers all MVP tools over stdio, and defines cross-cutting behavior shared by every tool: read/write metadata, structured error responses, and credential redaction.

## Requirements

### Requirement: Server Bootstrap and Tool Registration

The system MUST start an MCP server over the stdio transport using the official MCP SDK, and MUST register every MVP tool (config, read, write) at startup before accepting requests.

#### Scenario: Server starts and exposes MVP tools

- GIVEN valid environment configuration
- WHEN the server process starts
- THEN it registers all MVP tools (`list_workspaces`, `list_profiles`, `get_active_profile`, `set_active_profile`, `set_default_workspace`, `clear_default_workspace`, `list_repositories`, `get_repository`, `list_branches`, `get_branch`, `list_pull_requests`, `get_pull_request`, `get_pr_commits`, `get_pr_diff`, `list_pr_comments`, `create_pr_comment`, `create_pull_request`, `update_pull_request`)
- AND accepts requests over stdio

#### Scenario: Missing required environment variables

- GIVEN `BITBUCKET_EMAIL` or `BITBUCKET_TOKEN` is not set
- WHEN the server starts
- THEN it MUST fail fast with an actionable startup error naming the missing variable
- AND MUST NOT start accepting tool calls with incomplete credentials

### Requirement: Read/Write Metadata Per Tool

Each registered tool MUST declare a `readOnly: true|false` flag as registry metadata, distinguishing Bitbucket-mutating operations from read and local-config operations.

#### Scenario: Config and read tools are marked read-only

- GIVEN the tool registry
- WHEN `get_active_profile`, `list_profiles`, `set_active_profile`, `set_default_workspace`, `clear_default_workspace`, or any `list_*`/`get_*` Bitbucket tool is inspected
- THEN its metadata reports `readOnly: true`

#### Scenario: Bitbucket write tools are marked as write

- GIVEN the tool registry
- WHEN `create_pr_comment`, `create_pull_request`, or `update_pull_request` is inspected
- THEN its metadata reports `readOnly: false`

### Requirement: Structured Error Envelope

The system MUST translate every failure (validation, client, network, Bitbucket API) into a structured, actionable MCP error response instead of an unhandled exception or raw stack trace.

#### Scenario: Invalid tool input

- GIVEN a tool call with input failing its Zod schema
- WHEN the tool executes
- THEN the response is a structured error naming the invalid field and expected shape
- AND no partial Bitbucket request is made

#### Scenario: Upstream failure surfaces as actionable error

- GIVEN a Bitbucket API call fails (auth, not found, rate limit, network)
- WHEN the tool returns
- THEN the error response includes a human-readable cause and, when applicable, a suggested next action (e.g. "check BITBUCKET_TOKEN")

### Requirement: Credential Redaction

The system MUST NOT write `BITBUCKET_TOKEN`, `BITBUCKET_EMAIL`, or any derived Authorization header value to logs, error messages, or stdout/stderr under any code path.

#### Scenario: Auth failure does not leak credentials

- GIVEN an authentication error from Bitbucket (401/403)
- WHEN the error is logged or returned to the MCP client
- THEN the token and email values are absent or masked in the output

#### Scenario: Debug/verbose logging still redacts secrets

- GIVEN verbose logging is enabled
- WHEN an outgoing HTTP request is logged
- THEN the Authorization header value is redacted (e.g. `Authorization: [REDACTED]`)
