import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchGet,
  fetchPost,
  fetchGraphql,
  fetchGetWithinPage,
  fetchPostWithinPage,
} from "../src/fetch-utils.js";

// ── Node-side helpers ─────────────────────────────────────────────────────────

describe("fetchGet", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed JSON on 200", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const result = await fetchGet<{ ok: boolean }>("https://example.com/api");
    expect(result).toEqual({ ok: true });
  });

  it("throws on non-ok status", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    await expect(fetchGet("https://example.com/api")).rejects.toThrow("404");
  });
});

describe("fetchPost", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends POST with JSON body and returns parsed response", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ created: true }), { status: 200 }),
    );
    const result = await fetchPost<{ created: boolean }>("https://example.com/api", {
      name: "test",
    });
    expect(result).toEqual({ created: true });
    const call = mockFetch.mock.calls[0];
    expect(call[1]?.method).toBe("POST");
    expect(call[1]?.body).toBe(JSON.stringify({ name: "test" }));
  });
});

describe("fetchGraphql", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns data field on success", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { user: { id: "1" } } }), { status: 200 }),
    );
    const result = await fetchGraphql<{ user: { id: string } }>(
      "https://example.com/graphql",
      "{ user { id } }",
    );
    expect(result).toEqual({ user: { id: "1" } });
  });

  it("throws when response contains errors", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ errors: [{ message: "Unauthorized" }] }),
        { status: 200 },
      ),
    );
    await expect(
      fetchGraphql("https://example.com/graphql", "{ user { id } }"),
    ).rejects.toThrow("Unauthorized");
  });
});

// ── In-page fetch helpers (page.evaluate mock) ────────────────────────────────

function makeMockPage(evaluateResult: unknown) {
  return {
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
  };
}

describe("fetchGetWithinPage", () => {
  it("returns parsed JSON when page.evaluate returns a string", async () => {
    const page = makeMockPage([JSON.stringify({ items: [1, 2] }), 200]);
    const result = await fetchGetWithinPage<{ items: number[] }>(
      page as never,
      "https://example.com/api",
    );
    expect(result).toEqual({ items: [1, 2] });
  });

  it("returns null on 204 (no content)", async () => {
    const page = makeMockPage([null, 204]);
    const result = await fetchGetWithinPage(page as never, "https://example.com/api");
    expect(result).toBeNull();
  });

  it("throws on JSON parse error when ignoreErrors is false (default)", async () => {
    const page = makeMockPage(["not-json", 200]);
    await expect(
      fetchGetWithinPage(page as never, "https://example.com/api"),
    ).rejects.toThrow("parse error");
  });

  it("returns null on JSON parse error when ignoreErrors is true", async () => {
    const page = makeMockPage(["not-json", 200]);
    const result = await fetchGetWithinPage(page as never, "https://example.com/api", true);
    expect(result).toBeNull();
  });
});

describe("fetchPostWithinPage", () => {
  it("returns parsed JSON when page.evaluate returns a string", async () => {
    const page = makeMockPage(JSON.stringify({ success: true }));
    const result = await fetchPostWithinPage<{ success: boolean }>(
      page as never,
      "https://example.com/api",
      { key: "value" },
    );
    expect(result).toEqual({ success: true });
  });

  it("returns null when page.evaluate returns null (204-like)", async () => {
    const page = makeMockPage(null);
    const result = await fetchPostWithinPage(
      page as never,
      "https://example.com/api",
      {},
    );
    expect(result).toBeNull();
  });
});
