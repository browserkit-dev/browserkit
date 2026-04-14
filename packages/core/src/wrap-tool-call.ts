/**
 * Tool call pipeline: FIFO lock → rate limit → login check → handler.
 * Shared across all MCP sessions for a single adapter server instance.
 */

import { z } from "zod";
import type { Page } from "patchright";
import type { SiteAdapter, SessionConfig, ToolResult } from "./types.js";
import { SessionManager } from "./session-manager.js";
import { LockManager } from "./lock-manager.js";
import { RateLimiter } from "./rate-limiter.js";
import {
  buildHandoffResult,
  handleAuthFailure,
  isBackgroundLoginInProgress,
} from "./human-handoff.js";
import {
  screenshotOnError,
  screenshotToContent,
  detectRateLimit,
} from "./adapter-utils.js";
import { LoginError } from "./types.js";
import { getLogger } from "./logger.js";

const log = getLogger("adapter-server");

export type ToolCallResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: "image/png" }
  >;
};

/** Mutable ref shared between wrapToolCall and the browser health_check tool. */
export interface LastCall {
  at: Date | undefined;
  tool: string | undefined;
}

export interface WrapToolCallDeps {
  adapter: SiteAdapter;
  sessionConfig: SessionConfig;
  sessionManager: SessionManager;
  lock: LockManager;
  rateLimiter: RateLimiter;
  minDelayMs: number;
  lastCall: LastCall;
}

export function errorResult(
  message: string
): ToolCallResult & { isError: boolean } {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Returns a Zod shape record from an input schema, unwrapping ZodEffects.
 * Uses typeName string comparison to avoid false negatives when adapter and
 * core resolve separate Zod installations (common with file: deps).
 */
export function extractZodShape(
  schema: z.ZodTypeAny
): Record<string, z.ZodTypeAny> {
  const def = (
    schema as { _def?: { typeName?: string; schema?: z.ZodTypeAny } }
  )._def;
  if (!def) return {};
  if (def.typeName === "ZodObject")
    return (schema as z.ZodObject<z.ZodRawShape>).shape;
  if (def.typeName === "ZodEffects" && def.schema)
    return extractZodShape(def.schema);
  return {};
}

/**
 * Factory that returns the `wrapToolCall` closure for a single adapter server.
 * Mutates `deps.lastCall` on each successful call.
 */
export function createWrapToolCall(
  deps: WrapToolCallDeps
): (toolName: string, input: unknown) => Promise<ToolCallResult> {
  const {
    adapter,
    sessionConfig,
    sessionManager,
    lock,
    rateLimiter,
    minDelayMs,
    lastCall,
  } = deps;
  const { site } = sessionConfig;

  return async function wrapToolCall(
    toolName: string,
    input: unknown
  ): Promise<ToolCallResult> {
    const release = await lock.acquire(site);
    try {
      if (minDelayMs > 0) await rateLimiter.waitIfNeeded(site, minDelayMs);

      let page: Page;
      try {
        page = await sessionManager.getPage(sessionConfig, adapter);
      } catch (err) {
        return errorResult(`Failed to get browser page: ${String(err)}`);
      }

      const loggedIn = await adapter.isLoggedIn(page);
      if (!loggedIn) {
        let reauthed: boolean;
        try {
          reauthed = await handleAuthFailure(
            sessionManager,
            sessionConfig,
            adapter
          );
        } catch (err) {
          if (err instanceof LoginError) {
            return errorResult(
              `Login failed (${err.errorType}): ${err.message}`
            );
          }
          throw err;
        }
        if (!reauthed) {
          if (sessionConfig.authStrategy === "extension") {
            return errorResult(
              `Not logged in to ${adapter.domain}. Please log into ${adapter.domain} in your Chrome browser and ensure the Playwriter extension is active on the tab, then retry.`
            );
          }
          return buildHandoffResult(
            adapter,
            isBackgroundLoginInProgress(adapter.site)
          ) as ToolCallResult;
        }
        page = await sessionManager.getPage(sessionConfig, adapter);
      }

      const tool = adapter.tools().find((t) => t.name === toolName);
      if (!tool) return errorResult(`Tool "${toolName}" not found`);

      let result: ToolResult;
      try {
        result = await tool.handler(page, input);
        await detectRateLimit(page);
      } catch (err) {
        log.error({ site, tool: toolName, err }, "tool handler error");
        const screenshotContent = await screenshotToContent(page).catch(
          () => null
        );
        const dataDir = sessionManager.getDataDir();
        await screenshotOnError(page, `${dataDir}/errors`, site).catch(
          () => {}
        );
        const content: ToolResult["content"] = [
          { type: "text", text: `Tool "${toolName}" failed: ${String(err)}` },
        ];
        if (screenshotContent) content.push(screenshotContent);
        return { content, isError: true } as ToolCallResult;
      }

      lastCall.at = new Date();
      lastCall.tool = toolName;
      rateLimiter.recordCall(site);
      return result as ToolCallResult;
    } finally {
      release();
    }
  };
}
