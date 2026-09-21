import type { PaginatedResponse } from "./types.js";

/**
 * Safety cap on the number of pages followed for a single logical list request.
 * Bitbucket's `next` link is a full URL: we never construct `?page=N` manually,
 * we just follow whatever `next` says until it's absent or we hit this cap.
 */
export const MAX_PAGES = 200;

export interface FetchPageFn<T> {
  (url: string): Promise<PaginatedResponse<T>>;
}

/**
 * Follows a paginated Bitbucket Cloud v2.0 list response end-to-end, aggregating
 * `values` across all pages by following the `next` field verbatim.
 *
 * @param initialUrl - full URL for the first page request (including pagelen, filters, etc.)
 * @param fetchPage - performs a single GET against a full URL and parses the envelope
 */
export async function paginateAll<T>(
  initialUrl: string,
  fetchPage: FetchPageFn<T>
): Promise<T[]> {
  const results: T[] = [];
  let url: string | undefined = initialUrl;
  let pagesFetched = 0;

  while (url) {
    if (pagesFetched >= MAX_PAGES) {
      break;
    }
    const page: PaginatedResponse<T> = await fetchPage(url);
    results.push(...page.values);
    pagesFetched += 1;
    url = page.next;
  }

  return results;
}
