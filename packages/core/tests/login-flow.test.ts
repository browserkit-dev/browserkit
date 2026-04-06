import { describe, it, expect, vi, beforeEach } from "vitest";
import { withLoginFlow } from "../src/login-flow.js";
import { LoginError } from "../src/types.js";
import type { LoginOptions } from "../src/types.js";

// ── Mock page factory ─────────────────────────────────────────────────────────
// Simulates enough of the Playwright Page API for withLoginFlow to run without
// a real browser.

function makePage(landingUrl: string) {
  let currentUrl = "about:blank";

  const locatorFactory = (selector: string) => ({
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(1),
    first: () => ({ evaluate: vi.fn().mockResolvedValue(null) }),
    waitFor: vi.fn().mockResolvedValue(undefined),
  });

  return {
    _currentUrl: () => currentUrl,
    url: () => currentUrl,
    goto: vi.fn().mockImplementation(async (url: string) => {
      currentUrl = url;
    }),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockImplementation(locatorFactory),
    evaluate: vi.fn().mockImplementation(async (fn: (url: string) => string) => {
      // Used by getCurrentUrl(clientSide=false) — not called in default path
      return currentUrl;
    }),
    // After submit, simulate navigation to landingUrl
    _simulateNavigation: () => { currentUrl = landingUrl; },
  };
}

// Base LoginOptions used across tests — credentials are placeholders
function baseOptions(overrides: Partial<LoginOptions> = {}): LoginOptions {
  return {
    loginUrl: "https://bank.example.com/login",
    fields: [
      { selector: "#user", value: "testuser" },
      { selector: "#pass", value: "testpass" },
    ],
    submitButtonSelector: "#submit",
    possibleResults: {
      SUCCESS:          [/dashboard/i],
      INVALID_PASSWORD: ["https://bank.example.com/login?error=bad-credentials"],
      CHANGE_PASSWORD:  [/change-password/i],
    },
    ...overrides,
  };
}

// ── LoginError ────────────────────────────────────────────────────────────────

describe("LoginError", () => {
  it("is an instanceof Error and LoginError", () => {
    const err = new LoginError("INVALID_PASSWORD", "bad password");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LoginError);
    expect(err.name).toBe("LoginError");
    expect(err.errorType).toBe("INVALID_PASSWORD");
    expect(err.message).toBe("bad password");
  });

  it("carries each AuthErrorType correctly", () => {
    const types = [
      "INVALID_PASSWORD",
      "CHANGE_PASSWORD",
      "ACCOUNT_BLOCKED",
      "SESSION_EXPIRED",
      "TIMEOUT",
      "GENERIC",
    ] as const;
    for (const t of types) {
      expect(new LoginError(t, "").errorType).toBe(t);
    }
  });
});

// ── withLoginFlow — SUCCESS paths ─────────────────────────────────────────────

describe("withLoginFlow — SUCCESS", () => {
  it("resolves when post-submit URL matches the SUCCESS pattern (regex)", async () => {
    const page = makePage("https://bank.example.com/dashboard");
    const opts = baseOptions({
      postAction: async () => { page._simulateNavigation(); },
    });
    await expect(withLoginFlow(page as never, opts)).resolves.toBeUndefined();
  });

  it("resolves when SUCCESS is an exact string match", async () => {
    const page = makePage("https://bank.example.com/home");
    const opts = baseOptions({
      possibleResults: { SUCCESS: ["https://bank.example.com/home"] },
      postAction: async () => { page._simulateNavigation(); },
    });
    await expect(withLoginFlow(page as never, opts)).resolves.toBeUndefined();
  });

  it("resolves when SUCCESS is an async predicate that returns true", async () => {
    const page = makePage("https://bank.example.com/anywhere");
    const opts = baseOptions({
      possibleResults: {
        SUCCESS: [async () => true],
      },
      postAction: async () => { page._simulateNavigation(); },
    });
    await expect(withLoginFlow(page as never, opts)).resolves.toBeUndefined();
  });

  it("calls checkReadiness when provided", async () => {
    const page = makePage("https://bank.example.com/dashboard");
    const checkReadiness = vi.fn().mockResolvedValue(undefined);
    const opts = baseOptions({
      checkReadiness,
      postAction: async () => { page._simulateNavigation(); },
    });
    await withLoginFlow(page as never, opts);
    expect(checkReadiness).toHaveBeenCalledOnce();
  });

  it("calls preAction before filling fields", async () => {
    const page = makePage("https://bank.example.com/dashboard");
    const order: string[] = [];
    const opts = baseOptions({
      preAction: async () => { order.push("pre"); },
      fields: [{ selector: "#user", value: "u" }],
      postAction: async () => { page._simulateNavigation(); order.push("post"); },
    });
    await withLoginFlow(page as never, opts);
    expect(order[0]).toBe("pre");
    expect(order[1]).toBe("post");
  });

  it("accepts a function as submitButtonSelector", async () => {
    const page = makePage("https://bank.example.com/dashboard");
    const submitFn = vi.fn().mockResolvedValue(undefined);
    const opts = baseOptions({
      submitButtonSelector: submitFn,
      postAction: async () => { page._simulateNavigation(); },
    });
    await withLoginFlow(page as never, opts);
    expect(submitFn).toHaveBeenCalledOnce();
  });

  it("sets User-Agent header when userAgent is provided", async () => {
    const page = makePage("https://bank.example.com/dashboard");
    const opts = baseOptions({
      userAgent: "Mozilla/5.0 TestAgent",
      postAction: async () => { page._simulateNavigation(); },
    });
    await withLoginFlow(page as never, opts);
    expect(page.setExtraHTTPHeaders).toHaveBeenCalledWith({
      "User-Agent": "Mozilla/5.0 TestAgent",
    });
  });
});

// ── withLoginFlow — definitive failures (LoginError) ─────────────────────────

describe("withLoginFlow — definitive LoginError", () => {
  it("throws LoginError(INVALID_PASSWORD) on exact URL match", async () => {
    const page = makePage("https://bank.example.com/login?error=bad-credentials");
    const opts = baseOptions({
      postAction: async () => { page._simulateNavigation(); },
    });
    const err = await withLoginFlow(page as never, opts).catch((e) => e);
    expect(err).toBeInstanceOf(LoginError);
    expect((err as LoginError).errorType).toBe("INVALID_PASSWORD");
  });

  it("throws LoginError(CHANGE_PASSWORD) on regex match", async () => {
    const page = makePage("https://bank.example.com/change-password");
    const opts = baseOptions({
      postAction: async () => { page._simulateNavigation(); },
    });
    const err = await withLoginFlow(page as never, opts).catch((e) => e);
    expect(err).toBeInstanceOf(LoginError);
    expect((err as LoginError).errorType).toBe("CHANGE_PASSWORD");
  });

  it("throws LoginError(GENERIC) when no pattern matches", async () => {
    const page = makePage("https://bank.example.com/unknown-page");
    const opts = baseOptions({
      postAction: async () => { page._simulateNavigation(); },
    });
    const err = await withLoginFlow(page as never, opts).catch((e) => e);
    expect(err).toBeInstanceOf(LoginError);
    expect((err as LoginError).errorType).toBe("GENERIC");
  });

  it("throws LoginError when async predicate returns true for a failure type", async () => {
    const page = makePage("https://bank.example.com/anywhere");
    const opts = baseOptions({
      possibleResults: {
        ACCOUNT_BLOCKED: [async () => true],
      },
      postAction: async () => { page._simulateNavigation(); },
    });
    const err = await withLoginFlow(page as never, opts).catch((e) => e);
    expect(err).toBeInstanceOf(LoginError);
    expect((err as LoginError).errorType).toBe("ACCOUNT_BLOCKED");
  });
});

// ── withLoginFlow — transient / unexpected errors ─────────────────────────────
// These should bubble up as plain Error (not LoginError) so callers know to
// fall back to human-handoff rather than treating it as a definitive failure.

describe("withLoginFlow — transient errors", () => {
  it("propagates a plain Error when page.goto throws", async () => {
    const page = makePage("https://bank.example.com/dashboard");
    (page.goto as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("net::ERR_CONNECTION_REFUSED"),
    );
    const err = await withLoginFlow(page as never, baseOptions()).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LoginError);
    expect((err as Error).message).toContain("ERR_CONNECTION_REFUSED");
  });

  it("propagates a plain Error when locator.fill throws (selector not found)", async () => {
    const page = makePage("https://bank.example.com/dashboard");
    // Override the locator for the first field to throw
    (page.locator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      fill: vi.fn().mockRejectedValue(new Error("Element not found: #user")),
      count: vi.fn().mockResolvedValue(1),
    }));
    const err = await withLoginFlow(page as never, baseOptions()).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LoginError);
  });
});

// ── withLoginFlow — predicate error tolerance ─────────────────────────────────

describe("withLoginFlow — predicate error tolerance", () => {
  it("skips a predicate that throws and continues to the next pattern", async () => {
    const page = makePage("https://bank.example.com/dashboard");
    const opts = baseOptions({
      possibleResults: {
        INVALID_PASSWORD: [async () => { throw new Error("predicate boom"); }],
        SUCCESS: [/dashboard/i],
      },
      postAction: async () => { page._simulateNavigation(); },
    });
    // Should resolve (SUCCESS) even though the INVALID_PASSWORD predicate threw
    await expect(withLoginFlow(page as never, opts)).resolves.toBeUndefined();
  });
});
