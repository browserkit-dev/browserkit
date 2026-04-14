import http from "node:http";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { SiteAdapter, AdapterConfig, AdapterStatus } from "./types.js";
import { SessionManager } from "./session-manager.js";
import { LockManager } from "./lock-manager.js";
import { RateLimiter } from "./rate-limiter.js";
import {
  createWrapToolCall,
  extractZodShape,
  type LastCall,
} from "./wrap-tool-call.js";
import { registerBrowserTool } from "./browser-tool.js";
import { registerMcpResources } from "./mcp-resources.js";
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
    extensionPort: adapterConfig.extensionPort,
    deviceEmulation: adapterConfig.deviceEmulation,
    channel: adapterConfig.channel,
    antiDetection: adapterConfig.antiDetection,
  };

  const lastCall: LastCall = { at: undefined, tool: undefined };

  const wrapToolCall = createWrapToolCall({
    adapter,
    sessionConfig,
    sessionManager,
    lock,
    rateLimiter,
    minDelayMs,
    lastCall,
  });

  // ── Per-session McpServer factory ─────────────────────────────────────────
  // Each connecting MCP client gets its own McpServer + transport pair so the
  // protocol handshake (initialize) happens independently per client.
  // All sessions share the same adapter, lock, rateLimiter, and browser.
  function createMcpSession(transport: StreamableHTTPServerTransport): McpServer {
    const mcp = new McpServer({ name: `browserkit-${site}`, version: "0.1.0" });

    for (const tool of adapter.tools()) {
      const toolName = tool.name;
      mcp.tool(
        toolName,
        tool.description,
        extractZodShape(tool.inputSchema),
        { readOnlyHint: true, openWorldHint: true },
        async (input: unknown) => wrapToolCall(toolName, input)
      );
    }

    registerBrowserTool(mcp, { site, adapter, sessionConfig, sessionManager, lock, lastCall });
    registerMcpResources(mcp, { site, adapter, sessionConfig, sessionManager });

    mcp.connect(transport).catch((err) => {
      log.error({ site, err }, "failed to connect McpServer to transport");
    });

    return mcp;
  }

  // ── HTTP server with per-session McpServer+transport ──────────────────────
  const mcpSessions = new Map<string, StreamableHTTPServerTransport>();
  const mcpInstances = new Map<string, McpServer>();

  const server = http.createServer((req, res) => {
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

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? mcpSessions.get(sessionId) : undefined;

    if (!transport) {
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
        if (page.url() === "about:blank" && adapter.loginUrl) {
          await page
            .goto(adapter.loginUrl, { waitUntil: "domcontentloaded", timeout: 20_000 })
            .catch(() => {});
        }
        loggedIn = await adapter.isLoggedIn(page);
      } catch {
        loggedIn = false;
      }
      return {
        site,
        port,
        url,
        loggedIn,
        lastCallAt: lastCall.at,
        lastTool: lastCall.tool,
        authStrategy: sessionConfig.authStrategy,
        mode: sessionManager.getCurrentMode(site),
        wsEndpoint: sessionManager.getCdpUrl(site),
      };
    },
  };
}
