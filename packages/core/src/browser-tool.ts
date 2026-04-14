/**
 * Registers the consolidated `browser` management tool on an McpServer instance.
 * Bypasses the LockManager so management actions never block/are blocked by tool calls.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiteAdapter, SessionConfig, BrowserMode } from "./types.js";
import { SessionManager } from "./session-manager.js";
import { LockManager } from "./lock-manager.js";
import { screenshotToContent } from "./adapter-utils.js";
import { errorResult, type LastCall } from "./wrap-tool-call.js";

export interface BrowserToolDeps {
  site: string;
  adapter: SiteAdapter;
  sessionConfig: SessionConfig;
  sessionManager: SessionManager;
  lock: LockManager;
  lastCall: LastCall;
}

export function registerBrowserTool(
  mcp: McpServer,
  deps: BrowserToolDeps
): void {
  const { site, adapter, sessionConfig, sessionManager, lock, lastCall } = deps;

  mcp.tool(
    "browser",
    [
      `Browser management tool for the ${site} adapter. Use to inspect or control the browser session.`,
      "",
      "Actions:",
      "  health_check  — login status, current mode, selector validity report",
      "  screenshot    — capture current page as an inline image",
      "  page_state    — current URL, title, mode, CDP endpoint",
      "  set_mode      — switch headless/watch/paused; requires mode param",
      "  navigate      — navigate to a URL; requires url param (use in watch/paused mode)",
      "",
      "Params:",
      "  action   (required) — one of the actions above",
      "  mode     (optional) — 'headless' | 'watch' | 'paused'  (for action:set_mode)",
      "  slowMoMs (optional) — ms delay per action in watch mode",
      "  url      (optional) — URL to navigate to  (for action:navigate)",
    ].join("\n"),
    {
      action: z
        .enum(["health_check", "screenshot", "page_state", "set_mode", "navigate"])
        .describe("What to do"),
      mode: z
        .enum(["headless", "watch", "paused"])
        .optional()
        .describe("Browser mode — required for action:set_mode"),
      slowMoMs: z
        .number()
        .int()
        .min(0)
        .max(5000)
        .optional()
        .describe("Slow motion ms — for action:set_mode with watch mode"),
      url: z
        .string()
        .url()
        .optional()
        .describe("URL to navigate to — required for action:navigate"),
    },
    async ({
      action,
      mode,
      slowMoMs,
      url: navUrl,
    }: {
      action: "health_check" | "screenshot" | "page_state" | "set_mode" | "navigate";
      mode?: BrowserMode;
      slowMoMs?: number;
      url?: string;
    }) => {
      // ── health_check ─────────────────────────────────────────────────────
      if (action === "health_check") {
        const page = await sessionManager.getPage(sessionConfig);
        const loggedIn = await adapter.isLoggedIn(page);
        let selectorsReport: Record<string, unknown> | undefined;
        if (adapter.selectors) {
          const { validateSelectors } = await import("./adapter-utils.js");
          selectorsReport = await validateSelectors(page, adapter.selectors);
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  site,
                  mode: sessionManager.getCurrentMode(site),
                  loggedIn,
                  selectors: selectorsReport,
                  lastCallAt: lastCall.at?.toISOString(),
                  lastTool: lastCall.tool,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ── screenshot ───────────────────────────────────────────────────────
      if (action === "screenshot") {
        const page = await sessionManager.getPage(sessionConfig);
        const imageContent = await screenshotToContent(page);
        return {
          content: [
            { type: "text" as const, text: `Screenshot of: ${page.url()}` },
            imageContent,
          ],
        };
      }

      // ── page_state ───────────────────────────────────────────────────────
      if (action === "page_state") {
        const page = await sessionManager.getPage(sessionConfig);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  url: page.url(),
                  title: await page.title().catch(() => ""),
                  mode: sessionManager.getCurrentMode(site),
                  isPaused: lock.isUserHolding(site),
                  wsEndpoint: sessionManager.getCdpUrl(site),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ── set_mode ─────────────────────────────────────────────────────────
      if (action === "set_mode") {
        if (!mode)
          return errorResult(
            "action:set_mode requires a mode param ('headless' | 'watch' | 'paused')"
          );
        if (sessionConfig.authStrategy === "extension") {
          return {
            content: [
              {
                type: "text" as const,
                text: "Browser is running in extension mode — the user's real Chrome is always visible. Mode-switching is not applicable.",
              },
            ],
          };
        }
        const previousMode = sessionManager.getCurrentMode(site);
        if (mode === "paused" && previousMode !== "paused") {
          lock.holdForUser(site);
        } else if (mode !== "paused" && previousMode === "paused") {
          lock.releaseUserHold(site);
        }
        const needsHeaded = mode !== "headless";
        const currentHeaded = previousMode !== "headless";
        if (needsHeaded !== currentHeaded || (needsHeaded && slowMoMs !== undefined)) {
          await sessionManager.setMode(sessionConfig, mode, slowMoMs);
        }
        const descriptions: Record<BrowserMode, string> = {
          headless: "Browser is now headless — fully invisible. Automation running normally.",
          watch: slowMoMs
            ? `Browser is now visible with ${slowMoMs}ms slow motion. Watching automation.`
            : "Browser is now visible. You can watch automation running.",
          paused:
            "Browser is visible and tool calls are queued. You have manual control. Call browser({action:'set_mode',mode:'headless'}) to resume.",
        };
        return {
          content: [{ type: "text" as const, text: descriptions[mode] }],
        };
      }

      // ── navigate ─────────────────────────────────────────────────────────
      if (action === "navigate") {
        if (!navUrl) return errorResult("action:navigate requires a url param");
        const page = await sessionManager.getPage(sessionConfig);
        await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
        return {
          content: [
            { type: "text" as const, text: `Navigated to: ${page.url()}` },
          ],
        };
      }

      return errorResult(`Unknown action: ${action as string}`);
    }
  );
}
