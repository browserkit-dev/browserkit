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

export type AuthStrategy = "persistent" | "storage-state" | "cdp-attach";

export interface SessionConfig {
  site: string;
  domain: string;
  authStrategy: AuthStrategy;
  profileDir: string;
  cdpUrl?: string | undefined;
  /** Chrome remote debugging port. When set, browser launches with --remote-debugging-port=debugPort. */
  debugPort?: number | undefined;
  /**
   * Playwright device preset name for browser emulation (e.g. "Pixel 5", "iPhone 13").
   * Only applies to the "persistent" auth strategy.
   * Use this for adapters that require a mobile user agent (e.g. Google Discover).
   * Full list: https://playwright.dev/docs/emulation#devices
   */
  deviceEmulation?: string | undefined;
  /**
   * Browser channel (e.g. "chrome"). Use when the persistent profile was created with
   * real Chrome — mixing Chrome and Playwright's Chromium on the same profile causes
   * crashes in headed mode.
   */
  channel?: string | undefined;
}

// ─── Adapter config (per-entry in browserkit.config.ts) ────────────────────

export interface AdapterConfig {
  /** Explicit HTTP port for this adapter's MCP server. If omitted, auto-assigned from basePort. */
  port?: number | undefined;
  authStrategy?: AuthStrategy | undefined;
  cdpUrl?: string | undefined;
  rateLimit?: { minDelayMs: number } | undefined;
  /**
   * Port for Chrome's remote debugging protocol.
   * When set, the browser launches with `--remote-debugging-port=debugPort`.
   * External agents can then attach with: chromium.connectOverCDP("http://127.0.0.1:debugPort")
   * Recommended: set to adapterPort + 1000 (e.g. linkedin at 3847 → debugPort 4847)
   */
  debugPort?: number | undefined;
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
