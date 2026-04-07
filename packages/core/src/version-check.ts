import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * Parse a semver string into [major, minor, patch] tuple.
 * Strips leading "v" and any pre-release/build suffix.
 * Returns null if the string is not a valid X.Y.Z version.
 */
export function parseSemver(version: string): [number, number, number] | null {
  const clean = version.replace(/^v/, "").split("-")[0]?.split("+")[0] ?? "";
  const parts = clean.split(".");
  if (parts.length !== 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return nums as [number, number, number];
}

/**
 * Returns true when `actual` is greater than or equal to `required`.
 * Both are X.Y.Z strings. Returns false if either cannot be parsed.
 */
export function satisfies(actual: string, required: string): boolean {
  const a = parseSemver(actual);
  const r = parseSemver(required);
  if (!a || !r) return false;
  for (let i = 0; i < 3; i++) {
    if ((a[i] as number) > (r[i] as number)) return true;
    if ((a[i] as number) < (r[i] as number)) return false;
  }
  return true; // equal
}

/**
 * Read the installed @browserkit-dev/core version from its own package.json.
 */
export function readCoreVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Read a package.json version from a file path or npm package name.
 * Returns null if not found.
 *
 * For file paths: walks up from the given path to find the nearest package.json.
 * For npm package names: resolves the main entry via createRequire, then walks
 *   up the directory tree to find the package.json whose "name" matches.
 */
export function readAdapterVersion(packageNameOrPath: string): string | null {
  try {
    if (packageNameOrPath.startsWith("/") || packageNameOrPath.startsWith(".")) {
      // File path: walk up at most 5 levels to find package.json
      let dir = path.dirname(packageNameOrPath);
      for (let i = 0; i < 5; i++) {
        const candidate = path.join(dir, "package.json");
        if (fs.existsSync(candidate)) {
          const pkg = JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: string };
          return pkg.version ?? null;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break; // reached filesystem root
        dir = parent;
      }
      return null;
    }

    // npm package: use createRequire (ESM-safe) to resolve the main entry,
    // then walk up to find the package.json whose "name" matches.
    const require = createRequire(import.meta.url);
    const mainEntry = require.resolve(packageNameOrPath);
    let dir = path.dirname(mainEntry);
    while (true) {
      const candidate = path.join(dir, "package.json");
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, "utf8")) as { name?: string; version?: string };
        if (pkg.name === packageNameOrPath) return pkg.version ?? null;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break; // reached filesystem root
      dir = parent;
    }
    return null;
  } catch {
    return null;
  }
}
