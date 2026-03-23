#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { startServer } from "./server.js";
import { SessionManager, getDefaultDataDir } from "./session-manager.js";
import { runLoginCommand } from "./human-handoff.js";import { createAdapter } from "./create-adapter.js";
import type { FrameworkConfig, DaemonStatus, AdapterStatus } from "./types.js";
import { getLogger } from "./logger.js";

const log = getLogger("cli");

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "start":
      return cmdStart(args);
    case "login":
      return cmdLogin(args);
    case "status":
      return cmdStatus(args);
    case "config":
      return cmdConfig(args);
    case "create-adapter": {
      const name = args[0];
      if (!name) {
        console.error("Usage: browserkit create-adapter <name>");
        process.exit(1);
      }
      createAdapter(name);
      return;
    }
    default:
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

// ─── start ───────────────────────────────────────────────────────────────────

async function cmdStart(args: string[]): Promise<void> {
  const config = await resolveConfig(args);
  const pkg = readPackageVersion();

  const handle = await startServer(config);
  const status = await handle.getStatus();

  printBanner(pkg, status.adapters, config.host ?? "127.0.0.1");

  const notLoggedIn = status.adapters.filter((a) => !a.loggedIn);
  if (notLoggedIn.length > 0) {
    console.log(
      `\nRun: browserkit login ${notLoggedIn.map((a) => a.site).join(" | ")}\n`
    );
  }

  // Keep running until signal
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });

  console.log("\nShutting down…");
  await handle.stop();
}

// ─── login ───────────────────────────────────────────────────────────────────

async function cmdLogin(args: string[]): Promise<void> {
  const site = args[0];
  if (!site) {
    console.error("Usage: browserkit login <site>");
    process.exit(1);
  }

  const config = await resolveConfig(args.slice(1));
  const adapterEntry = Object.entries(config.adapters).find(async ([pkg]) => {
    try {
      const mod = await import(pkg);
      return (mod.default ?? mod)?.site === site;
    } catch {
      return false;
    }
  });

  // Load all adapters and find the one matching site
  let targetAdapter = null;
  for (const [pkg, adapterConfig] of Object.entries(config.adapters)) {
    try {
      const mod = await import(pkg);
      const adapter = mod.default ?? mod;
      if (adapter?.site === site) {
        targetAdapter = { adapter, adapterConfig };
        break;
      }
    } catch {
      continue;
    }
  }

  if (!targetAdapter) {
    console.error(`No adapter found for site "${site}". Is it installed and listed in config?`);
    process.exit(1);
  }

  const { adapter, adapterConfig } = targetAdapter;
  const sessionManager = new SessionManager();
  const sessionConfig = {
    site: adapter.site,
    domain: adapter.domain,
    authStrategy: adapterConfig.authStrategy ?? "persistent",
    profileDir: adapter.site,
    cdpUrl: adapterConfig.cdpUrl,
  };

  // Detect if the daemon is already running (check pidfile)
  const { existsSync, readFileSync } = await import("node:fs");
  const pidfilePath = `${sessionManager.getDataDir()}/browserkit.pid`;
  let serverIsRunning = false;
  if (existsSync(pidfilePath)) {
    const pid = parseInt(readFileSync(pidfilePath, "utf8").trim(), 10);
    if (!isNaN(pid) && pid !== process.pid) {
      try { process.kill(pid, 0); serverIsRunning = true; } catch { /* stale */ }
    }
  }

  if (serverIsRunning) {
    console.log(`\n  Daemon is running — login uses a temporary browser (no downtime).`);
  }

  const result = await runLoginCommand(sessionManager, sessionConfig, adapter, serverIsRunning, { timeoutMs: 180_000 });

  if (result.outcome === "success") {
    console.log(`  ✓ Logged in to ${adapter.domain} (${Math.round(result.durationMs / 1000)}s)`);
  } else {
    console.error(`  Login timed out for ${adapter.domain}`);
    process.exit(1);
  }

  await sessionManager.closeAll();
}

// ─── status ──────────────────────────────────────────────────────────────────

async function cmdStatus(args: string[]): Promise<void> {
  const config = await resolveConfig(args);
  const host = config.host ?? "127.0.0.1";
  const statusPort = (config.basePort ?? 3847) - 1;

  try {
    const status = await fetchStatus(host, statusPort);
    printStatus(status);
  } catch {
    console.error(`browserkit is not running (could not reach http://${host}:${statusPort}/status)`);
    process.exit(1);
  }
}

function fetchStatus(host: string, port: number): Promise<DaemonStatus> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${host}:${port}/status`, (res) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data) as DaemonStatus);
        } catch {
          reject(new Error("Invalid status response"));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(3000, () => reject(new Error("Status request timed out")));
  });
}

function printStatus(status: DaemonStatus): void {
  const uptime = formatUptime(status.uptimeMs);
  console.log(`\n  PID: ${status.pid}  (running for ${uptime})\n`);
  const col = (s: string, w: number) => s.padEnd(w);
  console.log(
    `  ${col("Adapter", 14)}${col("Port", 7)}${col("Auth", 14)}Last tool call`
  );
  console.log(`  ${"-".repeat(55)}`);
  for (const a of status.adapters) {
    const auth = a.loggedIn ? "logged in" : "not logged in";
    const last = a.lastCallAt
      ? `${formatRelativeTime(new Date(a.lastCallAt).getTime())} (${a.lastTool ?? ""})`
      : "never";
    console.log(`  ${col(a.site, 14)}${col(String(a.port), 7)}${col(auth, 14)}${last}`);
  }
  console.log();
}

// ─── config cursor ────────────────────────────────────────────────────────────

async function cmdConfig(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub !== "cursor") {
    console.error("Usage: browserkit config cursor");
    process.exit(1);
  }
  const config = await resolveConfig(args.slice(1));
  const host = config.host ?? "127.0.0.1";
  let port = config.basePort ?? 3847;

  const mcpServers: Record<string, { url: string }> = {};
  for (const [pkg, adapterConfig] of Object.entries(config.adapters)) {
    let site: string;
    try {
      const mod = await import(pkg);
      site = (mod.default ?? mod)?.site ?? pkg;
    } catch {
      site = pkg;
    }
    const adapterPort = adapterConfig.port ?? port++;
    mcpServers[`browserkit-${site}`] = { url: `http://${host}:${adapterPort}/mcp` };
  }

  console.log("\nAdd this to your Cursor MCP settings:\n");
  console.log(JSON.stringify({ mcpServers }, null, 2));
  console.log();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveConfig(args: string[]): Promise<FrameworkConfig> {
  // Check for --config flag
  const configIdx = args.indexOf("--config");
  if (configIdx !== -1 && args[configIdx + 1]) {
    const configPath = path.resolve(args[configIdx + 1]!);
    return loadConfigFile(configPath);
  }

  // Check for browserkit.config.ts in cwd
  const cwdConfig = path.join(process.cwd(), "browserkit.config.ts");
  const cwdConfigJs = path.join(process.cwd(), "browserkit.config.js");
  if (fs.existsSync(cwdConfig)) return loadConfigFile(cwdConfig);
  if (fs.existsSync(cwdConfigJs)) return loadConfigFile(cwdConfigJs);

  // Build from --adapter flags
  const adapterPkgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--adapter" && args[i + 1]) {
      adapterPkgs.push(args[i + 1]!);
      i++;
    }
  }

  const portArg = args[args.indexOf("--port") + 1];
  const basePort = portArg ? parseInt(portArg, 10) : 3847;

  const adapters: FrameworkConfig["adapters"] = {};
  for (const pkg of adapterPkgs) {
    adapters[pkg] = {};
  }

  return { adapters, basePort };
}

async function loadConfigFile(filePath: string): Promise<FrameworkConfig> {
  const mod = await import(pathToFileURL(filePath).href);
  const config = mod.default ?? mod;
  if (!config?.adapters) {
    throw new Error(`Config file "${filePath}" must export a FrameworkConfig with an adapters field`);
  }
  return config as FrameworkConfig;
}

function printBanner(version: string, adapters: AdapterStatus[], host: string): void {
  console.log(`\n  browserkit ${version}\n`);
  const col = (s: string, w: number) => s.padEnd(w);
  console.log(`  ${col("Adapter", 14)}${col("Port", 7)}${col("URL", 38)}Auth`);
  console.log(`  ${"-".repeat(70)}`);
  for (const a of adapters) {
    const url = `http://${host}:${a.port}/mcp`;
    const auth = a.loggedIn ? "logged in" : "not logged in";
    console.log(`  ${col(a.site, 14)}${col(String(a.port), 7)}${col(url, 38)}${auth}`);
  }
  console.log();
}

function printUsage(): void {
  console.log(`
Usage: browserkit <command> [options]

Commands:
  start                 Start the browserkit daemon
  login <site>          Log in to a site
  status                Show daemon status
  config cursor         Generate Cursor MCP settings JSON
  create-adapter <name> Scaffold a new standalone adapter package

Options (start):
  --adapter <pkg>    Add an adapter by npm package name (repeatable)
  --port <n>         Base port for auto-assignment (default: 3847)
  --config <path>    Path to browserkit.config.ts

Examples:
  browserkit start --adapter @browserkit/adapter-linkedin
  browserkit login linkedin
  browserkit status
  browserkit config cursor
  browserkit create-adapter my-site
`);
}

function readPackageVersion(): string {
  try {
    const pkgPath = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version: string };
    return `v${pkg.version}`;
  } catch {
    return "v?";
  }
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
