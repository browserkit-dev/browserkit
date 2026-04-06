import { describe, it, expect, vi } from "vitest";
import {
  chunk,
  getCurrentUrl,
  waitForRedirect,
  waitForUrl,
  elementPresentOnPage,
  pageEval,
  pageEvalAll,
  getFromSessionStorage,
} from "../src/adapter-utils.js";

// ── chunk ─────────────────────────────────────────────────────────────────────

describe("chunk", () => {
  it("splits an array into equal chunks", () => {
    expect(chunk([1, 2, 3, 4, 6], 2)).toEqual([[1, 2], [3, 4], [6]]);
  });

  it("returns the whole array as one chunk when size >= length", () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("handles an empty array", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("throws for non-positive size", () => {
    expect(() => chunk([1], 0)).toThrow("positive");
    expect(() => chunk([1], -1)).toThrow("positive");
  });
});

// ── getCurrentUrl ─────────────────────────────────────────────────────────────

describe("getCurrentUrl", () => {
  it("returns page.url() by default", async () => {
    const page = { url: () => "https://example.com/feed", evaluate: vi.fn() };
    const result = await getCurrentUrl(page as never);
    expect(result).toBe("https://example.com/feed");
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("uses evaluate when clientSide=true", async () => {
    const page = {
      url: () => "https://example.com/old",
      evaluate: vi.fn().mockResolvedValue("https://example.com/new#hash"),
    };
    const result = await getCurrentUrl(page as never, true);
    expect(result).toBe("https://example.com/new#hash");
    expect(page.evaluate).toHaveBeenCalled();
  });
});

// ── waitForRedirect ───────────────────────────────────────────────────────────

describe("waitForRedirect", () => {
  it("resolves when the URL changes from the initial value", async () => {
    let call = 0;
    const page = {
      url: () => {
        call++;
        return call < 3 ? "https://example.com/start" : "https://example.com/dest";
      },
      evaluate: vi.fn(),
    };
    await expect(waitForRedirect(page as never, 2_000, false, [])).resolves.toBeUndefined();
  });

  it("rejects with TimeoutError when URL never changes", async () => {
    const { TimeoutError } = await import("../src/waiting.js");
    const page = { url: () => "https://example.com/stuck", evaluate: vi.fn() };
    await expect(waitForRedirect(page as never, 150, false, [])).rejects.toBeInstanceOf(TimeoutError);
  });

  it("skips URLs in the ignoreList", async () => {
    let call = 0;
    const urls = [
      "https://example.com/start",
      "https://example.com/loading",  // ignored
      "https://example.com/dest",
    ];
    const page = { url: () => urls[Math.min(call++, urls.length - 1)], evaluate: vi.fn() };
    await expect(
      waitForRedirect(page as never, 2_000, false, ["https://example.com/loading"]),
    ).resolves.toBeUndefined();
  });
});

// ── waitForUrl ────────────────────────────────────────────────────────────────

describe("waitForUrl", () => {
  it("resolves when the URL exactly matches the target string", async () => {
    let call = 0;
    const page = {
      url: () => (call++ === 0 ? "https://example.com/a" : "https://example.com/b"),
      evaluate: vi.fn(),
    };
    await expect(waitForUrl(page as never, "https://example.com/b", 2_000)).resolves.toBeUndefined();
  });

  it("resolves when the URL matches a regex", async () => {
    let call = 0;
    const page = {
      url: () => (call++ === 0 ? "https://example.com/login" : "https://example.com/dashboard"),
      evaluate: vi.fn(),
    };
    await expect(waitForUrl(page as never, /dashboard/i, 2_000)).resolves.toBeUndefined();
  });

  it("rejects with TimeoutError when URL never matches", async () => {
    const { TimeoutError } = await import("../src/waiting.js");
    const page = { url: () => "https://example.com/nope", evaluate: vi.fn() };
    await expect(waitForUrl(page as never, "/target", 150)).rejects.toBeInstanceOf(TimeoutError);
  });
});

// ── elementPresentOnPage ──────────────────────────────────────────────────────

describe("elementPresentOnPage", () => {
  it("returns true when locator count > 0", async () => {
    const page = { locator: () => ({ count: async () => 2 }) };
    expect(await elementPresentOnPage(page as never, ".foo")).toBe(true);
  });

  it("returns false when locator count is 0", async () => {
    const page = { locator: () => ({ count: async () => 0 }) };
    expect(await elementPresentOnPage(page as never, ".foo")).toBe(false);
  });
});

// ── pageEval ──────────────────────────────────────────────────────────────────

describe("pageEval", () => {
  it("returns callback result when element is found", async () => {
    const page = {
      locator: () => ({
        count: async () => 1,
        first: () => ({ evaluate: async (cb: (el: Element) => string) => cb({ textContent: "hello" } as unknown as Element) }),
      }),
    };
    const result = await pageEval(
      page as never,
      ".el",
      "default",
      (el) => el.textContent ?? "default",
    );
    expect(result).toBe("hello");
  });

  it("returns defaultResult when no elements match", async () => {
    const page = { locator: () => ({ count: async () => 0, first: () => ({}) }) };
    const result = await pageEval(page as never, ".missing", "fallback", () => "found");
    expect(result).toBe("fallback");
  });

  it("returns defaultResult when evaluate throws", async () => {
    const page = {
      locator: () => ({
        count: async () => 1,
        first: () => ({ evaluate: async () => { throw new Error("DOM error"); } }),
      }),
    };
    const result = await pageEval(page as never, ".el", "fallback", () => "x");
    expect(result).toBe("fallback");
  });
});

// ── pageEvalAll ───────────────────────────────────────────────────────────────

describe("pageEvalAll", () => {
  it("returns callback result when elements are found", async () => {
    const page = {
      locator: () => ({
        evaluateAll: async (cb: (els: Element[]) => number) =>
          cb([{} as Element, {} as Element]),
      }),
    };
    const result = await pageEvalAll(page as never, "li", 0, (els) => els.length);
    expect(result).toBe(2);
  });

  it("returns defaultResult on error", async () => {
    const page = {
      locator: () => ({
        evaluateAll: async () => { throw new Error("oops"); },
      }),
    };
    const result = await pageEvalAll(page as never, "li", 99, (els) => els.length);
    expect(result).toBe(99);
  });
});

// ── getFromSessionStorage ─────────────────────────────────────────────────────

describe("getFromSessionStorage", () => {
  it("parses and returns stored JSON value", async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ token: "abc" })),
    };
    const result = await getFromSessionStorage<{ token: string }>(page as never, "auth-module");
    expect(result).toEqual({ token: "abc" });
  });

  it("returns null when key is absent", async () => {
    const page = { evaluate: vi.fn().mockResolvedValue(null) };
    expect(await getFromSessionStorage(page as never, "missing")).toBeNull();
  });

  it("returns null when stored value is invalid JSON", async () => {
    const page = { evaluate: vi.fn().mockResolvedValue("not-json{") };
    expect(await getFromSessionStorage(page as never, "bad")).toBeNull();
  });
});
