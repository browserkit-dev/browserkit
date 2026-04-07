import { describe, it, expect } from "vitest";
import { parseSemver, satisfies, readCoreVersion } from "../src/version-check.js";

describe("parseSemver", () => {
  it("parses valid X.Y.Z strings", () => {
    expect(parseSemver("0.1.0")).toEqual([0, 1, 0]);
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver("10.20.30")).toEqual([10, 20, 30]);
  });

  it("strips leading v", () => {
    expect(parseSemver("v1.2.3")).toEqual([1, 2, 3]);
  });

  it("strips pre-release and build suffixes", () => {
    expect(parseSemver("1.2.3-alpha.1")).toEqual([1, 2, 3]);
    expect(parseSemver("1.2.3+build.1")).toEqual([1, 2, 3]);
    expect(parseSemver("1.2.3-rc.1+build.5")).toEqual([1, 2, 3]);
  });

  it("returns null for invalid strings", () => {
    expect(parseSemver("")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("1.2.3.4")).toBeNull();
    expect(parseSemver("a.b.c")).toBeNull();
    expect(parseSemver(">=0.1.0")).toBeNull();
    expect(parseSemver("^0.1.0")).toBeNull();
  });
});

describe("satisfies", () => {
  it("returns true when actual equals required", () => {
    expect(satisfies("0.1.0", "0.1.0")).toBe(true);
    expect(satisfies("1.0.0", "1.0.0")).toBe(true);
  });

  it("returns true when actual is greater", () => {
    expect(satisfies("0.2.0", "0.1.0")).toBe(true);
    expect(satisfies("1.0.0", "0.9.9")).toBe(true);
    expect(satisfies("0.1.1", "0.1.0")).toBe(true);
  });

  it("returns false when actual is less than required", () => {
    expect(satisfies("0.1.0", "0.2.0")).toBe(false);
    expect(satisfies("0.1.0", "1.0.0")).toBe(false);
    expect(satisfies("0.1.0", "0.1.1")).toBe(false);
  });

  it("returns false when either version is unparseable", () => {
    expect(satisfies("not-a-version", "0.1.0")).toBe(false);
    expect(satisfies("0.1.0", "^0.1.0")).toBe(false);
    expect(satisfies("", "0.1.0")).toBe(false);
  });

  it("handles realistic upgrade scenarios", () => {
    // user has 0.2.0, adapter needs 0.1.0 → OK
    expect(satisfies("0.2.0", "0.1.0")).toBe(true);
    // user has 0.1.0, adapter needs 0.2.0 → FAIL
    expect(satisfies("0.1.0", "0.2.0")).toBe(false);
    // user has 1.0.0, adapter needs 0.99.0 → OK
    expect(satisfies("1.0.0", "0.99.0")).toBe(true);
  });
});

describe("readCoreVersion", () => {
  it("returns a non-empty version string", () => {
    const v = readCoreVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("returns the version from package.json (0.1.0 or higher)", () => {
    const v = readCoreVersion();
    expect(satisfies(v, "0.1.0")).toBe(true);
  });
});
