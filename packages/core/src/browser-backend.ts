import path from "node:path";
import fs from "node:fs";
import type { Page, BrowserContext } from "patchright";
import { chromium, devices } from "patchright";
import type { SessionConfig, BrowserMode } from "./types.js";
import { getLogger } from "./logger.js";

const log = getLogger("browser-backend");

// ─── Interface ────────────────────────────────────────────────────────────────

export interface ConnectResult {
  context: BrowserContext;
  page: Page;
}

/**
 * Encapsulates the per-strategy browser connection lifecycle.
 *
 * Each auth strategy is a self-contained implementation of this interface.
 * SessionManager is strategy-agnostic — it only calls backend properties and
 * connect(). Adding a new strategy means adding one class and one factory case.
 */
export interface BrowserBackend {
  /** Launch or connect and return a ready context + first page. */
  connect(mode: BrowserMode, slowMoMs?: number): Promise<ConnectResult>;

  /**
   * If true, SessionManager.closeSite() calls context.close().
   * False for extension strategy — the user's Chrome must not be closed.
   */
  readonly ownsContext: boolean;

  /**
   * If false, SessionManager.setMode() is a no-op.
   * False for extension strategy — the user's Chrome is always visible.
   */
  readonly supportsModeSwitch: boolean;

  /**
   * If false, SessionManager.injectStorageState() returns early.
   * False for extension strategy — Chrome manages its own auth state.
   */
  readonly supportsStorageStateInjection: boolean;

  /**
   * If false, handleAuthFailure() returns false without opening a headed browser.
   * False for extension strategy — no headless session to recover.
   */
  readonly supportsAutoReauth: boolean;

  /**
   * The BrowserMode to report for status/getCurrentMode().
   * Extension always reports "watch" (always visible); others return storedMode.
   */
  effectiveMode(storedMode: BrowserMode): BrowserMode;
}

// ─── PersistentBackend ────────────────────────────────────────────────────────

/**
 * Default strategy: `launchPersistentContext` on a per-site profile directory.
 * Supports CloakBrowser, device emulation, anti-automation args, COOP strip,
 * pointer-media patch, and sticky session cookie persistence.
 */
class PersistentBackend implements BrowserBackend {
  readonly ownsContext = true;
  readonly supportsModeSwitch = true;
  readonly supportsStorageStateInjection = true;
  readonly supportsAutoReauth = true;

  constructor(
    private readonly config: SessionConfig,
    private readonly dataDir: string
  ) {}

  effectiveMode(storedMode: BrowserMode): BrowserMode {
    return storedMode;
  }

  async connect(mode: BrowserMode, slowMoMs?: number): Promise<ConnectResult> {
    const headed = mode !== "headless";
    const slowMo = headed ? (slowMoMs ?? undefined) : undefined;
    const debugArgs = this.config.debugPort
      ? [`--remote-debugging-port=${this.config.debugPort}`]
      : [];

    const profileDir = path.join(this.dataDir, "profiles", this.config.site);
    fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });

    // Apply Playwright device emulation preset if configured (e.g. "Pixel 5" for Google Discover)
    const devicePreset = this.config.deviceEmulation
      ? (devices[this.config.deviceEmulation] ?? {})
      : {};

    // Anti-automation flags — removes navigator.webdriver and other signals that trigger
    // bot-detection on sites like Google that refuse to sign in to "automated" browsers.
    const antiAutomationArgs = [
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      // Declare a primary pointer (mouse) and available pointer types at the Blink level.
      // Without this, headless Chrome reports pointer type = none, which causes CSS
      // (pointer: fine) to return false — a key DataDome headless detection signal.
      // Type 4 = kFine (mouse), type 1 = kNone, type 2 = kCoarse (touch).
      "--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2",
      // Set a realistic window size so screen.width/height are non-zero.
      "--window-size=1920,1080",
    ];

    let context: BrowserContext;

    if (this.config.antiDetection?.useCloakBrowser) {
      // CloakBrowser: stealth Chromium with 33 C++-level patches for DataDome.
      // Uses its own Chromium binary — cannot share profiles with real Chrome.
      // Profile dir is sibling to the standard profile: <site>-cloak
      // Lazy import — only loaded when useCloakBrowser is configured, so adapters
      // that don't need it never trigger the ~140MB binary download on install.
      const { launchPersistentContext: cloakLaunch } = await import("cloakbrowser");
      const cloakProfileDir = path.join(this.dataDir, "profiles", `${this.config.site}-cloak`);
      fs.mkdirSync(cloakProfileDir, { recursive: true, mode: 0o700 });
      log.info({ site: this.config.site, cloakProfileDir }, "launching CloakBrowser for DataDome bypass");
      context = await cloakLaunch({
        userDataDir: cloakProfileDir,
        headless: !headed,
        humanize: true,
        args: antiAutomationArgs,
      }) as unknown as BrowserContext;
    } else {
      context = await chromium.launchPersistentContext(profileDir, {
        headless: !headed,
        slowMo,
        // viewport: null tells Chrome to use its natural window size rather than
        // Playwright's default 1280x720 — the fixed Playwright viewport is a known
        // bot-detection signal (e.g. DataDome's c.js checks for it).
        // Device presets override this with the device's specific viewport.
        viewport: null,
        args: [...debugArgs, ...antiAutomationArgs],
        ...(this.config.channel ? { channel: this.config.channel } : {}),
        ...devicePreset,
      });
    }

    // ── Anti-detection patches ─────────────────────────────────────────────────
    //
    // stripCOOP: strip Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy
    //   response headers. Prevents Chromium from restarting its renderer process on
    //   COOP-protected pages, which would reset --blink-settings pointer emulation.
    //
    // patchPointerMedia: override window.matchMedia so (pointer:fine) = true in headless.
    //   DataDome's c.js challenge script reads this signal to classify headless Chrome as a bot.
    if (this.config.antiDetection?.stripCOOP) {
      await context.route("**/*", async (route) => {
        try {
          const response = await route.fetch();
          const headers = { ...response.headers() };
          delete headers["cross-origin-opener-policy"];
          delete headers["cross-origin-embedder-policy"];
          await route.fulfill({ response, headers });
        } catch {
          await route.continue();
        }
      });
    }
    if (this.config.antiDetection?.patchPointerMedia) {
      await context.addInitScript(() => {
        // 1. Patch window.matchMedia so (pointer:fine) returns true in headless.
        //    DataDome's c.js challenge reads this to classify headless Chrome as a bot.
        const orig = window.matchMedia.bind(window);
        window.matchMedia = (query: string): MediaQueryList => {
          const mql = orig(query);
          const q = query.replace(/\s+/g, "").toLowerCase();
          if (q.includes("pointer:fine"))   return Object.assign(Object.create(mql), { matches: true  });
          if (q.includes("pointer:none"))   return Object.assign(Object.create(mql), { matches: false });
          if (q.includes("pointer:coarse")) return Object.assign(Object.create(mql), { matches: false });
          return mql;
        };

        // 2. Patch window.outerHeight / outerWidth to simulate a real browser toolbar.
        //    In headless Chrome, outerHeight === innerHeight (no toolbar rendered).
        //    DataDome's c.js checks this: zero toolbar height = headless signal.
        //    Real Chrome on macOS has ~74px of toolbar (address bar + tabs).
        const TOOLBAR_HEIGHT = 74;
        try {
          Object.defineProperty(window, "outerHeight", {
            get: () => window.innerHeight + TOOLBAR_HEIGHT,
            configurable: true,
          });
          Object.defineProperty(window, "outerWidth", {
            get: () => window.innerWidth,
            configurable: true,
          });
        } catch { /* ignore — may already be non-configurable */ }
      });
    }

    // ── Restore sticky session cookies ────────────────────────────────────────
    // DataDome and similar protection systems use session cookies (no expiry) that
    // Chrome doesn't persist to disk. We save them manually before closing and
    // restore them here so headless launches don't start from scratch every time.
    if (this.config.antiDetection?.saveCookieDomains?.length) {
      const savePath = path.join(this.dataDir, "profiles", this.config.site, "saved-session-cookies.json");
      if (fs.existsSync(savePath)) {
        try {
          const saved = JSON.parse(fs.readFileSync(savePath, "utf8")) as Array<Record<string, unknown>>;
          if (saved.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await context.addCookies(saved as any);
            log.info({ site: this.config.site, cookieCount: saved.length }, "restored sticky session cookies");
          }
        } catch (err) {
          log.warn({ site: this.config.site, err }, "failed to restore sticky session cookies");
        }
      }
    }

    const page = await context.newPage();
    return { context, page };
  }
}

// ─── StorageStateBackend ──────────────────────────────────────────────────────

/**
 * Launches a fresh Chromium and loads auth state from a JSON storage-state file.
 * Useful for ephemeral contexts (e.g. CI) where persistent profiles are not desired.
 */
class StorageStateBackend implements BrowserBackend {
  readonly ownsContext = true;
  readonly supportsModeSwitch = true;
  readonly supportsStorageStateInjection = true;
  readonly supportsAutoReauth = true;

  constructor(
    private readonly config: SessionConfig,
    private readonly dataDir: string
  ) {}

  effectiveMode(storedMode: BrowserMode): BrowserMode {
    return storedMode;
  }

  async connect(mode: BrowserMode, slowMoMs?: number): Promise<ConnectResult> {
    const headed = mode !== "headless";
    const slowMo = headed ? (slowMoMs ?? undefined) : undefined;
    const debugArgs = this.config.debugPort
      ? [`--remote-debugging-port=${this.config.debugPort}`]
      : [];
    const stateFile = path.join(this.dataDir, "profiles", this.config.site, "storage-state.json");
    const browser = await chromium.launch({ headless: !headed, slowMo, args: debugArgs });
    const context = await browser.newContext(
      fs.existsSync(stateFile) ? { storageState: stateFile } : {}
    );
    const page = await context.newPage();
    return { context, page };
  }
}

// ─── CdpAttachBackend ─────────────────────────────────────────────────────────

/**
 * Attaches to a running Chrome instance via the Chrome DevTools Protocol (CDP).
 * Useful when the user runs Chrome with --remote-debugging-port and wants
 * the adapter to operate in that already-authenticated session.
 */
class CdpAttachBackend implements BrowserBackend {
  readonly ownsContext = true;
  readonly supportsModeSwitch = true;
  readonly supportsStorageStateInjection = true;
  readonly supportsAutoReauth = true;

  constructor(private readonly config: SessionConfig) {}

  effectiveMode(storedMode: BrowserMode): BrowserMode {
    return storedMode;
  }

  async connect(_mode: BrowserMode, _slowMoMs?: number): Promise<ConnectResult> {
    if (!this.config.cdpUrl) {
      throw new Error(`cdp-attach requires cdpUrl for "${this.config.site}"`);
    }
    const browser = await chromium.connectOverCDP(this.config.cdpUrl);
    const contexts = browser.contexts();
    const context = contexts[0] ?? (await browser.newContext());
    const page = await context.newPage();
    return { context, page };
  }
}

// ─── ExtensionBackend ─────────────────────────────────────────────────────────

/**
 * Connects to the user's real Chrome through Playwriter's CDP relay.
 * Playwriter runs a local WebSocket relay server; the Chrome extension forwards
 * CDP commands to an authenticated tab via chrome.debugger.
 *
 * Requires:
 *   - `playwriter` npm package: pnpm add playwriter
 *   - Playwriter Chrome extension: https://github.com/remorses/playwriter
 *
 * Key behavioral differences from other backends:
 *   - ownsContext: false — must NOT close the user's Chrome on disconnect
 *   - supportsModeSwitch: false — the user's Chrome is always visible
 *   - supportsStorageStateInjection: false — Chrome manages its own auth
 *   - supportsAutoReauth: false — no headless session to recover
 *   - effectiveMode: always returns "watch" (always visible)
 */
class ExtensionBackend implements BrowserBackend {
  readonly ownsContext = false;
  readonly supportsModeSwitch = false;
  readonly supportsStorageStateInjection = false;
  readonly supportsAutoReauth = false;

  constructor(private readonly config: SessionConfig) {}

  effectiveMode(_storedMode: BrowserMode): BrowserMode {
    return "watch";
  }

  async connect(_mode: BrowserMode, _slowMoMs?: number): Promise<ConnectResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pw: any;
    try {
      pw = await import("playwriter");
    } catch {
      throw new Error(
        `authStrategy "extension" requires the "playwriter" package.\n` +
        `Install it with: pnpm add playwriter\n` +
        `Then install the Playwriter Chrome extension: https://github.com/remorses/playwriter`
      );
    }
    const port = this.config.extensionPort ?? 19988;
    // startPlayWriterCDPRelayServer is idempotent — checks if relay is already on the port
    await (pw.startPlayWriterCDPRelayServer as (opts: { port: number; host: string }) => Promise<unknown>)({
      port,
      host: "127.0.0.1",
    });
    const relayUrl = (pw.getCdpUrl as (opts: { port: number }) => string)({ port });
    log.info({ site: this.config.site, relayUrl }, "connecting to Playwriter CDP relay");
    const browser = await chromium.connectOverCDP(relayUrl);
    const contexts = browser.contexts();
    const context = contexts[0] ?? (await browser.newContext());
    const page = await context.newPage();
    return { context, page };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates the appropriate BrowserBackend for the given SessionConfig.
 * This is the single place where `authStrategy` is inspected — all other
 * code is strategy-agnostic and uses the backend interface.
 */
export function createBackend(config: SessionConfig, dataDir: string): BrowserBackend {
  switch (config.authStrategy) {
    case "storage-state": return new StorageStateBackend(config, dataDir);
    case "cdp-attach":    return new CdpAttachBackend(config);
    case "extension":     return new ExtensionBackend(config);
    default:              return new PersistentBackend(config, dataDir);
  }
}
