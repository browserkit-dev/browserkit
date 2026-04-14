import type { Page, Frame } from "patchright";
import { waitUntil, sleep } from "./waiting.js";

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
    const hasMain = (await page.locator("main").count()) > 0;
    if (hasMain) return; // real content page — skip heuristic

    const bodyText = await page
      .locator("body")
      .innerText({ timeout: 1000 })
      .catch(() => "");
    if (bodyText && bodyText.length < 2_000) {
      const lower = bodyText.toLowerCase();
      const rateLimitPhrases = [
        "too many requests",
        "rate limit",
        "slow down",
        "try again later",
      ];
      if (rateLimitPhrases.some((p) => lower.includes(p))) {
        throw new Error(
          `Rate limit message detected on page (${url}). Wait before retrying.`
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

      let count = 0;
      const scroll = (): Promise<number> =>
        new Promise((resolve) => {
          let i = 0;
          const step = () => {
            if (i >= max) {
              resolve(count);
              return;
            }
            const prev = container!.scrollHeight;
            container!.scrollTop = container!.scrollHeight;
            setTimeout(() => {
              if (container!.scrollHeight === prev) {
                resolve(count);
                return;
              }
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

/**
 * Get the current page URL. When `clientSide` is true, reads from
 * `window.location.href` instead of the Playwright URL — necessary for SPAs
 * that use the History API, where the framework URL lags behind.
 */
export function getCurrentUrl(
  page: Page | Frame,
  clientSide = false
): Promise<string> {
  if (clientSide) {
    return page.evaluate(() => window.location.href);
  }
  return Promise.resolve(page.url());
}

/**
 * Poll until the page URL changes from its current value.
 * `ignoreList` skips intermediate redirect URLs.
 * Use `clientSide: true` for SPAs where `waitForNavigation()` never fires.
 */
export async function waitForRedirect(
  page: Page | Frame,
  timeout = 20_000,
  clientSide = false,
  ignoreList: string[] = []
): Promise<void> {
  const initial = await getCurrentUrl(page, clientSide);
  await waitUntil(
    async () => {
      const current = await getCurrentUrl(page, clientSide);
      return current !== initial && !ignoreList.includes(current);
    },
    `waiting for redirect from ${initial}`,
    timeout,
    1_000
  );
}

/**
 * Poll until the page URL exactly matches `url` (string) or the regex pattern.
 * Useful for confirming SPA navigation completed.
 */
export async function waitForUrl(
  page: Page | Frame,
  url: string | RegExp,
  timeout = 20_000,
  clientSide = false
): Promise<void> {
  await waitUntil(
    async () => {
      const current = await getCurrentUrl(page, clientSide);
      return url instanceof RegExp ? url.test(current) : url === current;
    },
    `waiting for url to be ${String(url)}`,
    timeout,
    1_000
  );
}
