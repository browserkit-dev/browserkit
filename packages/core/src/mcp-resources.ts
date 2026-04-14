/**
 * Registers MCP resources, prompts, and the close_session tool on an McpServer.
 * These are management-plane items that do not go through the LockManager.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiteAdapter, SessionConfig } from "./types.js";
import { SessionManager } from "./session-manager.js";

export interface McpResourcesDeps {
  site: string;
  adapter: SiteAdapter;
  sessionConfig: SessionConfig;
  sessionManager: SessionManager;
}

export function registerMcpResources(
  mcp: McpServer,
  deps: McpResourcesDeps
): void {
  const { site, adapter, sessionConfig, sessionManager } = deps;

  // ── Workflow prompts ──────────────────────────────────────────────────────
  mcp.prompt(
    "workflow-login",
    `How to handle authentication failures for ${adapter.domain}`,
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `# Login workflow for ${adapter.site} (${adapter.domain})`,
              "",
              "When a tool returns an authentication error or 'Not logged in':",
              "",
              "1. **Tell the user** their session has expired:",
              `   "Your ${adapter.site} session needs to be refreshed."`,
              "",
              "2. **Ask them to run** in a terminal:",
              `   \`browserkit login ${adapter.site}\``,
              "",
              "3. **Wait for confirmation** — do NOT retry the tool automatically.",
              "   The login command opens a browser window; the user needs to complete it.",
              "",
              "4. Once the user says they're done, **retry the original tool call**.",
              "",
              "**Never** loop retrying a tool after an auth failure without user intervention.",
              `**Never** ask the user for credentials — ${adapter.domain} login happens in the browser.`,
            ].join("\n"),
          },
        },
      ],
    })
  );

  mcp.prompt(
    "workflow-debug",
    `How to debug empty or unexpected results from ${adapter.site} tools`,
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `# Debug workflow for ${adapter.site}`,
              "",
              "When a tool returns empty results, wrong data, or throws unexpectedly:",
              "",
              "**Step 1 — Make the browser visible**",
              '  Call: `browser({ action: "watch" })`',
              "",
              "**Step 2 — Retry the failing tool**",
              "  Watch the browser — does it navigate correctly? Does the page load?",
              "",
              "**Step 3 — Capture the page**",
              '  Call: `browser({ action: "screenshot" })` — inspect the image for errors, popups, or changed UI.',
              "",
              "**Step 4 — Check selector health**",
              '  Call: `browser({ action: "health_check" })` — look for selectors marked \'NOT FOUND\'.',
              "  If any selectors are broken, the site's DOM has changed.",
              "  → The adapter needs updating. Report to the adapter maintainer.",
              "",
              "**Step 5 — Manual investigation (if needed)**",
              '  Call: `browser({ action: "set_mode", mode: "paused" })` — browser stays visible, you control it.',
              "  Inspect the page manually in the browser.",
              '  Call: `browser({ action: "set_mode", mode: "headless" })` when done.',
              "",
              "**Common causes**: site redesign, A/B test, login prompt, CAPTCHA, rate limiting.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  // ── Page snapshot resource ────────────────────────────────────────────────
  mcp.resource(
    "page-snapshot",
    `page://${site}/snapshot`,
    {
      description: [
        `Accessibility tree snapshot of the current ${adapter.domain} page.`,
        "Use this to understand page structure before navigating or selecting elements.",
        "Cheaper than take_screenshot (text vs image tokens). Updated on each read.",
      ].join(" "),
      mimeType: "text/plain",
    },
    async (_uri) => {
      const page = await sessionManager.getPage(sessionConfig);
      let snapshot: string;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pageAny = page as any;
        if (typeof pageAny.ariaSnapshot === "function") {
          snapshot = (await pageAny.ariaSnapshot()) as string;
        } else {
          snapshot = await page.evaluate(() => {
            function walk(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              node: any,
              depth: number
            ): string {
              const indent = "  ".repeat(depth);
              const tag = (node.tagName as string).toLowerCase();
              const role = (node.getAttribute("role") as string | null) ?? "";
              const label =
                ((node.getAttribute("aria-label") as string | null) ??
                  (node.getAttribute("aria-labelledby") as string | null) ??
                  "") as string;
              const text = (
                (node.textContent as string) ?? ""
              )
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 80);
              const attrs = [
                role && `role="${role}"`,
                label && `aria-label="${label}"`,
              ]
                .filter(Boolean)
                .join(" ");
              const summary = `${indent}<${tag}${attrs ? " " + attrs : ""}>${text ? " " + text : ""}`;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const children = ([...(node.children as any)] as any[])
                .map((c) => walk(c, depth + 1))
                .join("\n");
              return children ? `${summary}\n${children}` : summary;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return walk((globalThis as any).document.body, 0);
          }) as string;
        }
      } catch {
        snapshot = `url: ${page.url()}\ntitle: ${await page.title().catch(() => "")}`;
      }

      const pageUrl = page.url();
      const title = await page.title().catch(() => "");
      return {
        contents: [
          {
            uri: `page://${site}/snapshot`,
            mimeType: "text/plain",
            text: `# Page snapshot — ${title}\n# URL: ${pageUrl}\n\n${snapshot}`,
          },
        ],
      };
    }
  );

  // ── close_session ─────────────────────────────────────────────────────────
  mcp.tool(
    "close_session",
    `Close the ${site} browser session and release all browser resources. ` +
      "The next tool call will automatically reopen the browser. " +
      "Use this when the session has gone stale, you want to force a fresh login, " +
      "or you want to free memory without stopping the daemon.",
    {},
    { title: "Close Browser Session", destructiveHint: true },
    async () => {
      await sessionManager.closeSite(site);
      return {
        content: [
          {
            type: "text" as const,
            text: `Browser session for "${site}" closed. The next tool call will relaunch it.`,
          },
        ],
      };
    }
  );
}
