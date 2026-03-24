import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import type { Page, BrowserContext, Cookie } from "patchright";
import { chromium, devices } from "patchright";
import { getLogger } from "./logger.js";
import type { SessionConfig, SiteAdapter, BrowserMode } from "./types.js";

const log = getLogger("session-manager");

interface SessionEntry {
  context: BrowserContext;
  page: Page;
  config: SessionConfig;
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

  /** Returns a ready headless Page. Launches a new browser if not already running. */
  async getPage(config: SessionConfig): Promise<Page> {
    const existing = this.sessions.get(config.site);
    if (existing) return existing.page;
    return this.launchSession(config, "headless");
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
   */
  async setMode(config: SessionConfig, mode: BrowserMode, slowMoMs?: number): Promise<Page> {
    const existing = this.sessions.get(config.site);
    if (existing?.mode === mode && existing?.slowMoMs === slowMoMs) {
      return existing.page;
    }
    await this.closeSite(config.site);
    return this.launchSession(config, mode, slowMoMs);
  }

  getCurrentMode(site: string): BrowserMode {
    return this.sessions.get(site)?.mode ?? "headless";
  }

  /** Inject fresh auth cookies + localStorage into the running headless context. */
  async injectStorageState(
    site: string,
    cookies: Cookie[],
    origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>
  ): Promise<void> {
    const entry = this.sessions.get(site);
    if (!entry) { log.warn({ site }, "injectStorageState: no running session"); return; }
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
    try { await entry.context.close(); } catch (err) { log.warn({ site, err }, "close error"); }
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

  // ── Private ──────────────────────────────────────────────────────────────

  private async launchSession(
    config: SessionConfig,
    mode: BrowserMode,
    slowMoMs?: number
  ): Promise<Page> {
    const headed = mode !== "headless";
    const slowMo = headed ? (slowMoMs ?? undefined) : undefined;
    const debugArgs = config.debugPort ? [`--remote-debugging-port=${config.debugPort}`] : [];
    log.info({ site: config.site, strategy: config.authStrategy, mode, slowMo, debugPort: config.debugPort }, "launching browser");

    let context: BrowserContext;

    if (config.authStrategy === "cdp-attach") {
      if (!config.cdpUrl) throw new Error(`cdp-attach requires cdpUrl for "${config.site}"`);
      const browser = await chromium.connectOverCDP(config.cdpUrl);
      const contexts = browser.contexts();
      context = contexts[0] ?? (await browser.newContext());
    } else if (config.authStrategy === "storage-state") {
      const stateFile = path.join(this.dataDir, "profiles", config.site, "storage-state.json");
      const browser = await chromium.launch({ headless: !headed, slowMo, args: debugArgs });
      context = await browser.newContext(fs.existsSync(stateFile) ? { storageState: stateFile } : {});
    } else {
      // persistent (default)
      const profileDir = this.getProfileDir(config.site);
      fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
      // Apply Playwright device emulation preset if configured (e.g. "Pixel 5" for Google Discover)
      const devicePreset = config.deviceEmulation ? (devices[config.deviceEmulation] ?? {}) : {};
      // Anti-automation flags — removes navigator.webdriver and other signals that trigger
      // bot-detection on sites like Google that refuse to sign in to "automated" browsers.
      const antiAutomationArgs = [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
      ];
      context = await chromium.launchPersistentContext(profileDir, {
        headless: !headed,
        slowMo,
        args: [...debugArgs, ...antiAutomationArgs],
        ...(config.channel ? { channel: config.channel } : {}),
        ...devicePreset,
      });
    }

    const page = await context.newPage();
    this.sessions.set(config.site, { context, page, config, mode, slowMoMs, debugPort: config.debugPort });
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
