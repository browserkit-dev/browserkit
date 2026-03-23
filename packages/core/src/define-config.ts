import type { FrameworkConfig } from "./types.js";

/**
 * Type-safe helper for defining browserkit.config.ts.
 *
 * Usage:
 *   export default defineConfig({ adapters: { "@someone/my-adapter": { port: 3847 } } });
 */
export function defineConfig(config: FrameworkConfig): FrameworkConfig {
  validateConfig(config);
  return config;
}

function validateConfig(config: FrameworkConfig): void {
  const errors: string[] = [];

  if (
    config.host !== undefined &&
    config.host !== "127.0.0.1" &&
    config.host !== "localhost" &&
    !config.bearerToken
  ) {
    errors.push(
      `host is set to "${config.host}" (non-localhost) but no bearerToken is configured. ` +
        `Set BROWSERKIT_TOKEN or add bearerToken to your config to prevent unauthorized access.`
    );
  }

  if (
    config.basePort !== undefined &&
    (typeof config.basePort !== "number" ||
      config.basePort < 1 ||
      config.basePort > 65535)
  ) {
    errors.push("basePort: must be a valid port number (1–65535)");
  }

  if (!config.adapters || typeof config.adapters !== "object") {
    errors.push("adapters: must be an object");
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid browserkit config:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }
}
