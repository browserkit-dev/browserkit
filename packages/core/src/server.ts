import http from "node:http";
import type { FrameworkConfig, DaemonStatus } from "./types.js";
import { SessionManager } from "./session-manager.js";
import { createAdapterServer, type AdapterServerHandle } from "./adapter-server.js";
import { getLogger } from "./logger.js";
import { satisfies, readCoreVersion } from "./version-check.js";

const log = getLogger("server");

export interface ServerHandle {
  stop(): Promise<void>;
  getStatus(): Promise<DaemonStatus>;
  /** Reload a single adapter by site name — MCP server restarts, browser session stays alive. */
  reload(site: string): Promise<void>;
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
    // Version compatibility check
    if (typeof adapter.minCoreVersion === "string") {
      const coreVer = readCoreVersion();
      if (!satisfies(coreVer, adapter.minCoreVersion)) {
        throw new Error(
          `Adapter "${adapter.site}" requires @browserkit-dev/core >= ${adapter.minCoreVersion}, ` +
          `but the running version is ${coreVer}.\n` +
          `Run: pnpm add @browserkit-dev/core@latest`
        );
      }
    }
    return adapter;
  } catch (err: unknown) {
    if (isModuleNotFoundError(err)) {
      throw new Error(`Adapter package "${packageName}" is not installed.\nRun: pnpm add ${packageName}`);
    }
    throw err;
  }
}

/**
 * Force-reload an adapter module by appending a cache-busting timestamp.
 * ESM has no require.cache — the only way to bypass the import cache is to
 * use a different URL. A query-string suffix makes it a new specifier.
 */
async function reloadAdapter(packageName: string) {
  // For file paths, append ?v=<ts>. For bare npm specifiers, this doesn't work
  // but npm packages rarely change without a version bump, so we try anyway.
  const cacheBust = packageName.startsWith("/") || packageName.startsWith(".")
    ? `${packageName}?v=${Date.now()}`
    : packageName;
  try {
    const mod = await import(cacheBust);
    const adapter = mod.default ?? mod;
    if (typeof adapter?.site !== "string" || typeof adapter?.isLoggedIn !== "function") {
      throw new Error(`Reloaded module "${packageName}" does not export a valid SiteAdapter.`);
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

async function buildDaemonStatus(handles: AdapterServerHandle[]): Promise<DaemonStatus> {
  const adapters = await Promise.all(handles.map((h) => h.getStatus()));
  return { pid: process.pid, startedAt: new Date(), uptimeMs: process.uptime() * 1000, adapters };
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

  const sessionManager = new SessionManager(config.dataDir ? { dataDir: config.dataDir } : {});

  // Track adapter entries alongside their handles so we can reload them
  const adapterEntries: Array<{ packageName: string; adapterConfig: import("./types.js").AdapterConfig; port: number }> = [];
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
    adapterEntries.push({ packageName, adapterConfig, port });
  }

  // Startup auth check — non-blocking warn
  checkStartupAuth(handles);

  // Status sidecar with reload support
  const statusServer = startStatusSidecar(basePort - 1, host, handles, reload);

  async function reload(site: string): Promise<void> {
    const idx = handles.findIndex((h) => h.site === site);
    if (idx === -1) throw new Error(`No adapter with site "${site}" is running.`);

    const entry = adapterEntries[idx];
    if (!entry) throw new Error(`Adapter entry for "${site}" not found.`);

    log.info({ site }, "reloading adapter — stopping MCP server (browser session preserved)");

    // Stop the MCP server (browser context is owned by SessionManager, not the handle)
    await handles[idx]!.stop();

    // Re-import the adapter module with a cache-busting URL
    log.info({ site, packageName: entry.packageName }, "re-importing adapter module");
    const newAdapter = await reloadAdapter(entry.packageName);

    // Start a fresh MCP server for this adapter on the same port
    const newHandle = await createAdapterServer({
      adapter: newAdapter,
      adapterConfig: entry.adapterConfig,
      port: entry.port,
      host,
      bearerToken: config.bearerToken,
      sessionManager, // same SessionManager — browser session stays alive
    });

    handles[idx] = newHandle;
    log.info({ site, port: entry.port }, "adapter reloaded successfully");
  }

  return {
    stop: async () => {
      await Promise.all(handles.map((h) => h.stop()));
      await new Promise<void>((resolve) => statusServer.close(() => resolve()));
      await sessionManager.closeAll();
    },
    getStatus: async (): Promise<DaemonStatus> => {
      return buildDaemonStatus(handles);
    },
    reload,
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
 * Status sidecar — serves GET /status and POST /reload/:site.
 */
function startStatusSidecar(
  port: number,
  host: string,
  handles: AdapterServerHandle[],
  reload: (site: string) => Promise<void>
): http.Server {
  const server = http.createServer(async (req, res) => {
    // GET /status
    if (req.url === "/status" && req.method === "GET") {
      const status = await buildDaemonStatus(handles);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status, null, 2));
      return;
    }

    // POST /reload/:site
    const reloadMatch = req.url?.match(/^\/reload\/([^/]+)$/) ;
    if (reloadMatch && req.method === "POST") {
      const site = decodeURIComponent(reloadMatch[1] ?? "");
      try {
        await reload(site);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, site }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });
  server.listen(port, host, () => log.info({ port, host }, "status sidecar listening"));
  return server;
}
