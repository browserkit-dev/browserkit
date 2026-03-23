import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { chromium } from "playwright";
import type { HandoffResult, SiteAdapter, ToolResult } from "./types.js";
import type { SessionManager } from "./session-manager.js";
import type { SessionConfig } from "./types.js";
import { getLogger } from "./logger.js";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
