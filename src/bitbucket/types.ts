/**
 * Bitbucket Cloud REST API v2.0 response types.
 * Only the fields this server actually consumes are modeled — not the full API surface.
 */

/** Generic paginated list envelope returned by Bitbucket Cloud v2.0 list endpoints. */
export interface PaginatedResponse<T> {
  size?: number;
  page?: number;
  pagelen: number;
  next?: string;
  previous?: string;
  values: T[];
}

export interface Workspace {
  uuid: string;
  slug: string;
  name: string;
}

export interface Repository {
  uuid: string;
  name: string;
  full_name: string;
  slug: string;
  is_private: boolean;
  description?: string;
  mainbranch?: { name: string };
  links?: { html?: { href: string } };
}

export interface Branch {
  name: string;
  target: {
    hash: string;
    date?: string;
    message?: string;
  };
}

export type PullRequestState = "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED";

export interface PullRequestEndpoint {
  branch: { name: string };
  repository?: { full_name: string };
}

export interface PullRequest {
  id: number;
  title: string;
  description?: string;
  state: PullRequestState;
  author?: { display_name?: string; account_id?: string };
  source: PullRequestEndpoint;
  destination: PullRequestEndpoint;
  created_on?: string;
  updated_on?: string;
  links?: { html?: { href: string } };
}

export interface Commit {
  hash: string;
  message: string;
  date?: string;
  author?: { raw?: string };
}

export interface Comment {
  id: number;
  content: { raw: string };
  user?: { display_name?: string };
  created_on?: string;
  inline?: { path: string; to?: number; from?: number };
}
