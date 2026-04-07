import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
 */
export function readAdapterVersion(packageNameOrPath: string): string | null {
  try {
    let pkgJsonPath: string;

    if (packageNameOrPath.startsWith("/") || packageNameOrPath.startsWith(".")) {
      // File path: look for package.json next to the dist file
      const dir = path.dirname(packageNameOrPath);
      // Try sibling package.json (e.g. dist/index.js → package.json one level up)
      pkgJsonPath = fs.existsSync(path.join(dir, "package.json"))
        ? path.join(dir, "package.json")
        : path.join(dir, "..", "package.json");
    } else {
      // npm package: resolve from node_modules
      // Use require.resolve to find it regardless of cwd
      pkgJsonPath = require.resolve(`${packageNameOrPath}/package.json`);
    }

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}
