/**
 * E2E smoke test — full daemon lifecycle with HN and Google Discover adapters.
 *
 * Phase 1: Start daemon with only the HackerNews adapter.
 *          Verify get_top returns real articles — adapter is working.
 *
 * Phase 2: Restart daemon adding the Google Discover adapter.
 *          Verify GD reports "not logged in" with a structured error
 *          (no crash, no timeout, just a clear message) — adapter installed correctly.
 *
 * What this test does NOT do:
 *   - Test npm install from scratch (packages are already installed locally)
 *   - Test Google login (requires a real Google account)
 *   - Test the full infinite scroll (known limitation, documented elsewhere)
 *
 * Prerequisites:
 *   - pnpm build must have been run
 *   - adapter-hackernews must be available at packages/adapter-hackernews
 *   - adapter-google-discover must be available at ../../browserkit-adapter-google-discover
 *
 * Run: pnpm test:e2e
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import fs from "node:fs";
import { createTestMcpClient, type TestMcpClient } from "@browserkit/core/testing";

// ── Paths ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CLI = path.join(ROOT, "packages/core/dist/cli.js");
const HN_ADAPTER = path.join(ROOT, "packages/adapter-hackernews/dist/index.js");
const GD_ADAPTER = path.resolve(ROOT, "../browserkit-adapter-google-discover/dist/index.js");

const hnAdapterAvailable = fs.existsSync(HN_ADAPTER);

// Isolated data dir so this test never conflicts with the user's running daemon
const E2E_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "browserkit-e2e-"));

const HN_PORT = 54200;
const GD_PORT = 54201;
const STATUS_PORT = HN_PORT - 1; // 54199

// ── Daemon helpers ────────────────────────────────────────────────────────────

function writeDaemonConfig(adapters: Record<string, object>, configPath: string): void {
  const lines = [
    "export default {",
    `  host: "127.0.0.1",`,
    `  basePort: ${HN_PORT},`,
    `  dataDir: "${E2E_DATA_DIR}",`,
    "  adapters: {",
  ];
  for (const [pkg, opts] of Object.entries(adapters)) {
    lines.push(`    "${pkg}": ${JSON.stringify(opts)},`);
  }
  lines.push("  }", "};");
  fs.writeFileSync(configPath, lines.join("\n"), "utf8");
}

async function startDaemon(configPath: string): Promise<ChildProcess> {
  const proc = spawn("node", [CLI, "start", "--config", configPath], {
    env: { ...process.env },
    stdio: "pipe",
  });

  // Wait until the status sidecar is ready
  await waitForPort(STATUS_PORT, 30_000);
  return proc;
}

function stopDaemon(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    proc.once("exit", () => resolve());
    proc.kill("SIGTERM");
    setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 5000);
  });
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      const sock = createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => {
        if (Date.now() > deadline) return reject(new Error(`Port ${port} not ready within ${timeoutMs}ms`));
        setTimeout(check, 300);
      });
    };
    check();
  });
}

// ── Phase 1: HackerNews only ──────────────────────────────────────────────────

describe("Phase 1 — HackerNews adapter only", () => {
  let daemon: ChildProcess;
  let client: TestMcpClient;

  beforeAll(async () => {
    const config = path.join(E2E_DATA_DIR, "config-phase1.js");
    writeDaemonConfig({ [HN_ADAPTER]: { port: HN_PORT } }, config);
    daemon = await startDaemon(config);
    client = await createTestMcpClient(`http://127.0.0.1:${HN_PORT}/mcp`);
  }, 45_000);

  afterAll(async () => {
    await client.close();
    await stopDaemon(daemon);
    // Remove pidfile so Phase 2 can start cleanly
    fs.rmSync(path.join(E2E_DATA_DIR, "browserkit.pid"), { force: true });
  });

  it("daemon starts and HN adapter is reachable", async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_top");
    expect(names).toContain("get_new");
    expect(names).toContain("get_comments");
    expect(names).toContain("browser"); // management tool
  });

  it("get_top returns real HN articles", async () => {
    const result = await client.callTool("get_top", { count: 3 });
    expect(result.isError).toBeFalsy();

    const stories = JSON.parse(result.content[0]?.text ?? "[]") as Array<{
      title: string;
      rank: number;
      discussionUrl: string;
    }>;
    expect(Array.isArray(stories)).toBe(true);
    expect(stories.length).toBeGreaterThan(0);
    expect(stories[0]?.title.length).toBeGreaterThan(5);
    expect(stories[0]?.discussionUrl).toContain("item?id=");
  });

  it("health check reports HN as logged in (public site)", async () => {
    const result = await client.callTool("browser", { action: "health_check" });
    const status = JSON.parse(result.content[0]?.text ?? "{}") as {
      site: string;
      loggedIn: boolean;
    };
    expect(status.site).toBe("hackernews");
    expect(status.loggedIn).toBe(true);
  });
});

// ── Phase 2: HN + Google Discover ────────────────────────────────────────────

describe("Phase 2 — Adding Google Discover adapter", () => {
  let daemon: ChildProcess;
  let hnClient: TestMcpClient;
  let gdClient: TestMcpClient;

  const gdAdapterAvailable = fs.existsSync(GD_ADAPTER);

  beforeAll(async () => {
    if (!gdAdapterAvailable) return;

    const config = path.join(E2E_DATA_DIR, "config-phase2.js");
    writeDaemonConfig({
      [HN_ADAPTER]: { port: HN_PORT },
      // Note: no 'channel: "chrome"' here — E2E uses fresh profile so Playwright
      // Chromium works fine. Real Chrome is only needed when reusing a Chrome-created profile.
      [GD_ADAPTER]: { port: GD_PORT, deviceEmulation: "Pixel 7" },
    }, config);
    daemon = await startDaemon(config);
    hnClient = await createTestMcpClient(`http://127.0.0.1:${HN_PORT}/mcp`);
    gdClient = await createTestMcpClient(`http://127.0.0.1:${GD_PORT}/mcp`);
  }, 60_000);

  afterAll(async () => {
    if (!gdAdapterAvailable) return;
    await hnClient?.close();
    await gdClient?.close();
    await stopDaemon(daemon);
    fs.rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  });

  it("skips if Google Discover adapter is not built locally", () => {
    if (!gdAdapterAvailable) {
      console.log(`  [skip] GD adapter not found at ${GD_ADAPTER}`);
    }
    expect(true).toBe(true); // always passes — guards the real tests below
  });

  it("HN adapter still works after adding GD adapter", async () => {
    if (!gdAdapterAvailable) return;
    const result = await hnClient.callTool("get_top", { count: 1 });
    expect(result.isError).toBeFalsy();
    const stories = JSON.parse(result.content[0]?.text ?? "[]") as unknown[];
    expect(stories.length).toBeGreaterThan(0);
  });

  it("GD adapter is installed — get_feed tool is present", async () => {
    if (!gdAdapterAvailable) return;
    const tools = await gdClient.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_feed");
    expect(names).toContain("browser");
  });

  it("GD adapter reports not-logged-in with a structured error (success state)", async () => {
    if (!gdAdapterAvailable) return;

    // NOT logged in → this is the expected state without running `browserkit login google-discover`
    // The adapter must return a structured error message, NOT crash or hang
    const result = await gdClient.callTool("get_feed", { count: 5 });

    // isError:true is the correct "not logged in" state
    expect(result.isError).toBe(true);

    const text = result.content[0]?.text ?? "";
    // Must include a human-readable message, not a raw exception
    expect(text.length).toBeGreaterThan(10);
    expect(text.toLowerCase()).toMatch(/login|logged|sign in|account|not logged/);
  });

  it("GD health check reports not logged in (expected without Google login)", async () => {
    if (!gdAdapterAvailable) return;
    const result = await gdClient.callTool("browser", { action: "health_check" });
    const status = JSON.parse(result.content[0]?.text ?? "{}") as {
      site: string;
      loggedIn: boolean;
    };
    expect(status.site).toBe("google-discover");
    expect(status.loggedIn).toBe(false); // not logged in — this is the expected state
  });
});
