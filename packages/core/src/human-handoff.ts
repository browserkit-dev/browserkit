import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { chromium } from "patchright";
import type { HandoffResult, SiteAdapter, ToolResult } from "./types.js";
import { LoginError } from "./types.js";
import type { SessionManager } from "./session-manager.js";
import type { SessionConfig } from "./types.js";
import { getLogger } from "./logger.js";
import { sleep } from "./waiting.js";
import { withLoginFlow } from "./login-flow.js";

const log = getLogger("human-handoff");

// ─── Immediate error result (tool path) ──────────────────────────────────────

/**
 * Returned to the AI client when re-auth is in progress and the short wait
 * timed out. The AI should inform the user and retry the tool shortly.
 */
export function buildHandoffResult(adapter: SiteAdapter, inProgress: boolean): ToolResult {
  const msg = inProgress
    ? `Login in progress for ${adapter.domain} — a browser window is open. Please complete login and retry this tool.`
    : `Not logged in to ${adapter.domain}. Run \`browserkit login ${adapter.site}\` to authenticate, then retry.`;
  log.info({ site: adapter.site, inProgress }, "returning handoff error to client");
  return { content: [{ type: "text", text: msg }], isError: true };
}

// ─── Background re-auth (mid-session expiry) ─────────────────────────────────

interface BackgroundLogin {
  promise: Promise<boolean>;
  startedAt: number;
}

// Track in-flight background logins per site
const backgroundLogins = new Map<string, BackgroundLogin>();

/**
 * Handle a mid-session auth failure:
 *
 * 1. If a background login is already in flight, wait up to `quickWaitMs` for it to finish.
 * 2. Otherwise start one: open a temporary headed browser, navigate to loginUrl.
 * 3. Wait up to `quickWaitMs` for the user to log in quickly (e.g. just click "log in" on an active session).
 * 4. If login detected within `quickWaitMs`: transfer cookies → headless continues transparently.
 * 5. If not: return false — caller returns error to AI, browser stays open in background.
 *    Next tool call will hit case 1 and wait again.
 */
export async function handleAuthFailure(
  sessionManager: SessionManager,
  config: SessionConfig,
  adapter: SiteAdapter,
  opts: { quickWaitMs?: number; totalTimeoutMs?: number } = {}
): Promise<boolean> {
  const { quickWaitMs = 15_000, totalTimeoutMs = 120_000 } = opts;

  // No auto-reauth when the backend doesn't support it (e.g. extension strategy:
  // the user's Chrome manages auth; there is no headless session to recover).
  if (!sessionManager.supportsAutoReauth(config.site)) {
    log.info({ site: config.site }, "backend does not support auto-reauth — user must log in manually");
    return false;
  }

  // ── Automated login (opt-in) ───────────────────────────────────────────────
  // If the adapter provides LoginOptions, attempt a programmatic form-fill login
  // before falling back to the human-handoff headed-browser flow.
  if (adapter.getLoginOptions) {
    try {
      const page = await sessionManager.getPage(config, adapter);
      await withLoginFlow(page, adapter.getLoginOptions());
      log.info({ site: config.site }, "automated login succeeded");
      return true;
    } catch (err) {
      if (err instanceof LoginError) {
        // Definitive failure (bad password, blocked, change-password required).
        // Re-throw so wrapToolCall can surface the typed error to the AI client.
        throw err;
      }
      // Transient / unexpected error — fall through to human-handoff as usual.
      log.warn({ site: config.site, err }, "automated login failed, falling back to human-handoff");
    }
  }

  // ── Human-handoff (existing path, unchanged) ──────────────────────────────
  const existing = backgroundLogins.get(config.site);
  if (existing) {
    // Already in flight — wait a bit for it
    return raceWithTimeout(existing.promise, quickWaitMs);
  }

  // Start a new background login
  const promise = runBackgroundLogin(sessionManager, config, adapter, totalTimeoutMs);
  backgroundLogins.set(config.site, { promise, startedAt: Date.now() });

  // Clean up map entry when done (regardless of result)
  promise.finally(() => backgroundLogins.delete(config.site));

  return raceWithTimeout(promise, quickWaitMs);
}

export function isBackgroundLoginInProgress(site: string): boolean {
  return backgroundLogins.has(site);
}

async function runBackgroundLogin(
  sessionManager: SessionManager,
  config: SessionConfig,
  adapter: SiteAdapter,
  timeoutMs: number
): Promise<boolean> {
  // Skip headed browser in CI environments — no display available
  if (process.env["CI"]) {
    log.info({ site: config.site }, "CI environment detected — skipping background headed browser login");
    return false;
  }

  // Use a fresh temp directory so we don't conflict with the running headless context
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `browserkit-login-${config.site}-`));
  log.info({ site: config.site, tempDir }, "opening temporary headed browser for login");

  let tempContext;
  try {
    tempContext = await chromium.launchPersistentContext(tempDir, { headless: false });
    const loginPage = await tempContext.newPage();

    try {
      await loginPage.goto(adapter.loginUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    } catch {
      // Page may redirect — that's fine
    }

    console.log(`\n  [browserkit] Login required for ${adapter.domain}`);
    console.log(`  A browser window has opened — please complete login.`);
    console.log(`  It will close automatically when done.\n`);

    // Poll isLoggedIn in the temp browser
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await adapter.isLoggedIn(loginPage)) {
          // Transfer credentials to the running headless context
          const state = await tempContext.storageState();
          await sessionManager.injectStorageState(
            config.site,
            state.cookies,
            state.origins
          );

          console.log(`  [browserkit] ✓ Logged in to ${adapter.domain} — browser closing.\n`);
          log.info({ site: config.site }, "background login succeeded, auth injected");
          return true;
        }
      } catch {
        // Transient — keep polling
      }
      await sleep(2_000);
    }

    console.log(`  [browserkit] Login timed out for ${adapter.domain}.\n`);
    log.warn({ site: config.site }, "background login timed out");
    return false;
  } finally {
    try {
      await tempContext?.close();
    } catch { /* ignore */ }
    // Clean up temp profile dir
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

// ─── Explicit login command (CLI `browserkit login <site>`) ─────────────────

/**
 * Blocking login flow for the CLI command. Uses a different strategy depending
 * on whether the server is currently running:
 *
 * - Server NOT running (initial setup): close/reopen on same profile dir.
 *   Captures everything including IndexedDB — most reliable.
 * - Server IS running: use background temp-profile flow so headless stays alive.
 */
export async function runLoginCommand(
  sessionManager: SessionManager,
  config: SessionConfig,
  adapter: SiteAdapter,
  serverIsRunning: boolean,
  options: { timeoutMs?: number } = {}
): Promise<HandoffResult> {
  const { timeoutMs = 180_000 } = options;

  if (serverIsRunning) {
    // Server is running — use temp profile to avoid conflicting with headless context
    const success = await runBackgroundLogin(sessionManager, config, adapter, timeoutMs);
    return {
      outcome: success ? "success" : "timeout",
      durationMs: timeoutMs,
    };
  }

  // Server not running — safe to use same profile dir (captures everything)
  const page = await sessionManager.reopenHeaded(config);

  try {
    await page.goto(adapter.loginUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
  } catch { /* ok */ }

  console.log(`\n  Browser opened for ${adapter.domain}`);
  console.log(`  Please complete login — it will close automatically.\n`);

  const start = Date.now();
  const deadline = start + timeoutMs;

  while (Date.now() < deadline) {
    try {
      if (await adapter.isLoggedIn(page)) {
        const durationMs = Date.now() - start;
        console.log(`  ✓ Logged in (${Math.round(durationMs / 1000)}s) — closing browser.\n`);
        await sessionManager.reopenHeadless(config);
        return { outcome: "success", durationMs };
      }
    } catch { /* keep polling */ }
    await sleep(2_000);
  }

  await sessionManager.closeSite(config.site);
  return { outcome: "timeout", durationMs: timeoutMs };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function raceWithTimeout(promise: Promise<boolean>, timeoutMs: number): Promise<boolean> {
  return Promise.race([
    promise,
    sleep(timeoutMs).then(() => false),
  ]);
}

// ── loginViaConnect ───────────────────────────────────────────────────────────

/**
 * Attaches to an already-running Chrome instance via CDP, checks whether the
 * adapter reports a logged-in state, and — if so — saves the storageState to
 * disk so `SessionManager` can pick it up on next start.
 *
 * Use this with `browserkit login --connect` to avoid opening a second browser
 * when the user already has Chrome running and logged in.
 */
export async function loginViaConnect(
  sessionManager: Pick<SessionManager, "getProfileDir" | "injectStorageState">,
  config: Pick<SessionConfig, "site" | "domain" | "authStrategy" | "profileDir">,
  adapter: Pick<SiteAdapter, "isLoggedIn">,
  cdpEndpoint: string
): Promise<{ outcome: "success" | "timeout"; durationMs: number }> {
  const start = Date.now();

  const browser = await chromium.connectOverCDP(cdpEndpoint);
  try {
    const context = browser.contexts()[0];
    if (!context) return { outcome: "timeout", durationMs: Date.now() - start };

    const pages = context.pages();
    const page = pages[0];
    if (!page) return { outcome: "timeout", durationMs: Date.now() - start };

    const loggedIn = await adapter.isLoggedIn(page as never);
    if (!loggedIn) return { outcome: "timeout", durationMs: Date.now() - start };

    // Logged in — persist the storageState
    const state = await context.storageState();
    if (config.authStrategy === "storage-state") {
      const profileDir = sessionManager.getProfileDir(config.site ?? config.profileDir);
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(
        path.join(profileDir, "storage-state.json"),
        JSON.stringify(state, null, 2)
      );
    } else {
      await sessionManager.injectStorageState(
        config.site,
        state.cookies as never,
        state.origins as never
      );
    }

    return { outcome: "success", durationMs: Date.now() - start };
  } finally {
    await browser.close();
  }
}
