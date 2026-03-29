/**
 * Tests for Feature 2: `autoDiscoverCdpEndpoint` and `loginViaConnect`
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// ── autoDiscoverCdpEndpoint ───────────────────────────────────────────────────

describe("parseDevToolsActivePort (via autoDiscoverCdpEndpoint internal logic)", () => {
  // Mirror the parsing logic to test it in isolation
  function parseDevToolsActivePort(contents: string, expectedPort?: number): string | null {
    const lines = contents.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const port = Number.parseInt(lines[0] ?? "", 10);
    const wsPath = lines[1] ?? "";
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
    if (expectedPort !== undefined && port !== expectedPort) return null;
    if (!wsPath.startsWith("/devtools/browser/")) return null;
    return `ws://127.0.0.1:${port}${wsPath}`;
  }

  it("parses a valid DevToolsActivePort file", () => {
    const content = "9222\n/devtools/browser/abc-123-def\n";
    expect(parseDevToolsActivePort(content)).toBe("ws://127.0.0.1:9222/devtools/browser/abc-123-def");
  });

  it("returns null when port doesn't match expectedPort", () => {
    const content = "9222\n/devtools/browser/abc-123\n";
    expect(parseDevToolsActivePort(content, 9223)).toBeNull();
  });

  it("returns null for invalid WS path", () => {
    const content = "9222\nnot-a-devtools-path\n";
    expect(parseDevToolsActivePort(content)).toBeNull();
  });

  it("returns null for invalid port", () => {
    const content = "notaport\n/devtools/browser/abc\n";
    expect(parseDevToolsActivePort(content)).toBeNull();
  });

  it("returns null for out-of-range port", () => {
    const content = "99999\n/devtools/browser/abc\n";
    expect(parseDevToolsActivePort(content)).toBeNull();
  });
});

describe("autoDiscoverCdpEndpoint", () => {
  it("throws a helpful error when no Chrome is found", async () => {
    // Write a temp file that's not a valid DevToolsActivePort
    const { autoDiscoverCdpEndpoint } = await import("../src/session-manager.js");
    // With no Chrome running, the function should throw a descriptive error
    await expect(autoDiscoverCdpEndpoint()).rejects.toThrow(
      /Could not auto-discover a running Chrome/
    );
  });
});

// ── loginViaConnect ───────────────────────────────────────────────────────────

describe("loginViaConnect", () => {
  it("returns timeout outcome when not logged in", async () => {
    const { loginViaConnect } = await import("../src/human-handoff.js");

    // Mock patchright connectOverCDP
    const mockPage = {
      url: () => "https://example.com/login",
    };
    const mockContext = {
      pages: () => [mockPage],
      storageState: async () => ({ cookies: [], origins: [] }),
    };
    const mockBrowser = {
      contexts: () => [mockContext],
      close: async () => {},
    };

    const chromiumMod = await import("patchright");
    vi.spyOn(chromiumMod.chromium, "connectOverCDP").mockResolvedValueOnce(mockBrowser as never);

    const mockAdapter = {
      site: "test-site",
      domain: "example.com",
      loginUrl: "https://example.com/login",
      isLoggedIn: async () => false,
      tools: () => [],
    };

    const mockSessionManager = {
      getProfileDir: () => os.tmpdir(),
      injectStorageState: async () => {},
      closeAll: async () => {},
    } as never;

    const result = await loginViaConnect(
      mockSessionManager,
      {
        site: "test-site",
        domain: "example.com",
        authStrategy: "persistent",
        profileDir: "test-site",
      },
      mockAdapter,
      "ws://127.0.0.1:9222/devtools/browser/fake"
    );

    expect(result.outcome).toBe("timeout");
  });

  it("returns success and saves storageState when logged in", async () => {
    const { loginViaConnect } = await import("../src/human-handoff.js");
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "browserkit-test-connect-"));

    const mockPage = { url: () => "https://example.com/feed" };
    const mockContext = {
      pages: () => [mockPage],
      storageState: async () => ({
        cookies: [{ name: "session", value: "abc", domain: "example.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const }],
        origins: [],
      }),
    };
    const mockBrowser = {
      contexts: () => [mockContext],
      close: async () => {},
    };

    const chromiumMod = await import("patchright");
    vi.spyOn(chromiumMod.chromium, "connectOverCDP").mockResolvedValueOnce(mockBrowser as never);

    const mockAdapter = {
      site: "test-site",
      domain: "example.com",
      loginUrl: "https://example.com/login",
      isLoggedIn: async () => true,
      tools: () => [],
    };

    const mockSessionManager = {
      getProfileDir: () => tempDir,
      injectStorageState: async () => {},
      closeAll: async () => {},
    } as never;

    const result = await loginViaConnect(
      mockSessionManager,
      {
        site: "test-site",
        domain: "example.com",
        authStrategy: "storage-state",
        profileDir: "test-site",
      },
      mockAdapter,
      "ws://127.0.0.1:9222/devtools/browser/fake"
    );

    expect(result.outcome).toBe("success");
    const stateFile = path.join(tempDir, "storage-state.json");
    expect(fs.existsSync(stateFile)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(stateFile, "utf8")) as { cookies: unknown[] };
    expect(saved.cookies).toHaveLength(1);

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
