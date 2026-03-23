import { describe, it, expect } from "vitest";
import { defineAdapter } from "../src/define-adapter.js";
import type { SiteAdapter } from "../src/types.js";
import type { Page } from "playwright";
import { z } from "zod";

function makeMockAdapter(overrides: Partial<SiteAdapter> = {}): SiteAdapter {
  return {
    site: "test-site",
    domain: "test.example.com",
    loginUrl: "https://test.example.com/login",
    isLoggedIn: async (_page: Page) => true,
    tools: () => [
      {
        name: "get_data",
        description: "Get some data",
        inputSchema: z.object({ query: z.string() }),
        handler: async (_page: Page, _input: unknown) => ({
          content: [{ type: "text" as const, text: "ok" }],
        }),
      },
    ],
    ...overrides,
  };
}

describe("defineAdapter", () => {
  it("returns the adapter unchanged when valid", () => {
    const adapter = makeMockAdapter();
    const result = defineAdapter(adapter);
    expect(result).toBe(adapter);
  });

  it("throws when site is missing", () => {
    expect(() => defineAdapter(makeMockAdapter({ site: "" }))).toThrow(/site/);
  });

  it("throws when loginUrl is not a valid URL", () => {
    expect(() =>
      defineAdapter(makeMockAdapter({ loginUrl: "not-a-url" }))
    ).toThrow(/loginUrl/);
  });

  it("throws when tools have duplicate names", () => {
    expect(() =>
      defineAdapter(
        makeMockAdapter({
          tools: () => {
            const tool = {
              name: "dupe",
              description: "desc",
              inputSchema: z.object({}),
              handler: async (_page: Page, _input: unknown) => ({
                content: [{ type: "text" as const, text: "" }],
              }),
            };
            return [tool, { ...tool }];
          },
        })
      )
    ).toThrow(/duplicate/i);
  });

  it("throws when rateLimit.minDelayMs is non-positive", () => {
    expect(() =>
      defineAdapter(makeMockAdapter({ rateLimit: { minDelayMs: -1 } }))
    ).toThrow(/minDelayMs/);
  });
});
