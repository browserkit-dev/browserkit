import type { SiteAdapter } from "./types.js";
import { parseSemver } from "./version-check.js";

/**
 * Type-safe helper for defining adapters.
 * Provides compile-time type checking and runtime validation.
 *
 * Usage:
 *   export default defineAdapter({ site: "linkedin", ... });
 */
export function defineAdapter(adapter: SiteAdapter): SiteAdapter {
  validateAdapter(adapter);
  return adapter;
}

function validateAdapter(adapter: SiteAdapter): void {
  const errors: string[] = [];

  if (!adapter.site || typeof adapter.site !== "string") {
    errors.push("site: must be a non-empty string");
  }
  if (!adapter.domain || typeof adapter.domain !== "string") {
    errors.push("domain: must be a non-empty string");
  }
  if (!adapter.loginUrl || typeof adapter.loginUrl !== "string") {
    errors.push("loginUrl: must be a non-empty string");
  } else {
    try {
      new URL(adapter.loginUrl);
    } catch {
      errors.push(`loginUrl: "${adapter.loginUrl}" is not a valid URL`);
    }
  }
  if (typeof adapter.isLoggedIn !== "function") {
    errors.push("isLoggedIn: must be a function");
  }
  if (typeof adapter.tools !== "function") {
    errors.push("tools: must be a function");
  }
  if (adapter.rateLimit !== undefined) {
    if (
      typeof adapter.rateLimit.minDelayMs !== "number" ||
      adapter.rateLimit.minDelayMs <= 0
    ) {
      errors.push("rateLimit.minDelayMs: must be a positive number");
    }
  }

  // Validate minCoreVersion format if provided
  if (adapter.minCoreVersion !== undefined) {
    if (parseSemver(adapter.minCoreVersion) === null) {
      errors.push(`minCoreVersion: "${adapter.minCoreVersion}" is not a valid X.Y.Z version string`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid adapter definition:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }

  // Validate tool names are unique
  const tools = adapter.tools();
  const names = tools.map((t) => t.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) {
    throw new Error(
      `Adapter "${adapter.site}" has duplicate tool names: ${dupes.join(", ")}`
    );
  }

  // Validate each tool has required fields
  for (const tool of tools) {
    if (!tool.name || typeof tool.name !== "string") {
      throw new Error(`Adapter "${adapter.site}": a tool is missing a name`);
    }
    if (!tool.description || typeof tool.description !== "string") {
      throw new Error(
        `Adapter "${adapter.site}", tool "${tool.name}": missing description`
      );
    }
    if (typeof tool.handler !== "function") {
      throw new Error(
        `Adapter "${adapter.site}", tool "${tool.name}": handler must be a function`
      );
    }
  }
}
