import http from "node:http";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Page } from "playwright";
import type {
  SiteAdapter,
  AdapterConfig,
  ToolResult,
  AdapterStatus,
  BrowserMode,
} from "./types.js";
import { SessionManager } from "./session-manager.js";
import { LockManager } from "./lock-manager.js";
import { RateLimiter } from "./rate-limiter.js";
import { buildHandoffResult, handleAuthFailure, isBackgroundLoginInProgress } from "./human-handoff.js";
import { screenshotOnError, screenshotToContent } from "./adapter-utils.js";
import { getLogger } from "./logger.js";

const log = getLogger("adapter-server");

export interface AdapterServerOptions {
  adapter: SiteAdapter;
  adapterConfig: AdapterConfig;
  port: number;
  host: string;
  bearerToken?: string | undefined;
  sessionManager: SessionManager;
}

export interface AdapterServerHandle {
  site: string;
  port: number;
  url: string;
  stop(): Promise<void>;
  getStatus(): Promise<AdapterStatus>;
}

export async function createAdapterServer(
  opts: AdapterServerOptions
): Promise<AdapterServerHandle> {
  const { adapter, adapterConfig, port, host, bearerToken, sessionManager } = opts;
  const { site } = adapter;

  const lock = new LockManager();
  const rateLimiter = new RateLimiter();
  const minDelayMs =
    adapterConfig.rateLimit?.minDelayMs ?? adapter.rateLimit?.minDelayMs ?? 0;

  const sessionConfig = {
    site: adapter.site,
    domain: adapter.domain,
    authStrategy: adapterConfig.authStrategy ?? "persistent",
    profileDir: site,
    cdpUrl: adapterConfig.cdpUrl,
    debugPort: adapterConfig.debugPort,
    deviceEmulation: adapterConfig.deviceEmulation,
  };

  let lastCallAt: Date | undefined;
  let lastTool: string | undefined;

  // ── Tool call wrapper (shared across all MCP sessions) ────────────────────
  // Acquires the FIFO lock → enforces rate limit → checks login → runs handler.

  async function wrapToolCall(
    toolName: string,
    input: unknown
  ): Promise<{ content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }> }> {
    const release = await lock.acquire(site);
    try {
      if (minDelayMs > 0) await rateLimiter.waitIfNeeded(site, minDelayMs);

      let page: Page;
      try {
        page = await sessionManager.getPage(sessionConfig);
      } catch (err) {
        return errorResult(`Failed to get browser page: ${String(err)}`);
      }

      const loggedIn = await adapter.isLoggedIn(page);
      if (!loggedIn) {
        const reauthed = await handleAuthFailure(sessionManager, sessionConfig, adapter);
        if (!reauthed) {
          return buildHandoffResult(adapter, isBackgroundLoginInProgress(adapter.site)) as {
            content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }>;
          };
        }
        page = await sessionManager.getPage(sessionConfig);
      }

      const tool = adapter.tools().find((t) => t.name === toolName);
      if (!tool) return errorResult(`Tool "${toolName}" not found`);

      let result: ToolResult;
      try {
        result = await tool.handler(page, input);
      } catch (err) {
        log.error({ site, tool: toolName, err }, "tool handler error");
        const screenshotContent = await screenshotToContent(page).catch(() => null);
        const dataDir = sessionManager.getDataDir();
        await screenshotOnError(page, `${dataDir}/errors`, site).catch(() => {});
        const content: ToolResult["content"] = [
          { type: "text", text: `Tool "${toolName}" failed: ${String(err)}` },
        ];
        if (screenshotContent) content.push(screenshotContent);
        return { content, isError: true } as {
          content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }>;
        };
      }

      lastCallAt = new Date();
      lastTool = toolName;
      rateLimiter.recordCall(site);
      return result as {
        content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }>;
      };
    } finally {
      release();
    }
  }

  // ── Per-session McpServer factory ─────────────────────────────────────────
  // Each connecting MCP client gets its own McpServer + transport pair so the
  // protocol handshake (initialize) can happen independently per client.
  // All sessions share the same adapter, lock, rateLimiter, and browser.

  function createMcpSession(transport: StreamableHTTPServerTransport): McpServer {
    const mcp = new McpServer({ name: `browserkit-${site}`, version: "0.1.0" });

    // ── Adapter tools ───────────────────────────────────────────────────────
    for (const tool of adapter.tools()) {
      const toolName = tool.name;
      const inputShape = tool.inputSchema;
      mcp.tool(
        toolName,
        tool.description,
        inputShape instanceof z.ZodObject ? inputShape.shape : {},
        async (input: unknown) => wrapToolCall(toolName, input)
      );
    }

    // ── health_check ────────────────────────────────────────────────────────
    mcp.tool("health_check", "Check browser session health, login status, and selector validity", {}, async () => {
      const page = await sessionManager.getPage(sessionConfig);
      const loggedIn = await adapter.isLoggedIn(page);
      let selectorsReport: Record<string, unknown> | undefined;
      if (adapter.selectors) {
        const { validateSelectors } = await import("./adapter-utils.js");
        selectorsReport = await validateSelectors(page, adapter.selectors);
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            site,
            mode: sessionManager.getCurrentMode(site),
            loggedIn,
            selectors: selectorsReport,
            lastCallAt: lastCallAt?.toISOString(),
            lastTool,
          }, null, 2),
        }],
      };
    });

    // ── set_mode ────────────────────────────────────────────────────────────
    mcp.tool(
      "set_mode",
      [
        "Switch the browser between operating modes:",
        "  • headless — fully invisible, automation runs normally (default)",
        "  • watch    — browser becomes visible so you can observe automation in real-time",
        "  • paused   — browser visible AND tool calls queued; you have manual control",
        "Use slowMoMs with watch mode to slow down each Playwright action (good for debugging).",
      ].join("\n"),
      {
        mode: z.enum(["headless", "watch", "paused"]).describe("Target browser mode"),
        slowMoMs: z.number().int().min(0).max(5000).optional()
          .describe("ms delay between Playwright actions (watch mode only)"),
      },
      async ({ mode, slowMoMs }: { mode: BrowserMode; slowMoMs?: number }) => {
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
          paused: "Browser is visible and tool calls are queued. You have manual control. Call set_mode with headless or watch to resume.",
        };

        return { content: [{ type: "text" as const, text: descriptions[mode] }] };
      }
    );

    // ── take_screenshot ─────────────────────────────────────────────────────
    mcp.tool(
      "take_screenshot",
      "Capture the current browser page as an image. Useful for inspecting page state, debugging selectors, or seeing what the user left the browser on after pause mode.",
      {},
      async () => {
        const page = await sessionManager.getPage(sessionConfig);
        const imageContent = await screenshotToContent(page);
        const pageUrl = page.url();
        return {
          content: [
            { type: "text" as const, text: `Screenshot of: ${pageUrl}` },
            imageContent,
          ],
        };
      }
    );

    // ── get_page_state ──────────────────────────────────────────────────────
    mcp.tool(
      "get_page_state",
      [
        "Get the current URL, title, browser mode, and CDP endpoint.",
        "The cdpUrl (if configured via debugPort) lets external agents attach to this adapter's",
        "already-authenticated browser session and run arbitrary Playwright code:",
        "  const browser = await chromium.connectOverCDP(cdpUrl);",
        "  const context = browser.contexts()[0]; // already logged in",
        "  const page = context.pages()[0];",
        "  // full Playwright API available",
        "Enable by setting debugPort in your config (recommended: adapterPort + 1000).",
      ].join("\n"),
      {},
      async () => {
        const page = await sessionManager.getPage(sessionConfig);
        const mode = sessionManager.getCurrentMode(site);
        const wsEndpoint = sessionManager.getCdpUrl(site);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              url: page.url(),
              title: await page.title().catch(() => ""),
              mode,
              isPaused: lock.isUserHolding(site),
              wsEndpoint,
            }, null, 2),
          }],
        };
      }
    );

    // ── navigate ────────────────────────────────────────────────────────────
    mcp.tool(
      "navigate",
      "Navigate the browser to a URL. Intended for use in paused or watch mode to position the browser before or after manual interaction.",
      { url: z.string().url().describe("URL to navigate to") },
      async ({ url: navUrl }: { url: string }) => {
        const page = await sessionManager.getPage(sessionConfig);
        await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
        return {
          content: [{ type: "text" as const, text: `Navigated to: ${page.url()}` }],
        };
      }
    );

    // ── Workflow prompts ────────────────────────────────────────────────────
    mcp.prompt(
      "workflow-login",
      `How to handle authentication failures for ${adapter.domain}`,
      async () => ({
        messages: [{
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
        }],
      })
    );

    mcp.prompt(
      "workflow-debug",
      `How to debug empty or unexpected results from ${adapter.site} tools`,
      async () => ({
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `# Debug workflow for ${adapter.site}`,
              "",
              "When a tool returns empty results, wrong data, or throws unexpectedly:",
              "",
              "**Step 1 — Make the browser visible**",
              "  Call: `set_mode({ mode: \"watch\" })`",
              "",
              "**Step 2 — Retry the failing tool**",
              "  Watch the browser — does it navigate correctly? Does the page load?",
              "",
              "**Step 3 — Capture the page**",
              "  Call: `take_screenshot()` — inspect the image for errors, popups, or changed UI.",
              "",
              "**Step 4 — Check selector health**",
              "  Call: `health_check()` — look for selectors marked 'NOT FOUND'.",
              "  If any selectors are broken, the site's DOM has changed.",
              "  → The adapter needs updating. Report to the adapter maintainer.",
              "",
              "**Step 5 — Manual investigation (if needed)**",
              "  Call: `set_mode({ mode: \"paused\" })` — browser stays visible, you control it.",
              "  Inspect the page manually in the browser.",
              "  Call: `set_mode({ mode: \"headless\" })` when done.",
              "",
              "**Common causes**: site redesign, A/B test, login prompt, CAPTCHA, rate limiting.",
            ].join("\n"),
          },
        }],
      })
    );

    mcp.prompt(
      "workflow-raw-access",
      `How to run custom Playwright automation against the ${adapter.site} session`,
      async () => {
        const cdpUrl = sessionManager.getCdpUrl(site);
        const cdpNote = cdpUrl
          ? `The current CDP endpoint is: \`${cdpUrl}\``
          : `CDP is not enabled. Add \`debugPort: ${port + 1000}\` to your browserkit.config.js for this adapter.`;

        return {
          messages: [{
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `# Raw Playwright access for ${adapter.site}`,
                "",
                "Use this when the adapter doesn't have a tool for what you need.",
                "",
                cdpNote,
                "",
                "**How to use:**",
                "",
                "1. Call `get_page_state()` to get the current `cdpUrl`.",
                "",
                "2. Write a Playwright script to `/tmp/script.js`:",
                "```javascript",
                "const { chromium } = require('playwright');",
                "(async () => {",
                `  const browser = await chromium.connectOverCDP("${cdpUrl ?? "http://127.0.0.1:PORT"}");`,
                "  const context = browser.contexts()[0]; // already authenticated",
                "  const page = context.pages()[0];",
                "",
                "  // Your automation here:",
                "  await page.goto('https://...');",
                "  const result = await page.$$eval('.selector', els => els.map(el => el.textContent));",
                "  console.log(JSON.stringify(result));",
                "",
                "  await browser.disconnect(); // NOT close() — keeps the session alive",
                "})();",
                "```",
                "",
                "3. Execute: `node /tmp/script.js`",
                "",
                "4. Read stdout for results.",
                "",
                "**Important**: always use `browser.disconnect()`, never `browser.close()`.",
                "Closing the browser ends the authenticated session.",
              ].join("\n"),
            },
          }],
        };
      }
    );

    // ── Page snapshot resource ───────────────────────────────────────────────
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
            snapshot = await pageAny.ariaSnapshot() as string;
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
                const text = ((node.textContent as string) ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
                const attrs = [role && `role="${role}"`, label && `aria-label="${label}"`]
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
          contents: [{
            uri: `page://${site}/snapshot`,
            mimeType: "text/plain",
            text: `# Page snapshot — ${title}\n# URL: ${pageUrl}\n\n${snapshot}`,
          }],
        };
      }
    );

    mcp.connect(transport).catch((err) => {
      log.error({ site, err }, "failed to connect McpServer to transport");
    });

    return mcp;
  }

  // ── HTTP server with per-session McpServer+transport ──────────────────────
  // Each new MCP client (new initialize request) gets a fresh McpServer+transport
  // pair, keyed by session ID. Subsequent requests from the same client are routed
  // to its existing transport. The underlying browser/lock is shared across all.

  const mcpSessions = new Map<string, StreamableHTTPServerTransport>();
  const mcpInstances = new Map<string, McpServer>();

  const server = http.createServer((req, res) => {
    // Only handle MCP requests on /mcp
    if (req.url !== "/mcp" && !req.url?.startsWith("/mcp?")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. MCP endpoint is POST /mcp" }));
      return;
    }

    if (bearerToken) {
      const auth = req.headers["authorization"];
      if (auth !== `Bearer ${bearerToken}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    // Existing session → route to its transport
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? mcpSessions.get(sessionId) : undefined;

    if (!transport) {
      // New client: create a fresh McpServer + transport pair
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          if (transport) mcpSessions.set(id, transport);
        },
        onsessionclosed: (id) => {
          mcpSessions.delete(id);
          mcpInstances.delete(id);
        },
      });
      const mcp = createMcpSession(transport);
      // We also store by temp key until onsessioninitialized fires with the real ID
      const tempKey = `__new__${Date.now()}__`;
      mcpSessions.set(tempKey, transport);
      mcpInstances.set(tempKey, mcp);
    }

    transport.handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.once("error", reject);
  });

  const url = `http://${host}:${port}/mcp`;
  log.info({ site, url }, "adapter server listening");

  return {
    site,
    port,
    url,
    stop: async () => {
      lock.releaseAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const mcp of mcpInstances.values()) {
        await mcp.close().catch(() => {});
      }
      mcpSessions.clear();
      mcpInstances.clear();
    },
    getStatus: async (): Promise<AdapterStatus> => {
      let loggedIn = false;
      try {
        const page = await sessionManager.getPage(sessionConfig);
        loggedIn = await adapter.isLoggedIn(page);
      } catch { loggedIn = false; }
      return {
        site,
        port,
        url,
        loggedIn,
        lastCallAt,
        lastTool,
        mode: sessionManager.getCurrentMode(site),
        wsEndpoint: sessionManager.getCdpUrl(site),
      };
    },
  };
}

function errorResult(message: string): { content: Array<{ type: "text"; text: string }>; isError: boolean } {
  return { content: [{ type: "text", text: message }], isError: true };
}
