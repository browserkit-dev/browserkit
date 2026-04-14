import type { Page } from "patchright";
import type { ZodTypeAny } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

// ─── Browser mode ────────────────────────────────────────────────────────────

/**
 * headless: fully invisible (default, normal operation)
 * watch:    visible browser, automation continues running
 * paused:   visible browser, tool calls queued — user has manual control
 */
export type BrowserMode = "headless" | "watch" | "paused";

export interface ModeState {
  mode: BrowserMode;
  /** ms delay between Playwright actions (watch mode only) */
  slowMoMs?: number | undefined;
}

// ─── Tool result content ────────────────────────────────────────────────────

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: "image/png" };

/**
 * A compact reference to an entity mentioned in the tool result.
 * Adapters include this alongside the main content so AI agents can traverse
 * links without parsing raw text.
 */
export interface ToolReference {
  /** Entity type, e.g. "article", "profile", "company", "comment" */
  kind: string;
  /** Absolute URL for the referenced entity */
  url: string;
  /** Short human-readable label (e.g. article title, person name) */
  text?: string | undefined;
  /** Additional context (e.g. the section of a page this appears in) */
  context?: string | undefined;
}

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  /** Optional structured references extracted from the result — compact link metadata. */
  references?: ToolReference[] | undefined;
}

// ─── Tool definition ────────────────────────────────────────────────────────

export interface ToolDefinition<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  /**
   * Optional MCP tool annotations. These are hints to AI agents:
   * - `title`: human-readable display name (shown in Claude Desktop, MCP inspector)
   * - `readOnlyHint`: true = tool does not modify state; agents can call it freely
   * - `openWorldHint`: true = tool may interact with external services (always true for web adapters)
   * - `destructiveHint`: true = side effects are irreversible (e.g. posting, deleting)
   */
  annotations?: ToolAnnotations | undefined;
  handler(page: Page, input: TInput): Promise<ToolResult>;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export type AuthStrategy = "persistent" | "storage-state" | "cdp-attach" | "extension";

/**
 * Browser session fields shared by both SessionConfig and AdapterConfig.
 * Add new browser-launch options here once; both types inherit automatically.
 */
export interface BrowserLaunchFields {
  authStrategy?: AuthStrategy | undefined;
  cdpUrl?: string | undefined;
  /**
   * Port for Chrome's remote debugging protocol.
   * When set, the browser launches with `--remote-debugging-port=debugPort`.
   * External agents can then attach with: chromium.connectOverCDP("http://127.0.0.1:debugPort")
   * Recommended: set to adapterPort + 1000 (e.g. linkedin at 3847 → debugPort 4847)
   */
  debugPort?: number | undefined;
  /**
   * Port for Playwriter's CDP relay server when authStrategy is "extension".
   * Defaults to 19988 (Playwriter's default port).
   * Only used when authStrategy is "extension".
   *
   * Requires:
   *   1. `playwriter` npm package installed: pnpm add playwriter
   *   2. Playwriter Chrome extension installed and active on the target tab
   *
   * @see https://github.com/remorses/playwriter
   */
  extensionPort?: number | undefined;
  /**
   * Playwright device preset name for browser emulation (e.g. "Pixel 5", "iPhone 13").
   * When set, the persistent browser context launches with the device's viewport,
   * user agent, and touch settings. Useful for sites that only serve certain content
   * on mobile (e.g. Google Discover).
   * Full list: https://playwright.dev/docs/emulation#devices
   */
  deviceEmulation?: string | undefined;
  /**
   * Browser channel to use, e.g. "chrome" to use the system-installed Google Chrome
   * instead of Playwright's bundled Chromium. Required when the persistent profile
   * was first created with real Chrome (e.g. via the login script), because Chrome
   * and Playwright's Chromium write incompatible profile formats and mixing them
   * causes crashes when switching to headed (watch/pause) mode.
   * Accepts: "chrome" | "chrome-beta" | "msedge" | undefined (default: Playwright Chromium)
   */
  channel?: string | undefined;
  /**
   * Anti-bot-detection patches for sites using DataDome or similar challenge-based
   * protection (e.g. Booking.com's secure.booking.com).
   *
   * stripCOOP: Strip Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy
   *   response headers via a context-level route interceptor. Prevents Chromium from
   *   restarting its renderer process mid-navigation, which would reset Playwright's
   *   --blink-settings pointer emulation and cause (pointer:fine) to flip to false.
   *
   * patchPointerMedia: Override window.matchMedia in every frame so that
   *   (pointer:fine) returns true in headless. DataDome's challenge script (c.js)
   *   reads this signal to classify headless Chrome as a bot.
   *
   * saveCookieDomains: Domains whose cookies should be saved to disk before the
   *   browser closes and restored on the next launch. Use for session cookies that
   *   DataDome or similar systems set but Chrome doesn't persist natively.
   *   Example: [".booking.com", "captcha-delivery.com"]
   *
   * useCloakBrowser: Use CloakBrowser (stealth Chromium with 33 C++-level patches)
   *   instead of Patchright. Downloads ~140MB on first use, cached at ~/.cloakbrowser/.
   *   Required for sites using DataDome (e.g. Booking.com's secure subdomain).
   *   NOTE: incompatible with channel:"chrome" — uses its own Chromium binary.
   */
  antiDetection?: {
    stripCOOP?: boolean | undefined;
    patchPointerMedia?: boolean | undefined;
    saveCookieDomains?: string[] | undefined;
    useCloakBrowser?: boolean | undefined;
  } | undefined;
}

export interface SessionConfig extends BrowserLaunchFields {
  site: string;
  domain: string;
  /** Required at runtime (defaults to "persistent" when built from AdapterConfig). */
  authStrategy: AuthStrategy;
  profileDir: string;
}

// ─── Adapter config (per-entry in browserkit.config.ts) ────────────────────

export interface AdapterConfig extends BrowserLaunchFields {
  /** Explicit HTTP port for this adapter's MCP server. If omitted, auto-assigned from basePort. */
  port?: number | undefined;
  rateLimit?: { minDelayMs: number } | undefined;
}

// ─── Handoff ─────────────────────────────────────────────────────────────────

export interface HandoffResult {
  outcome: "success" | "timeout" | "cancelled";
  durationMs: number;
}

// ─── Selector report ─────────────────────────────────────────────────────────

export interface SelectorMatch {
  found: boolean;
  count: number;
  sample?: string | undefined;
}

export type SelectorReport = Record<string, SelectorMatch>;

// ─── Auth error taxonomy ──────────────────────────────────────────────────────

/**
 * Discriminated error types for programmatic login failures.
 * Returned in MCP error results so AI agents can reason about the cause.
 */
export type AuthErrorType =
  | "INVALID_PASSWORD"
  | "CHANGE_PASSWORD"
  | "ACCOUNT_BLOCKED"
  | "SESSION_EXPIRED"
  | "TIMEOUT"
  | "GENERIC";

/**
 * Thrown by withLoginFlow (and optionally by adapter tool handlers / isLoggedIn)
 * to surface a typed, actionable login failure to the MCP client.
 */
export class LoginError extends Error {
  constructor(public readonly errorType: AuthErrorType, message: string) {
    super(message);
    this.name = "LoginError";
  }
}

/**
 * Maps login outcomes to URL patterns (strings, regexes, or async predicates)
 * that detect them after form submission. Used by withLoginFlow to classify
 * the post-login page state.
 *
 * @example
 * {
 *   SUCCESS:          [/dashboard/i],
 *   INVALID_PASSWORD: ["https://bank.co.il/login?error=bad-credentials"],
 *   CHANGE_PASSWORD:  [/change-password/i],
 * }
 */
export type PossibleLoginResults = Partial<
  Record<"SUCCESS" | AuthErrorType,
    Array<string | RegExp | ((page: Page) => Promise<boolean>)>>
>;

/**
 * Describes a form-based login flow that the framework can automate.
 * Return this from `SiteAdapter.getLoginOptions()` to opt in to automated login.
 *
 * Credentials belong here — read them from env vars or a secrets file;
 * the framework never stores or inspects credentials itself.
 */
export interface LoginOptions {
  /** URL to navigate to before filling the form. */
  loginUrl: string;
  /** Input fields to fill: CSS selector + the value to type. */
  fields: Array<{ selector: string; value: string }>;
  /** CSS selector of the submit button, or an async function that clicks it. */
  submitButtonSelector: string | (() => Promise<void>);
  /** Map from login outcome → URL/regex/predicate patterns that identify it. */
  possibleResults: PossibleLoginResults;
  /** Optional: wait for the form to be ready before filling (e.g. spinner gone). */
  checkReadiness?: () => Promise<void>;
  /** Optional: action to run before filling fields (e.g. click a "password" tab). */
  preAction?: () => Promise<void>;
  /** Optional: action after submit instead of the default waitForRedirect. */
  postAction?: () => Promise<void>;
  /** Optional: override the User-Agent header for the login page. */
  userAgent?: string;
  /** Navigation lifecycle event to wait for on the initial goto (default: domcontentloaded). */
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
}

// ─── Adapter requirements ────────────────────────────────────────────────────

/**
 * Hints about adapter configuration requirements, surfaced by `browserkit doctor`.
 * These are informational — the framework does not enforce them at startup.
 */
export interface AdapterRequirements {
  /**
   * Adapter login cannot be automated — it requires a headed browser window.
   * (e.g. OAuth flows, SSO, passkey-based logins)
   */
  headedLoginRequired?: boolean | undefined;
  /**
   * Adapter requires channel:"chrome" in AdapterConfig.
   * (e.g. Google-based adapters that reject Playwright's bundled Chromium)
   */
  chromeChannelRequired?: boolean | undefined;
  /**
   * Adapter requires a specific Playwright device emulation preset.
   * (e.g. "Pixel 7" for Google Discover)
   */
  deviceEmulation?: string | undefined;
  /**
   * Adapter requires CloakBrowser for anti-bot-detection.
   * (e.g. sites using DataDome — requires antiDetection.useCloakBrowser: true)
   */
  useCloakBrowser?: boolean | undefined;
}

// ─── SiteAdapter ─────────────────────────────────────────────────────────────

export interface SiteAdapter {
  /** Unique identifier — becomes the MCP server name and log label. */
  readonly site: string;
  /** Domain used to scope the profile directory and match sessions. */
  readonly domain: string;
  /** Full URL to navigate to for the login flow. */
  readonly loginUrl: string;
  /** Minimum delay between consecutive tool calls (protects against rate-limiting). */
  readonly rateLimit?: { minDelayMs: number } | undefined;
  /** Optional: map of named CSS selector strings, used by health_check to report selector health. */
  readonly selectors?: Record<string, string> | undefined;
  /** Return all tools this adapter exposes. */
  tools(): ToolDefinition[];
  /** Return true when the current page is in an authenticated state. */
  isLoggedIn(page: Page): Promise<boolean>;
  /**
   * Optional lifecycle hook called once after the browser page is created,
   * before any tool runs. Use to configure the page at startup:
   *   - page.setExtraHTTPHeaders() for locale or auth headers
   *   - page.route() to block analytics/tracking requests globally
   *   - maskHeadlessUserAgent(page) for bot-detection mitigation
   *
   * Not called again on the same session unless the browser is relaunched.
   */
  preparePage?: (page: Page) => Promise<void>;
  /**
   * Optional: return a LoginOptions descriptor to enable automated form-based login.
   *
   * When present, handleAuthFailure() will attempt to fill and submit the login
   * form automatically before falling back to the human-handoff flow. Adapters
   * that rely on manual login (e.g. OAuth, SSO, passkeys) should leave this
   * undefined — behavior is identical to before.
   *
   * Credentials go inside this function: read them from env vars or a secrets
   * file. The framework never stores or inspects credential values.
   */
  getLoginOptions?: () => LoginOptions;
  /**
   * Minimum @browserkit-dev/core version this adapter requires.
   * Checked at startup by loadAdapter and at definition time by defineAdapter.
   * Set this to the core version you develop and test against.
   * @example "0.2.0"
   */
  readonly minCoreVersion?: string | undefined;
  /**
   * Optional hints about adapter configuration requirements.
   * Not enforced at runtime — surfaced by `browserkit doctor` to help users
   * configure the adapter correctly before starting.
   */
  readonly requirements?: AdapterRequirements | undefined;
}

// ─── Framework config (browserkit.config.ts) ────────────────────────────────

export interface FrameworkConfig {
  /** Hostname to bind all adapter HTTP servers to. Defaults to 127.0.0.1. */
  host?: string | undefined;
  /** Bearer token required for incoming requests. Required when host is not localhost. */
  bearerToken?: string | undefined;
  /** First port to auto-assign. Subsequent adapters get basePort+1, +2, … Defaults to 3847. */
  basePort?: number | undefined;
  /**
   * Custom data directory for profiles, pidfile, and error screenshots.
   * Defaults to the XDG data dir (~/.local/share/browserkit on Linux,
   * ~/Library/Application Support/browserkit on macOS).
   * Override in tests to avoid conflicting with a running daemon.
   */
  dataDir?: string | undefined;
  /**
   * Keys are npm package names (loaded via require(key)).
   * Values are per-adapter configuration overrides.
   */
  adapters: Record<string, AdapterConfig>;
}

// ─── Status ──────────────────────────────────────────────────────────────────

export interface AdapterStatus {
  site: string;
  port: number;
  url: string;
  loggedIn: boolean;
  mode?: BrowserMode | undefined;
  /** Auth strategy in use for this adapter. */
  authStrategy?: AuthStrategy | undefined;
  /** Playwright WS endpoint — attach with chromium.connect(wsEndpoint) for raw access */
  wsEndpoint?: string | null | undefined;
  lastCallAt?: Date | undefined;
  lastTool?: string | undefined;
}

export interface DaemonStatus {
  pid: number;
  startedAt: Date;
  uptimeMs: number;
  adapters: AdapterStatus[];
}
