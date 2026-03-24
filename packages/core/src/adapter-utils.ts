import fs from "node:fs";
import path from "node:path";
import type { Page, Locator } from "patchright";
import type { SelectorReport, ToolContent } from "./types.js";

/**
 * Validate a map of named CSS selector strings against the current page state.
 * Returns a report of which selectors matched, how many elements, and a text sample.
 */
export async function validateSelectors(
  page: Page,
  selectors: Record<string, string>
): Promise<SelectorReport> {
  const report: SelectorReport = {};
  for (const [name, selector] of Object.entries(selectors)) {
    const locator = page.locator(selector);
    try {
      const count = await locator.count();
      let sample: string | undefined;
      if (count > 0) {
        try {
          const text = await locator.first().innerText({ timeout: 2000 });
          sample = text.slice(0, 80).trim() || undefined;
        } catch {
          // innerText may fail on non-text elements; ignore
        }
      }
      report[name] = { found: count > 0, count, sample };
    } catch (err) {
      report[name] = { found: false, count: 0 };
    }
  }
  return report;
}

/**
 * Capture the outer HTML of each selector's first match and write to fixturePath as JSON.
 * Use the resulting file to drive unit tests without a live browser.
 */
export async function snapshotSelectors(
  page: Page,
  selectors: Record<string, string>,
  fixturePath: string
): Promise<void> {
  const snapshot: Record<string, string | null> = {};
  for (const [name, selector] of Object.entries(selectors)) {
    const locator = page.locator(selector);
    try {
      const count = await locator.count();
      if (count > 0) {
        snapshot[name] = await locator.first().evaluate(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (el: any): string => (el as { outerHTML: string }).outerHTML
        );
      } else {
        snapshot[name] = null;
      }
    } catch {
      snapshot[name] = null;
    }
  }
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, JSON.stringify(snapshot, null, 2), "utf8");
}

/**
 * Wait until adapter.isLoggedIn() returns true, polling every intervalMs.
 * Rejects after timeoutMs.
 */
export async function waitForLogin(
  page: Page,
  isLoggedIn: (page: Page) => Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const { timeoutMs = 120_000, intervalMs = 2_000 } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLoggedIn(page)) return;
    await sleep(intervalMs);
  }
  throw new Error(`Login not completed within ${timeoutMs}ms`);
}

/**
 * Extract text content from all matching elements.
 * Convenience wrapper around page.$$eval.
 */
export async function extractByRole(
  page: Page,
  locator: Locator,
  attribute?: string
): Promise<string[]> {
  const count = await locator.count();
  const results: string[] = [];
  for (let i = 0; i < count; i++) {
    const el = locator.nth(i);
    try {
      const text = attribute
        ? await el.getAttribute(attribute)
        : await el.innerText();
      if (text) results.push(text.trim());
    } catch {
      // skip elements that error
    }
  }
  return results;
}

/**
 * Capture a screenshot and return it as MCP image content.
 * Used in error handling paths so the AI can see what the page looked like.
 */
export async function screenshotToContent(
  page: Page
): Promise<ToolContent & { type: "image" }> {
  const buffer = await page.screenshot({ type: "png", fullPage: false });
  return {
    type: "image",
    data: buffer.toString("base64"),
    mimeType: "image/png",
  };
}

/**
 * Save a screenshot to disk and return the file path.
 */
export async function screenshotOnError(
  page: Page,
  dir: string,
  site: string
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(dir, site, `${timestamp}.png`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await page.screenshot({ path: filePath, type: "png", fullPage: false });
  return filePath;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Detect rate limiting or security challenges after a navigation.
 *
 * Modeled on stickerdaniel/linkedin-mcp-server's approach:
 *   1. URL-based check: /checkpoint or authwall in the URL = security challenge
 *   2. Content-based check: only runs on error-shaped pages (no <main> element,
 *      body text < 2000 chars). Guards against false positives on real content pages
 *      that incidentally contain phrases like "slow down".
 *
 * Throws an Error if rate limiting is detected — the caller (wrapToolCall) will
 * catch this and return isError:true so the AI knows to wait before retrying.
 */
export async function detectRateLimit(page: Page): Promise<void> {
  const url = page.url();

  // URL-based: security checkpoints always redirect to known paths
  if (url.includes("/checkpoint") || url.includes("authwall")) {
    throw new Error(
      `Rate limit or security challenge detected at: ${url}. ` +
      "Wait a few minutes before retrying. If this persists, run `browserkit login <site>` to re-authenticate."
    );
  }

  // Content-based: only run on error-shaped pages (minimal, no <main>)
  try {
    const hasMain = await page.locator("main").count() > 0;
    if (hasMain) return; // real content page — skip heuristic

    const bodyText = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
    if (bodyText && bodyText.length < 2_000) {
      const lower = bodyText.toLowerCase();
      const rateLimitPhrases = ["too many requests", "rate limit", "slow down", "try again later"];
      if (rateLimitPhrases.some((p) => lower.includes(p))) {
        throw new Error(
          `Rate limit message detected on page (${url}). ` +
          "Wait before retrying."
        );
      }
    }
  } catch (err) {
    // Re-throw rate limit errors; swallow page read errors
    if (err instanceof Error && err.message.includes("Rate limit")) throw err;
  }
}

/**
 * Dismiss popup modals that may be blocking content.
 *
 * Tries a set of ARIA-stable selectors in order. Returns true if a modal
 * was dismissed, false if nothing was found. Failures are silently swallowed.
 *
 * The artdeco selector is LinkedIn-specific but harmless on other sites.
 */
export async function dismissModals(page: Page): Promise<boolean> {
  const dismissSelectors = [
    'button[aria-label="Dismiss"]',
    'button[aria-label="Close"]',
    'button[aria-label="Dismiss dialog"]',
    "button.artdeco-modal__dismiss",
  ];

  for (const selector of dismissSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click();
        await sleep(400);
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false;
}

/**
 * Scroll the nearest scrollable ancestor of `anchorSelector` until no new
 * content loads or `maxScrolls` is reached.
 *
 * This is the correct approach for sites with nested scrollable containers
 * (LinkedIn job sidebar, LinkedIn feed, etc.) where `window.scrollBy` has
 * no effect because the scrollable element is not the window.
 *
 * @param anchorSelector  CSS selector for any element inside the container
 * @param options.pauseMs  ms to wait between scrolls (default: 1000)
 * @param options.maxScrolls  maximum number of scroll attempts (default: 10)
 * @returns number of scrolls performed (-1 if no scrollable container found)
 */
export async function scrollContainer(
  page: Page,
  anchorSelector: string,
  options: { pauseMs?: number; maxScrolls?: number } = {}
): Promise<number> {
  const { pauseMs = 1000, maxScrolls = 10 } = options;

  const scrollCount = await page.evaluate(
    ({ sel, pauseTime, maxScrolls: max }) => {
      // Find the anchor element, then walk up to the first scrollable ancestor
      const anchor = document.querySelector(sel);
      if (!anchor) return -1;

      let container: Element | null = anchor.parentElement;
      while (container && container !== document.body) {
        const style = window.getComputedStyle(container);
        const overflowY = style.overflowY;
        if (
          (overflowY === "auto" || overflowY === "scroll") &&
          container.scrollHeight > container.clientHeight
        ) {
          break;
        }
        container = container.parentElement;
      }

      if (!container || container === document.body) return -1;

      // Scroll iteratively until content stops growing
      let count = 0;
      const scroll = (): Promise<number> =>
        new Promise((resolve) => {
          let i = 0;
          const step = () => {
            if (i >= max) { resolve(count); return; }
            const prev = container!.scrollHeight;
            container!.scrollTop = container!.scrollHeight;
            setTimeout(() => {
              if (container!.scrollHeight === prev) { resolve(count); return; }
              count++;
              i++;
              step();
            }, pauseTime);
          };
          step();
        });

      return scroll();
    },
    { sel: anchorSelector, pauseTime: pauseMs, maxScrolls }
  );

  return scrollCount;
}

// ── Auth barrier detection ─────────────────────────────────────────────────
// Port of linkedin_mcp_server/core/auth.py — kept generic so any authenticated
// adapter can use these utilities. The patterns work for LinkedIn and are
// harmless no-ops on other sites.

/** URL path prefixes that indicate an auth-blocking page. */
const AUTH_BLOCKER_PATHS = [
  "/login",
  "/authwall",
  "/checkpoint",
  "/challenge",
  "/uas/login",
  "/uas/consumer-email-challenge",
];

/** Body text marker groups that indicate an account-picker or sign-in wall. */
const AUTH_BARRIER_TEXT_MARKERS: [string, string][] = [
  ["welcome back", "sign in using another account"],
  ["welcome back", "join now"],
  ["choose an account", "sign in using another account"],
  ["continue as", "sign in using another account"],
];

/**
 * Returns true if the URL path exactly matches (or starts with) a known
 * auth-blocking route.  Handles trailing slashes and sub-paths correctly
 * so a profile slug like "/login-tips" does NOT match "/login".
 */
export function isAuthBlockerUrl(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }

  for (const blocker of AUTH_BLOCKER_PATHS) {
    if (path === blocker) return true;
    if (path === `${blocker}/`) return true;
    if (path.startsWith(`${blocker}/`)) return true;
  }
  return false;
}

/**
 * Detect authentication barriers after a navigation.
 *
 * `quick = true` (default): checks URL path only — very cheap, safe to call
 * after every navigation.
 *
 * `quick = false`: additionally checks page title and body text for account-picker
 * / sign-in wall patterns — more thorough but requires a DOM read.
 *
 * Returns a short description string if a barrier is detected, null otherwise.
 * Does NOT throw — callers decide how to handle a detected barrier.
 */
export async function detectAuthBarrier(page: Page, quick = true): Promise<string | null> {
  try {
    const url = page.url();

    // 1. URL path check (always)
    if (isAuthBlockerUrl(url)) {
      return `auth blocker URL: ${url}`;
    }

    if (quick) return null;

    // 2. Title check
    const title = await page.title().catch(() => "");
    const titleLower = title.trim().toLowerCase();
    const loginTitles = ["linkedin login", "sign in | linkedin", "log in | linkedin"];
    if (loginTitles.some((t) => titleLower.includes(t))) {
      return `login page title: ${title}`;
    }

    // 3. Body text markers — only if page has minimal content (not a real page)
    const hasMain = await page.locator("main").count() > 0;
    if (!hasMain) {
      const bodyText = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
      if (typeof bodyText === "string" && bodyText.length < 5_000) {
        const normalized = bodyText.replace(/\s+/g, " ").trim().toLowerCase();
        for (const [a, b] of AUTH_BARRIER_TEXT_MARKERS) {
          if (normalized.includes(a) && normalized.includes(b)) {
            return `auth barrier text: ${a} + ${b}`;
          }
        }
      }
    }

    return null;
  } catch {
    return null; // never throw — page errors should not break callers
  }
}
