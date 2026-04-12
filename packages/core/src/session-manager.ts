import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import type { Page, BrowserContext, Cookie } from "patchright";
import { getLogger } from "./logger.js";
import type { SessionConfig, SiteAdapter, BrowserMode } from "./types.js";
import type { BrowserBackend } from "./browser-backend.js";
import { createBackend } from "./browser-backend.js";

const log = getLogger("session-manager");

interface SessionEntry {
  context: BrowserContext;
  page: Page;
  config: SessionConfig;
  backend: BrowserBackend;
  mode: BrowserMode;
  slowMoMs?: number | undefined;
  debugPort?: number | undefined;
}

export class SessionManager {
  private readonly dataDir: string;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly pidfilePath: string;

  constructor(config: { dataDir?: string | undefined } = {}) {
    this.dataDir = config.dataDir ?? getDefaultDataDir();
    this.pidfilePath = path.join(this.dataDir, "browserkit.pid");
    this.ensureDataDir();
    this.acquirePidfile();
    this.registerCleanup();
  }

  /** Returns a ready Page. Launches or connects a new browser if not already running. */
  async getPage(config: SessionConfig, adapter?: SiteAdapter): Promise<Page> {
    const existing = this.sessions.get(config.site);
    if (existing) return existing.page;
    const page = await this.launchSession(config, "headless");
    if (adapter?.preparePage) {
      await adapter.preparePage(page);
    }
    return page;
  }

  async isSessionValid(config: SessionConfig, adapter: SiteAdapter): Promise<boolean> {
    try {
      const page = await this.getPage(config);
      // Navigate to the site if the browser hasn't loaded any page yet,
      // otherwise URL-based isLoggedIn checks always return false.
      if (page.url() === "about:blank" && adapter.loginUrl) {
        await page.goto(adapter.loginUrl, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
      }
      return await adapter.isLoggedIn(page);
    } catch {
      return false;
    }
  }

  /**
   * Switch the browser for a site to a new mode:
   * - headless: fully invisible (default)
   * - watch: visible, automation continues, optional slowMoMs
   * - paused: visible, tool calls queued by caller via LockManager
   *
   * Closes and reopens the browser if the headed state changes.
   * No-op if mode and slowMoMs are already the same.
   * No-op when the backend does not support mode switching (e.g. extension strategy).
   */
  async setMode(config: SessionConfig, mode: BrowserMode, slowMoMs?: number): Promise<Page> {
    const existing = this.sessions.get(config.site);
    if (existing && !existing.backend.supportsModeSwitch) {
      return existing.page;
    }
    if (existing?.mode === mode && existing?.slowMoMs === slowMoMs) {
      return existing.page;
    }
    await this.closeSite(config.site);
    return this.launchSession(config, mode, slowMoMs);
  }

  getCurrentMode(site: string): BrowserMode {
    const entry = this.sessions.get(site);
    if (!entry) return "headless";
    return entry.backend.effectiveMode(entry.mode);
  }

  /** Inject fresh auth cookies + localStorage into the running headless context. */
  async injectStorageState(
    site: string,
    cookies: Cookie[],
    origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>
  ): Promise<void> {
    const entry = this.sessions.get(site);
    if (!entry) { log.warn({ site }, "injectStorageState: no running session"); return; }
    if (!entry.backend.supportsStorageStateInjection) {
      log.debug({ site }, "injectStorageState: skipped — backend does not support storage state injection");
      return;
    }
    await entry.context.clearCookies();
    if (cookies.length > 0) await entry.context.addCookies(cookies);
    for (const { origin, localStorage: items } of origins) {
      try {
        await entry.page.evaluate(
          ({ o, ls }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = globalThis as any;
            if (!w.location?.href?.startsWith(o)) return;
            for (const { name, value } of ls) w.localStorage?.setItem(name, value);
          },
          { o: origin, ls: items }
        );
      } catch { /* page may not be on right origin; cookies are primary */ }
    }
    log.info({ site, cookies: cookies.length }, "storage state injected");
  }

  /** Explicit login command helper: close + reopen headed on same profile dir. */
  async reopenHeaded(config: SessionConfig): Promise<Page> {
    await this.closeSite(config.site);
    return this.launchSession(config, "watch");
  }

  /** Close headed browser, reopen headless. Used after successful login. */
  async reopenHeadless(config: SessionConfig): Promise<Page> {
    await this.closeSite(config.site);
    return this.launchSession(config, "headless");
  }

  async closeSite(site: string): Promise<void> {
    const entry = this.sessions.get(site);
    if (!entry) return;
    // Save sticky session cookies (e.g. DataDome's `datadome` cookie) to disk
    // before closing, so they can be restored on the next headless launch.
    if (entry.config.antiDetection?.saveCookieDomains?.length) {
      try {
        const allCookies = await entry.context.cookies();
        const toSave = allCookies.filter((c) =>
          (entry.config.antiDetection?.saveCookieDomains ?? []).some(
            (d) => c.domain.endsWith(d.replace(/^\./, ""))
          )
        );
        if (toSave.length > 0) {
          const savePath = path.join(this.dataDir, "profiles", site, "saved-session-cookies.json");
          fs.writeFileSync(savePath, JSON.stringify(toSave, null, 2), { mode: 0o600 });
          log.info({ site, cookieCount: toSave.length }, "saved sticky session cookies");
        }
      } catch (err) {
        log.warn({ site, err }, "failed to save sticky session cookies");
      }
    }
    // Only close the context if the backend owns it.
    // Extension backends must not close the user's Chrome.
    if (entry.backend.ownsContext) {
      try { await entry.context.close(); } catch (err) { log.warn({ site, err }, "close error"); }
    }
    this.sessions.delete(site);
  }

  async closeAll(): Promise<void> {
    for (const [site] of [...this.sessions.entries()]) await this.closeSite(site);
    this.releasePidfile();
  }

  getDataDir(): string { return this.dataDir; }
  getProfileDir(site: string): string { return path.join(this.dataDir, "profiles", site); }

  /**
   * Returns the Chrome DevTools Protocol (CDP) URL for the given site's browser.
   * Set via config.debugPort (recommended: adapterMcpPort + 1000).
   *
   * External agents attach with:
   *   const browser = await chromium.connectOverCDP("http://127.0.0.1:debugPort");
   *   const context = browser.contexts()[0]; // already authenticated
   *   const page = context.pages()[0];
   *   // full Playwright API — write any automation
   *
   * Returns null if no debugPort was configured for this site.
   */
  getCdpUrl(site: string): string | null {
    const entry = this.sessions.get(site);
    if (!entry?.debugPort) return null;
    return `http://127.0.0.1:${entry.debugPort}`;
  }

  /**
   * Returns true if the backend for the given site supports automatic re-authentication
   * (i.e. handleAuthFailure can open a headed browser to recover a lapsed session).
   *
   * Returns true by default when no session exists yet — callers may start a login
   * flow before any session is live.
   */
  supportsAutoReauth(site: string): boolean {
    return this.sessions.get(site)?.backend.supportsAutoReauth ?? true;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async launchSession(
    config: SessionConfig,
    mode: BrowserMode,
    slowMoMs?: number
  ): Promise<Page> {
    log.info({ site: config.site, strategy: config.authStrategy, mode, debugPort: config.debugPort }, "launching browser");
    const backend = createBackend(config, this.dataDir);
    const { context, page } = await backend.connect(mode, slowMoMs);
    this.sessions.set(config.site, { context, page, config, backend, mode, slowMoMs, debugPort: config.debugPort });
    log.info({ site: config.site, mode, debugPort: config.debugPort }, "browser session ready");
    return page;
  }

  private ensureDataDir(): void {
    // mode 0o700 = owner-only on Unix. Silently ignored on Windows — no equivalent enforcement.
    for (const sub of ["", "profiles", "errors", "traces"]) {
      fs.mkdirSync(path.join(this.dataDir, sub), { recursive: true, mode: 0o700 });
    }
  }

  private acquirePidfile(): void {
    if (fs.existsSync(this.pidfilePath)) {
      const raw = fs.readFileSync(this.pidfilePath, "utf8").trim();
      const existingPid = parseInt(raw, 10);
      if (!isNaN(existingPid) && isProcessRunning(existingPid)) {
        throw new Error(
          `Another browserkit instance is already running (PID: ${existingPid}).\n` +
            `If this is stale, remove: ${this.pidfilePath}`
        );
      }
    }
    fs.writeFileSync(this.pidfilePath, String(process.pid), "utf8");
  }

  private releasePidfile(): void {
    try { if (fs.existsSync(this.pidfilePath)) fs.unlinkSync(this.pidfilePath); } catch { /* ok */ }
  }

  private registerCleanup(): void {
    const cleanup = () => this.releasePidfile();
    process.once("exit", cleanup);
    process.once("SIGINT", () => { cleanup(); process.exit(0); });
    // SIGTERM is not supported on Windows — guard to avoid a silent no-op
    if (process.platform !== "win32") {
      process.once("SIGTERM", () => { cleanup(); process.exit(0); });
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getDefaultDataDir(): string {
  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", "browserkit");
    case "win32": {
      const appData = process.env["APPDATA"];
      return appData
        ? path.join(appData, "browserkit")
        : path.join(os.homedir(), "AppData", "Roaming", "browserkit");
    }
    default: {
      // Linux + other Unix
      const xdg = process.env["XDG_DATA_HOME"];
      return xdg
        ? path.join(xdg, "browserkit")
        : path.join(os.homedir(), ".local", "share", "browserkit");
    }
  }
}

function isProcessRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// ── autoDiscoverCdpEndpoint ───────────────────────────────────────────────────

/**
 * Scans well-known Chrome user-data directories for a `DevToolsActivePort`
 * file written by a running Chrome process (requires `--remote-debugging-port`).
 *
 * Returns the first valid CDP WebSocket URL found, e.g.
 *   `ws://127.0.0.1:9222/devtools/browser/<id>`
 *
 * Throws if no running Chrome instance is discovered.
 */
export async function autoDiscoverCdpEndpoint(expectedPort?: number): Promise<string> {
  const candidates: string[] = [];

  switch (process.platform) {
    case "darwin":
      candidates.push(
        path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome"),
        path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome Beta"),
        path.join(os.homedir(), "Library", "Application Support", "Chromium"),
        path.join(os.homedir(), "Library", "Application Support", "BraveSoftware", "Brave-Browser"),
      );
      break;
    case "linux":
      candidates.push(
        path.join(os.homedir(), ".config", "google-chrome"),
        path.join(os.homedir(), ".config", "chromium"),
      );
      break;
    case "win32":
      candidates.push(
        path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data"),
        path.join(os.homedir(), "AppData", "Local", "Chromium", "User Data"),
      );
      break;
  }

  for (const dir of candidates) {
    // DevToolsActivePort can appear in the root or inside a profile subfolder
    for (const sub of ["", "Default"]) {
      const file = path.join(dir, sub, "DevToolsActivePort");
      try {
        const contents = fs.readFileSync(file, "utf8");
        const ws = parseDevToolsActivePort(contents, expectedPort);
        if (ws) return ws;
      } catch {
        // file not found or unreadable — keep scanning
      }
    }
  }

  throw new Error(
    "Could not auto-discover a running Chrome instance with remote debugging enabled. " +
    "Launch Chrome with --remote-debugging-port=<port> first, or pass the CDP URL explicitly."
  );
}

function parseDevToolsActivePort(contents: string, expectedPort?: number): string | null {
  const lines = contents.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const port = Number.parseInt(lines[0] ?? "", 10);
  const wsPath = lines[1] ?? "";
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  if (expectedPort !== undefined && port !== expectedPort) return null;
  if (!wsPath.startsWith("/devtools/browser/")) return null;
  return `ws://127.0.0.1:${port}${wsPath}`;
}
