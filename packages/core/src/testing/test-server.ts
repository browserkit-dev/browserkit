import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import type { SiteAdapter } from "../types.js";
import { SessionManager } from "../session-manager.js";
import { createAdapterServer } from "../adapter-server.js";

export interface TestAdapterServer {
  /** Full MCP endpoint URL: http://127.0.0.1:<port>/mcp */
  url: string;
  port: number;
  stop(): Promise<void>;
}

/**
 * Spin up an isolated in-process adapter server for testing.
 *
 * Uses a temporary data directory so it never conflicts with a running
 * browserkit daemon (pidfile isolation).
 *
 * @param adapter     The SiteAdapter to test
 * @param bearerToken Optional bearer token to require on requests
 */
export async function createTestAdapterServer(
  adapter: SiteAdapter,
  bearerToken?: string
): Promise<TestAdapterServer> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "browserkit-test-"));
  const port = await getFreePort();

  const sessionManager = new SessionManager({ dataDir });

  const handle = await createAdapterServer({
    adapter,
    adapterConfig: { port, authStrategy: "persistent" },
    port,
    host: "127.0.0.1",
    bearerToken,
    sessionManager,
  });

  return {
    url: handle.url,
    port,
    stop: async () => {
      await handle.stop();
      await sessionManager.closeAll();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Find a free TCP port by letting the OS assign one. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : null;
      server.close((err) => {
        if (err || port === null) reject(err ?? new Error("no port"));
        else resolve(port);
      });
    });
    server.once("error", reject);
  });
}
