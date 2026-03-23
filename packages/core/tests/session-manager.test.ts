import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import os from "node:os";

// Mock playwright to avoid requiring a real browser in unit tests
vi.mock("playwright", () => ({
  chromium: {
    launchPersistentContext: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn(),
        bringToFront: vi.fn(),
      }),
      close: vi.fn(),
    }),
  },
}));

import { getDefaultDataDir } from "../src/session-manager.js";

describe("getDefaultDataDir", () => {
  const setPlatform = (p: string) =>
    Object.defineProperty(process, "platform", { value: p, configurable: true });

  it("returns macOS path on darwin", () => {
    setPlatform("darwin");
    expect(getDefaultDataDir()).toContain(
      path.join("Library", "Application Support", "browserkit")
    );
    setPlatform(process.platform);
  });

  it("returns APPDATA path on Windows", () => {
    setPlatform("win32");
    process.env["APPDATA"] = "/mocked/AppData/Roaming";
    const dir = getDefaultDataDir();
    expect(dir).toContain("browserkit");
    expect(dir).toContain("AppData");
    delete process.env["APPDATA"];
    setPlatform(process.platform);
  });

  it("falls back to AppData/Roaming on Windows without APPDATA env", () => {
    setPlatform("win32");
    delete process.env["APPDATA"];
    const dir = getDefaultDataDir();
    expect(dir).toContain("browserkit");
    setPlatform(process.platform);
  });

  it("respects XDG_DATA_HOME on linux", () => {
    setPlatform("linux");
    process.env["XDG_DATA_HOME"] = "/custom/xdg";
    expect(getDefaultDataDir()).toBe("/custom/xdg/browserkit");
    delete process.env["XDG_DATA_HOME"];
    setPlatform(process.platform);
  });

  it("falls back to ~/.local/share on linux without XDG", () => {
    setPlatform("linux");
    delete process.env["XDG_DATA_HOME"];
    expect(getDefaultDataDir()).toBe(
      path.join(os.homedir(), ".local", "share", "browserkit")
    );
    setPlatform(process.platform);
  });
});

