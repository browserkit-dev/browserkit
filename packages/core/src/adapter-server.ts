import http from "node:http";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Page } from "patchright";
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
import { screenshotOnError, screenshotToContent, detectRateLimit } from "./adapter-utils.js";
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
    channel: adapterConfig.channel,
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
        // Check for rate limiting after each tool call — throws if detected,
        // which propagates to the outer catch and returns isError:true
        await detectRateLimit(page);
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

  // ── Zod schema shape extractor ────────────────────────────────────────────
  // Uses string-based typeName check instead of instanceof to avoid false
  // negatives when adapter and core have separate Zod installations (common
  // with file: deps where each package resolves its own node_modules).
  // Also unwraps ZodEffects (from .refine() / .transform()) to reach the
  // underlying ZodObject shape.
  function extractZodShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
    const def = (schema as { _def?: { typeName?: string; schema?: z.ZodTypeAny } })._def;
    if (!def) return {};
    if (def.typeName === "ZodObject") return (schema as z.ZodObject<z.ZodRawShape>).shape;
    // ZodEffects wraps .refine() and .transform() — unwrap to get the base object
    if (def.typeName === "ZodEffects" && def.schema) return extractZodShape(def.schema);
    return {};
  }

  function createMcpSession(transport: StreamableHTTPServerTransport): McpServer {
    const mcp = new McpServer({ name: `browserkit-${site}`, version: "0.1.0" });

    // ── Adapter tools ───────────────────────────────────────────────────────
    for (const tool of adapter.tools()) {
      const toolName = tool.name;
      const inputShape = tool.inputSchema;
      const annotations = {
        readOnlyHint: true,
        openWorldHint: true,
      };
      mcp.tool(
        toolName,
        tool.description,
        extractZodShape(inputShape),
        annotations,
        async (input: unknown) => wrapToolCall(toolName, input)
      );
    }

    // ── browser — consolidated management tool ────────────────────────────
    // Replaces the 5 individual management tools (health_check, set_mode,
    // take_screenshot, get_page_state, navigate) with a single tool so the
    // AI sees fewer choices in its context window.
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
        action: z.enum(["health_check", "screenshot", "page_state", "set_mode", "navigate"])
          .describe("What to do"),
        mode: z.enum(["headless", "watch", "paused"]).optional()
          .describe("Browser mode — required for action:set_mode"),
        slowMoMs: z.number().int().min(0).max(5000).optional()
          .describe("Slow motion ms — for action:set_mode with watch mode"),
        url: z.string().url().optional()
          .describe("URL to navigate to — required for action:navigate"),
      },
      async ({ action, mode, slowMoMs, url: navUrl }: {
        action: "health_check" | "screenshot" | "page_state" | "set_mode" | "navigate";
        mode?: BrowserMode;
        slowMoMs?: number;
        url?: string;
      }) => {
        // ── health_check ───────────────────────────────────────────────────
        if (action === "health_check") {
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
        }

        // ── screenshot ─────────────────────────────────────────────────────
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

        // ── page_state ─────────────────────────────────────────────────────
        if (action === "page_state") {
          const page = await sessionManager.getPage(sessionConfig);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                url: page.url(),
                title: await page.title().catch(() => ""),
                mode: sessionManager.getCurrentMode(site),
                isPaused: lock.isUserHolding(site),
                wsEndpoint: sessionManager.getCdpUrl(site),
              }, null, 2),
            }],
          };
        }

        // ── set_mode ───────────────────────────────────────────────────────
        if (action === "set_mode") {
          if (!mode) return errorResult("action:set_mode requires a mode param ('headless' | 'watch' | 'paused')");
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
            paused: "Browser is visible and tool calls are queued. You have manual control. Call browser({action:'set_mode',mode:'headless'}) to resume.",
          };
          return { content: [{ type: "text" as const, text: descriptions[mode] }] };
        }

        // ── navigate ───────────────────────────────────────────────────────
        if (action === "navigate") {
          if (!navUrl) return errorResult("action:navigate requires a url param");
          const page = await sessionManager.getPage(sessionConfig);
          await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
          return { content: [{ type: "text" as const, text: `Navigated to: ${page.url()}` }] };
        }

        return errorResult(`Unknown action: ${action as string}`);
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

    // ── close_session ────────────────────────────────────────────────────────
    // Closes the browser session for this adapter — useful when the session has
    // gone stale and you want a fresh start without restarting the whole daemon.
    // The next tool call will automatically relaunch the browser.
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
          content: [{
            type: "text" as const,
            text: `Browser session for "${site}" closed. The next tool call will relaunch it.`,
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
        // On fresh launch the page is at about:blank — navigate to the site
        // first so URL-based isLoggedIn checks work correctly.
        if (page.url() === "about:blank" && adapter.loginUrl) {
          await page.goto(adapter.loginUrl, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
        }
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
