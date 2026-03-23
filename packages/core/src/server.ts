import http from "node:http";
import type { FrameworkConfig, DaemonStatus } from "./types.js";
import { SessionManager } from "./session-manager.js";
import { createAdapterServer, type AdapterServerHandle } from "./adapter-server.js";
import { getLogger } from "./logger.js";

const log = getLogger("server");

export interface ServerHandle {
  stop(): Promise<void>;
  getStatus(): Promise<DaemonStatus>;
}

async function loadAdapter(packageName: string) {
  try {
    const mod = await import(packageName);
    const adapter = mod.default ?? mod;
    if (typeof adapter?.site !== "string" || typeof adapter?.isLoggedIn !== "function") {
      throw new Error(
        `Package "${packageName}" does not export a valid SiteAdapter. ` +
          `Make sure it uses defineAdapter() and has a default export.`
      );
    }
    return adapter;
  } catch (err: unknown) {
    if (isModuleNotFoundError(err)) {
      throw new Error(`Adapter package "${packageName}" is not installed.\nRun: pnpm add ${packageName}`);
    }
    throw err;
  }
}

function isModuleNotFoundError(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND";
}

export async function startServer(config: FrameworkConfig): Promise<ServerHandle> {
  const host = config.host ?? "127.0.0.1";
  const basePort = config.basePort ?? 3847;

  if (host !== "127.0.0.1" && host !== "localhost" && !config.bearerToken) {
    throw new Error(
      `host is "${host}" (non-localhost) but no bearerToken is configured. ` +
        `Set SESSION_MCP_TOKEN or add bearerToken to your config.`
    );
  }

  const sessionManager = new SessionManager();
  const handles: AdapterServerHandle[] = [];

  let portCounter = basePort;
  for (const [packageName, adapterConfig] of Object.entries(config.adapters)) {
    const adapter = await loadAdapter(packageName);
    const port = adapterConfig.port ?? portCounter++;
    const handle = await createAdapterServer({
      adapter, adapterConfig, port, host,
      bearerToken: config.bearerToken,
      sessionManager,
    });
    handles.push(handle);
  }

  // Startup auth check — non-blocking warn
  checkStartupAuth(handles);

  // Lightweight status-only sidecar (used by CLI `browserkit status`).
  // Browser control and management is done via MCP tools on each adapter's port.
  const statusServer = startStatusSidecar(basePort - 1, host, handles);

  return {
    stop: async () => {
      await Promise.all(handles.map((h) => h.stop()));
      await new Promise<void>((resolve) => statusServer.close(() => resolve()));
      await sessionManager.closeAll();
    },
    getStatus: async (): Promise<DaemonStatus> => {
      const adapters = await Promise.all(handles.map((h) => h.getStatus()));
      return { pid: process.pid, startedAt: new Date(), uptimeMs: process.uptime() * 1000, adapters };
    },
  };
}

function checkStartupAuth(handles: AdapterServerHandle[]): void {
  setTimeout(async () => {
    const notLoggedIn: string[] = [];
    for (const handle of handles) {
      try {
        const status = await handle.getStatus();
        if (!status.loggedIn) notLoggedIn.push(status.site);
      } catch { /* ignore */ }
    }
    if (notLoggedIn.length > 0) {
      console.log(`\n  ⚠  Not logged in: ${notLoggedIn.join(", ")}`);
      for (const site of notLoggedIn) console.log(`     Run: browserkit login ${site}`);
      console.log();
    }
  }, 500);
}

/**
 * Minimal status-only HTTP sidecar for the CLI `browserkit status` command.
 * All browser control is via MCP tools — no management routes needed here.
 */
function startStatusSidecar(port: number, host: string, handles: AdapterServerHandle[]): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.url !== "/status" || req.method !== "GET") {
      res.writeHead(404); res.end(); return;
    }
    const adapters = await Promise.all(handles.map((h) => h.getStatus()));
    const status: DaemonStatus = {
      pid: process.pid,
      startedAt: new Date(),
      uptimeMs: process.uptime() * 1000,
      adapters,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status, null, 2));
  });
  server.listen(port, host, () => log.info({ port, host }, "status sidecar listening"));
  return server;
}
