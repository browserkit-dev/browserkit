/**
 * Tests for authStrategy: "extension" — Playwriter CDP relay integration.
 *
 * Updated to use the BrowserBackend abstraction: SessionEntry now requires
 * a `backend` field, and handleAuthFailure delegates to
 * sessionManager.supportsAutoReauth() rather than checking authStrategy directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";

// ── Shared mocks ──────────────────────────────────────────────────────────────

const mockPage = { url: vi.fn(() => "about:blank"), goto: vi.fn() };
const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn(),
  pages: vi.fn(() => []),
  clearCookies: vi.fn().mockResolvedValue(undefined),
  addCookies: vi.fn().mockResolvedValue(undefined),
  cookies: vi.fn().mockResolvedValue([]),
};
const mockBrowser = {
  contexts: vi.fn(() => [mockContext]),
  newContext: vi.fn().mockResolvedValue(mockContext),
};

/** Minimal extension backend stub — mirrors ExtensionBackend property values. */
const extensionBackend = {
  ownsContext: false,
  supportsModeSwitch: false,
  supportsStorageStateInjection: false,
  supportsAutoReauth: false,
  effectiveMode: () => "watch" as const,
};

/** Minimal persistent backend stub — mirrors PersistentBackend property values. */
const persistentBackend = {
  ownsContext: true,
  supportsModeSwitch: true,
  supportsStorageStateInjection: true,
  supportsAutoReauth: true,
  effectiveMode: (m: string) => m as import("../src/types.js").BrowserMode,
};

// ── Types ─────────────────────────────────────────────────────────────────────

describe("AuthStrategy extension type", () => {
  it("'extension' is a valid AuthStrategy value", () => {
    const strategy: import("../src/types.js").AuthStrategy = "extension";
    expect(strategy).toBe("extension");
  });
});

// ── SessionManager — extension backend behaviors ──────────────────────────────

describe("SessionManager extension strategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.doMock("patchright", () => ({
      chromium: {
        connectOverCDP: vi.fn().mockResolvedValue(mockBrowser),
        launchPersistentContext: vi.fn().mockResolvedValue(mockContext),
        launch: vi.fn().mockResolvedValue({ newContext: vi.fn().mockResolvedValue(mockContext) }),
      },
      devices: {},
    }));
    vi.doMock("playwriter", () => ({
      startPlayWriterCDPRelayServer: vi.fn().mockResolvedValue(undefined),
      getCdpUrl: vi.fn().mockReturnValue("ws://127.0.0.1:19988/cdp"),
    }));
  });

  afterEach(() => { vi.resetModules(); });

  it("throws a helpful error when playwriter is not installed", async () => {
    vi.doMock("playwriter", () => { throw new Error("MODULE_NOT_FOUND"); });
    const { SessionManager } = await import("../src/session-manager.js");
    const dataDir = os.tmpdir() + "/browserkit-test-ext-" + Date.now();
    const sm = new SessionManager({ dataDir });
    const config: import("../src/types.js").SessionConfig = {
      site: "test-ext",
      domain: "example.com",
      authStrategy: "extension",
      profileDir: "test-ext",
    };
    await expect(sm.getPage(config)).rejects.toThrow(/playwriter/i);
    await sm.closeAll();
  });

  it("getCurrentMode returns 'headless' when no session exists (no special-casing needed)", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir: os.tmpdir() + "/bk-test-" + Date.now() });
    expect(sm.getCurrentMode("no-such-site")).toBe("headless");
    await sm.closeAll();
  });

  it("getCurrentMode returns 'watch' for an active extension session via backend.effectiveMode", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir: os.tmpdir() + "/bk-test-" + Date.now() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any).sessions.set("test-ext-cur", {
      context: mockContext,
      page: mockPage,
      config: { site: "test-ext-cur", domain: "example.com", authStrategy: "extension", profileDir: "test-ext-cur" },
      backend: extensionBackend,
      mode: "headless", // stored mode is irrelevant for extension
    });
    expect(sm.getCurrentMode("test-ext-cur")).toBe("watch");
    await sm.closeAll();
  });

  it("closeSite for extension strategy does not call context.close() (ownsContext: false)", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir: os.tmpdir() + "/bk-test-" + Date.now() });
    const closeSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any).sessions.set("test-site", {
      context: { ...mockContext, close: closeSpy },
      page: mockPage,
      config: { site: "test-site", domain: "example.com", authStrategy: "extension", profileDir: "test-site" },
      backend: extensionBackend,
      mode: "headless",
    });
    await sm.closeSite("test-site");
    expect(closeSpy).not.toHaveBeenCalled();
    // Session entry removed — getCurrentMode falls back to default
    expect(sm.getCurrentMode("test-site")).toBe("headless");
    await sm.closeAll();
  });

  it("closeSite for persistent strategy DOES call context.close() (ownsContext: true)", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir: os.tmpdir() + "/bk-test-" + Date.now() });
    const closeSpy = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any).sessions.set("test-persistent", {
      context: { ...mockContext, close: closeSpy },
      page: mockPage,
      config: { site: "test-persistent", domain: "example.com", authStrategy: "persistent", profileDir: "test-persistent" },
      backend: persistentBackend,
      mode: "headless",
    });
    await sm.closeSite("test-persistent");
    expect(closeSpy).toHaveBeenCalledOnce();
    await sm.closeAll();
  });

  it("setMode is a no-op for extension strategy — returns existing page without relaunching", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir: os.tmpdir() + "/bk-test-" + Date.now() });
    const closeSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any).sessions.set("test-ext-mode", {
      context: { ...mockContext, close: closeSpy },
      page: mockPage,
      config: { site: "test-ext-mode", domain: "example.com", authStrategy: "extension", profileDir: "test-ext-mode" },
      backend: extensionBackend,
      mode: "headless",
    });
    const result = await sm.setMode(
      { site: "test-ext-mode", domain: "example.com", authStrategy: "extension", profileDir: "test-ext-mode" },
      "watch"
    );
    expect(result).toBe(mockPage);
    expect(closeSpy).not.toHaveBeenCalled();
    await sm.closeAll();
  });

  it("supportsAutoReauth() returns false for an extension session", async () => {
    const { SessionManager } = await import("../src/session-manager.js");
    const sm = new SessionManager({ dataDir: os.tmpdir() + "/bk-test-" + Date.now() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any).sessions.set("linkedin", {
      context: mockContext,
      page: mockPage,
      config: { site: "linkedin", domain: "linkedin.com", authStrategy: "extension", profileDir: "linkedin" },
      backend: extensionBackend,
      mode: "headless",
    });
    expect(sm.supportsAutoReauth("linkedin")).toBe(false);
    await sm.closeAll();
  });
});

// ── handleAuthFailure — delegates to supportsAutoReauth ───────────────────────

describe("handleAuthFailure extension strategy", () => {
  afterEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it("returns false immediately without opening a browser window when supportsAutoReauth is false", async () => {
    const { handleAuthFailure } = await import("../src/human-handoff.js");

    // The updated handleAuthFailure calls sessionManager.supportsAutoReauth(site)
    const mockSessionManager = {
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

    const result = await handleAuthFailure(mockSessionManager, config, adapter);

    expect(result).toBe(false);
    expect(mockSessionManager.supportsAutoReauth).toHaveBeenCalledWith("linkedin");
    // No browser was touched
    expect(mockSessionManager.getPage).not.toHaveBeenCalled();
  });
});

// ── AdapterConfig extensionPort ───────────────────────────────────────────────

describe("AdapterConfig extensionPort", () => {
  it("accepts extensionPort as a valid optional field", () => {
    const config: import("../src/types.js").AdapterConfig = {
      authStrategy: "extension",
      extensionPort: 19988,
    };
    expect(config.extensionPort).toBe(19988);
  });

  it("extensionPort is optional — config without it is valid", () => {
    const config: import("../src/types.js").AdapterConfig = {
      authStrategy: "extension",
    };
    expect(config.extensionPort).toBeUndefined();
  });
});
