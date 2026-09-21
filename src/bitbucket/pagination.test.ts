import { describe, expect, it } from "vitest";

import { paginateAll } from "./pagination.js";
import type { PaginatedResponse } from "./types.js";

function page<T>(values: T[], next?: string): PaginatedResponse<T> {
  return { values, next, page: 1, pagelen: values.length, size: values.length };
}

describe("paginateAll", () => {
  it("stops after a single page when `next` is absent", async () => {
    const calls: string[] = [];
    const result = await paginateAll<number>("https://api.example.com/first", async (url) => {
      calls.push(url);
      return page([1, 2, 3]);
    });

    expect(result).toEqual([1, 2, 3]);
    expect(calls).toEqual(["https://api.example.com/first"]);
  });

  it("follows `next` verbatim across multiple pages and aggregates every value", async () => {
    const calls: string[] = [];
    const responses: Record<string, PaginatedResponse<number>> = {
      "https://api.example.com/p1": page([1, 2], "https://api.example.com/p2?cursor=abc"),
      "https://api.example.com/p2?cursor=abc": page([3, 4], "https://api.example.com/p3?cursor=def"),
      "https://api.example.com/p3?cursor=def": page([5]),
    };

    const result = await paginateAll<number>("https://api.example.com/p1", async (url) => {
      calls.push(url);
      const response = responses[url];
      if (!response) {
        throw new Error(`unexpected url requested: ${url}`);
      }
      return response;
    });

    expect(result).toEqual([1, 2, 3, 4, 5]);
    // The full `next` URL is followed verbatim — never rebuilt as `?page=N`.
    expect(calls).toEqual([
      "https://api.example.com/p1",
      "https://api.example.com/p2?cursor=abc",
      "https://api.example.com/p3?cursor=def",
    ]);
  });

  it("returns an empty array when the first page has no values and no `next`", async () => {
    const result = await paginateAll<number>("https://api.example.com/empty", async () => page([]));

    expect(result).toEqual([]);
  });
});
