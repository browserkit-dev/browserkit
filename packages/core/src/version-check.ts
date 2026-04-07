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
 * For npm package names: tries createRequire resolution first, then scans any
 *   pnpm workspace packages directory as a fallback (handles workspace-linked
 *   packages that aren't installed into node_modules).
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
        if (parent === dir) break;
        dir = parent;
      }
      return null;
    }

    // npm package: try createRequire first (works when installed in node_modules)
    try {
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
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      // Not in node_modules — fall through to workspace scan
    }

    // Fallback: scan pnpm workspace packages for the matching package name.
    // Handles workspace-linked packages that aren't copied into node_modules
    // (e.g. adapter-hackernews referenced by npm name in browserkit.config.js).
    const workspaceVersion = findInPnpmWorkspace(packageNameOrPath);
    if (workspaceVersion !== null) return workspaceVersion;

    return null;
  } catch {
    return null;
  }
}

/**
 * Scan pnpm workspace package directories for a package with the given name.
 * Walks up from the current file's location to find pnpm-workspace.yaml,
 * then reads each packages/{name}/package.json entry.
 */
function findInPnpmWorkspace(packageName: string): string | null {
  try {
    // Walk up to find the workspace root (contains pnpm-workspace.yaml)
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
        // Found workspace root — scan packages/ directory
        const packagesDir = path.join(dir, "packages");
        if (!fs.existsSync(packagesDir)) break;
        for (const entry of fs.readdirSync(packagesDir)) {
          const pkgJsonPath = path.join(packagesDir, entry, "package.json");
          if (fs.existsSync(pkgJsonPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as { name?: string; version?: string };
            if (pkg.name === packageName) return pkg.version ?? null;
          }
        }
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  } catch {
    return null;
  }
}
