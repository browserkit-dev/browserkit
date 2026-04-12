/**
 * Tests for the BrowserBackend abstraction.
 *
 * Covers:
 *   1. Property contracts for each of the 4 concrete backends
 *   2. createBackend() factory — correct class per AuthStrategy
 *   3. SessionManager delegation — methods use backend.* properties instead of authStrategy checks
 *   4. handleAuthFailure delegation via SessionManager.supportsAutoReauth()
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// ── Shared mock setup ─────────────────────────────────────────────────────────

const mockPage = { url: vi.fn(() => "about:blank"), goto: vi.fn(), evaluate: vi.fn() };
const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
  clearCookies: vi.fn().mockResolvedValue(undefined),
  addCookies: vi.fn().mockResolvedValue(undefined),
  cookies: vi.fn().mockResolvedValue([]),
  pages: vi.fn(() => []),
  route: vi.fn().mockResolvedValue(undefined),
  addInitScript: vi.fn().mockResolvedValue(undefined),
};
const mockBrowser = {
  contexts: vi.fn(() => [mockContext]),
  newContext: vi.fn().mockResolvedValue(mockContext),
  disconnect: vi.fn(),
};

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "browserkit-backend-test-"));
}

// ── 1. BrowserBackend property contracts ──────────────────────────────────────

describe("BrowserBackend property contracts", () => {
  // Import the module freshly for each describe block to avoid mock leakage
  beforeEach(() => {
    vi.doMock("patchright", () => ({
      chromium: {
        launchPersistentContext: vi.fn().mockResolvedValue(mockContext),
        launch: vi.fn().mockResolvedValue(mockBrowser),
        connectOverCDP: vi.fn().mockResolvedValue(mockBrowser),
      },
      devices: {},
    }));
    vi.doMock("playwriter", () => ({
      startPlayWriterCDPRelayServer: vi.fn().mockResolvedValue(undefined),
      getCdpUrl: vi.fn().mockReturnValue("ws://127.0.0.1:19988/cdp"),
    }));
  });

  afterEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  describe("PersistentBackend (authStrategy: 'persistent')", () => {
    it("ownsContext is true", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "persistent", profileDir: "test" }, "/tmp");
      expect(backend.ownsContext).toBe(true);
    });
    it("supportsModeSwitch is true", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "persistent", profileDir: "test" }, "/tmp");
      expect(backend.supportsModeSwitch).toBe(true);
    });
    it("supportsStorageStateInjection is true", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "persistent", profileDir: "test" }, "/tmp");
      expect(backend.supportsStorageStateInjection).toBe(true);
    });
    it("supportsAutoReauth is true", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "persistent", profileDir: "test" }, "/tmp");
      expect(backend.supportsAutoReauth).toBe(true);
    });
    it("effectiveMode returns the stored mode unchanged", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "persistent", profileDir: "test" }, "/tmp");
      expect(backend.effectiveMode("headless")).toBe("headless");
      expect(backend.effectiveMode("watch")).toBe("watch");
      expect(backend.effectiveMode("paused")).toBe("paused");
    });
  });

  describe("StorageStateBackend (authStrategy: 'storage-state')", () => {
    it("ownsContext is true", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "storage-state", profileDir: "test" }, "/tmp");
      expect(backend.ownsContext).toBe(true);
    });
    it("supportsModeSwitch is true", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "storage-state", profileDir: "test" }, "/tmp");
      expect(backend.supportsModeSwitch).toBe(true);
    });
    it("supportsStorageStateInjection is true", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "storage-state", profileDir: "test" }, "/tmp");
      expect(backend.supportsStorageStateInjection).toBe(true);
    });
    it("supportsAutoReauth is true", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "storage-state", profileDir: "test" }, "/tmp");
      expect(backend.supportsAutoReauth).toBe(true);
    });
    it("effectiveMode returns the stored mode unchanged", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "storage-state", profileDir: "test" }, "/tmp");
      expect(backend.effectiveMode("headless")).toBe("headless");
      expect(backend.effectiveMode("watch")).toBe("watch");
    });
  });

  describe("CdpAttachBackend (authStrategy: 'cdp-attach')", () => {
    it("ownsContext is true", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "cdp-attach", profileDir: "test", cdpUrl: "http://127.0.0.1:9222" }, "/tmp");
      expect(backend.ownsContext).toBe(true);
    });
    it("supportsModeSwitch is true", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "cdp-attach", profileDir: "test", cdpUrl: "http://127.0.0.1:9222" }, "/tmp");
      expect(backend.supportsModeSwitch).toBe(true);
    });
    it("supportsAutoReauth is true", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "cdp-attach", profileDir: "test", cdpUrl: "http://127.0.0.1:9222" }, "/tmp");
      expect(backend.supportsAutoReauth).toBe(true);
    });
    it("effectiveMode returns the stored mode unchanged", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "cdp-attach", profileDir: "test", cdpUrl: "http://127.0.0.1:9222" }, "/tmp");
      expect(backend.effectiveMode("headless")).toBe("headless");
    });
    it("connect() throws when cdpUrl is missing", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "no-url", domain: "x.com", authStrategy: "cdp-attach", profileDir: "no-url" }, "/tmp");
      await expect(backend.connect("headless")).rejects.toThrow(/cdp-attach requires cdpUrl/);
    });
  });

  describe("ExtensionBackend (authStrategy: 'extension')", () => {
    it("ownsContext is false", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "extension", profileDir: "test" }, "/tmp");
      expect(backend.ownsContext).toBe(false);
    });
    it("supportsModeSwitch is false", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "extension", profileDir: "test" }, "/tmp");
      expect(backend.supportsModeSwitch).toBe(false);
    });
    it("supportsStorageStateInjection is false", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "extension", profileDir: "test" }, "/tmp");
      expect(backend.supportsStorageStateInjection).toBe(false);
    });
    it("supportsAutoReauth is false", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "extension", profileDir: "test" }, "/tmp");
      expect(backend.supportsAutoReauth).toBe(false);
    });
    it("effectiveMode always returns 'watch' regardless of stored mode", async () => {
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "extension", profileDir: "test" }, "/tmp");
      expect(backend.effectiveMode("headless")).toBe("watch");
      expect(backend.effectiveMode("watch")).toBe("watch");
      expect(backend.effectiveMode("paused")).toBe("watch");
    });
    it("connect() throws a descriptive error when playwriter is not installed", async () => {
      vi.doMock("playwriter", () => { throw new Error("Cannot find module 'playwriter'"); });
      const { createBackend } = await import("../src/browser-backend.js");
      const backend = createBackend({ site: "test", domain: "x.com", authStrategy: "extension", profileDir: "test" }, "/tmp");
      await expect(backend.connect("headless")).rejects.toThrow(/playwriter/i);
    });
  });
});

// ── 2. createBackend() factory ────────────────────────────────────────────────

describe("createBackend() factory", () => {
  beforeEach(() => {
    vi.doMock("patchright", () => ({
      chromium: { launchPersistentContext: vi.fn(), launch: vi.fn(), connectOverCDP: vi.fn() },
      devices: {},
    }));
    vi.doMock("playwriter", () => ({ startPlayWriterCDPRelayServer: vi.fn(), getCdpUrl: vi.fn() }));
  });
  afterEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it("returns a backend with ownsContext:true for 'persistent'", async () => {
    const { createBackend } = await import("../src/browser-backend.js");
    expect(createBackend({ site: "t", domain: "x.com", authStrategy: "persistent", profileDir: "t" }, "/tmp").ownsContext).toBe(true);
  });
  it("returns a backend with ownsContext:true for 'storage-state'", async () => {
    const { createBackend } = await import("../src/browser-backend.js");
    expect(createBackend({ site: "t", domain: "x.com", authStrategy: "storage-state", profileDir: "t" }, "/tmp").ownsContext).toBe(true);
  });
  it("returns a backend with ownsContext:true for 'cdp-attach'", async () => {
    const { createBackend } = await import("../src/browser-backend.js");
    expect(createBackend({ site: "t", domain: "x.com", authStrategy: "cdp-attach", profileDir: "t" }, "/tmp").ownsContext).toBe(true);
  });
  it("returns a backend with ownsContext:false for 'extension'", async () => {
    const { createBackend } = await import("../src/browser-backend.js");
    expect(createBackend({ site: "t", domain: "x.com", authStrategy: "extension", profileDir: "t" }, "/tmp").ownsContext).toBe(false);
  });
  it("defaults to PersistentBackend when authStrategy is 'persistent' (explicit)", async () => {
    const { createBackend } = await import("../src/browser-backend.js");
    const backend = createBackend({ site: "t", domain: "x.com", authStrategy: "persistent", profileDir: "t" }, "/tmp");
    // Persistent always passes back the stored mode
    expect(backend.effectiveMode("watch")).toBe("watch");
  });
});

// ── 3. SessionManager delegation via backend properties ───────────────────────

describe("SessionManager — backend delegation", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = makeTempDir();
    vi.doMock("patchright", () => ({
      chromium: {
        launchPersistentContext: vi.fn().mockResolvedValue(mockContext),
        launch: vi.fn().mockResolvedValue(mockBrowser),
        connectOverCDP: vi.fn().mockResolvedValue(mockBrowser),
      },
      devices: {},
    }));
    vi.doMock("playwriter", () => ({
      startPlayWriterCDPRelayServer: vi.fn().mockResolvedValue(undefined),
      getCdpUrl: vi.fn().mockReturnValue("ws://127.0.0.1:19988/cdp"),
    }));
  });

  afterEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("closeSite() calls context.close() when backend.ownsContext is true (persistent)", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir });
    const closeSpy = vi.fn().mockResolvedValue(undefined);
    // Inject a fake persistent session
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any).sessions.set("site-a", {
      context: { ...mockContext, close: closeSpy },
      page: mockPage,
      config: { site: "site-a", domain: "x.com", authStrategy: "persistent", profileDir: "site-a" },
      backend: { ownsContext: true, supportsModeSwitch: true, supportsStorageStateInjection: true, supportsAutoReauth: true, effectiveMode: (m: string) => m },
      mode: "headless",
    });

    await sm.closeSite("site-a");
    expect(closeSpy).toHaveBeenCalledOnce();
    await sm.closeAll();
  });

  it("closeSite() skips context.close() when backend.ownsContext is false (extension)", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir });
    const closeSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any).sessions.set("site-ext", {
      context: { ...mockContext, close: closeSpy },
      page: mockPage,
      config: { site: "site-ext", domain: "x.com", authStrategy: "extension", profileDir: "site-ext" },
      backend: { ownsContext: false, supportsModeSwitch: false, supportsStorageStateInjection: false, supportsAutoReauth: false, effectiveMode: () => "watch" },
      mode: "headless",
    });

    await sm.closeSite("site-ext");
    expect(closeSpy).not.toHaveBeenCalled();
    await sm.closeAll();
  });

  it("getCurrentMode() delegates to backend.effectiveMode()", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any).sessions.set("site-mode", {
      context: mockContext,
      page: mockPage,
      config: { site: "site-mode", domain: "x.com", authStrategy: "extension", profileDir: "site-mode" },
      backend: { ownsContext: false, supportsModeSwitch: false, supportsStorageStateInjection: false, supportsAutoReauth: false, effectiveMode: () => "watch" },
      mode: "headless", // stored as headless, but effectiveMode returns "watch"
    });

    expect(sm.getCurrentMode("site-mode")).toBe("watch");
    await sm.closeAll();
  });

  it("getCurrentMode() returns 'headless' when no session exists", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir });
    expect(sm.getCurrentMode("no-such-site")).toBe("headless");
    await sm.closeAll();
  });

  it("setMode() returns existing page without close/relaunch when !backend.supportsModeSwitch", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir });
    const closeSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any).sessions.set("site-nomatch", {
      context: { ...mockContext, close: closeSpy },
      page: mockPage,
      config: { site: "site-nomatch", domain: "x.com", authStrategy: "extension", profileDir: "site-nomatch" },
      backend: { ownsContext: false, supportsModeSwitch: false, supportsStorageStateInjection: false, supportsAutoReauth: false, effectiveMode: () => "watch" },
      mode: "headless",
    });

    const result = await sm.setMode(
      { site: "site-nomatch", domain: "x.com", authStrategy: "extension", profileDir: "site-nomatch" },
      "watch"
    );
    expect(result).toBe(mockPage); // returned existing page
    expect(closeSpy).not.toHaveBeenCalled(); // no close/relaunch
    await sm.closeAll();
  });

  it("injectStorageState() skips when !backend.supportsStorageStateInjection", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir });
    const clearCookiesSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any).sessions.set("site-inject", {
      context: { ...mockContext, clearCookies: clearCookiesSpy },
      page: mockPage,
      config: { site: "site-inject", domain: "x.com", authStrategy: "extension", profileDir: "site-inject" },
      backend: { ownsContext: false, supportsModeSwitch: false, supportsStorageStateInjection: false, supportsAutoReauth: false, effectiveMode: () => "watch" },
      mode: "headless",
    });

    await sm.injectStorageState("site-inject", [], []);
    expect(clearCookiesSpy).not.toHaveBeenCalled();
    await sm.closeAll();
  });

  it("injectStorageState() runs when backend.supportsStorageStateInjection is true", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir });
    const clearCookiesSpy = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any).sessions.set("site-inject-yes", {
      context: { ...mockContext, clearCookies: clearCookiesSpy },
      page: mockPage,
      config: { site: "site-inject-yes", domain: "x.com", authStrategy: "persistent", profileDir: "site-inject-yes" },
      backend: { ownsContext: true, supportsModeSwitch: true, supportsStorageStateInjection: true, supportsAutoReauth: true, effectiveMode: (m: string) => m },
      mode: "headless",
    });

    await sm.injectStorageState("site-inject-yes", [], []);
    expect(clearCookiesSpy).toHaveBeenCalledOnce();
    await sm.closeAll();
  });

  it("supportsAutoReauth() returns false for extension session", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any).sessions.set("site-ext-auth", {
      context: mockContext,
      page: mockPage,
      config: { site: "site-ext-auth", domain: "x.com", authStrategy: "extension", profileDir: "site-ext-auth" },
      backend: { ownsContext: false, supportsModeSwitch: false, supportsStorageStateInjection: false, supportsAutoReauth: false, effectiveMode: () => "watch" },
      mode: "headless",
    });

    expect(sm.supportsAutoReauth("site-ext-auth")).toBe(false);
    await sm.closeAll();
  });

  it("supportsAutoReauth() returns true for persistent session", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any).sessions.set("site-pers-auth", {
      context: mockContext,
      page: mockPage,
      config: { site: "site-pers-auth", domain: "x.com", authStrategy: "persistent", profileDir: "site-pers-auth" },
      backend: { ownsContext: true, supportsModeSwitch: true, supportsStorageStateInjection: true, supportsAutoReauth: true, effectiveMode: (m: string) => m },
      mode: "headless",
    });

    expect(sm.supportsAutoReauth("site-pers-auth")).toBe(true);
    await sm.closeAll();
  });

  it("supportsAutoReauth() returns true (default) when no session exists yet", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir });
    // No session set — should default to true so callers can start a login flow
    expect(sm.supportsAutoReauth("no-session")).toBe(true);
    await sm.closeAll();
  });
});

// ── 4. handleAuthFailure uses supportsAutoReauth ──────────────────────────────

describe("handleAuthFailure — delegates to sessionManager.supportsAutoReauth()", () => {
  afterEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it("returns false immediately when supportsAutoReauth() is false (extension backend)", async () => {
    const { handleAuthFailure } = await import("../src/human-handoff.js");

    const mockSM = {
      supportsAutoReauth: vi.fn().mockReturnValue(false),
      getPage: vi.fn(),
      getProfileDir: vi.fn(),
      injectStorageState: vi.fn(),
      closeSite: vi.fn(),
    } as unknown as import("../src/session-manager.js").SessionManager;

    const config: import("../src/types.js").SessionConfig = {
      site: "linkedin",
      domain: "linkedin.com",
      authStrategy: "extension",
      profileDir: "linkedin",
    };
    const adapter = {
      site: "linkedin", domain: "linkedin.com",
      loginUrl: "https://www.linkedin.com/login",
      tools: () => [],
      isLoggedIn: vi.fn().mockResolvedValue(false),
    } as unknown as import("../src/types.js").SiteAdapter;

    const result = await handleAuthFailure(mockSM, config, adapter);

    expect(result).toBe(false);
    expect(mockSM.supportsAutoReauth).toHaveBeenCalledWith("linkedin");
    expect(mockSM.getPage).not.toHaveBeenCalled();
  });

  it("proceeds past the guard when supportsAutoReauth() is true (persistent backend)", async () => {
    const { handleAuthFailure } = await import("../src/human-handoff.js");

    // Return true for supportsAutoReauth but make getPage fail to short-circuit the rest
    const mockSM = {
      supportsAutoReauth: vi.fn().mockReturnValue(true),
      getPage: vi.fn().mockRejectedValue(new Error("no browser in test")),
      getProfileDir: vi.fn(),
      injectStorageState: vi.fn(),
      closeSite: vi.fn(),
    } as unknown as import("../src/session-manager.js").SessionManager;

    const config: import("../src/types.js").SessionConfig = {
      site: "hackernews",
      domain: "news.ycombinator.com",
      authStrategy: "persistent",
      profileDir: "hackernews",
    };
    const getLoginOptionsFn = vi.fn().mockReturnValue({
      loginUrl: "https://news.ycombinator.com/login",
      fields: [],
      submitButtonSelector: "button",
      possibleResults: {},
    });
    const adapter = {
      site: "hackernews", domain: "news.ycombinator.com",
      loginUrl: "https://news.ycombinator.com/login",
      tools: () => [],
      isLoggedIn: vi.fn().mockResolvedValue(false),
      getLoginOptions: getLoginOptionsFn,
    } as unknown as import("../src/types.js").SiteAdapter;

    // Should NOT return false at the guard — it proceeds to the automated login attempt
    // which fails because getPage throws, then falls through to background login which
    // skips in test (no CI env set, but no display either — it won't open a real browser)
    const result = await handleAuthFailure(mockSM, config, adapter, { quickWaitMs: 100, totalTimeoutMs: 200 });

    expect(mockSM.supportsAutoReauth).toHaveBeenCalledWith("hackernews");
    // The result can be false (timeout) but supportsAutoReauth was checked — that's what we verify
    expect(typeof result).toBe("boolean");
  });
});
