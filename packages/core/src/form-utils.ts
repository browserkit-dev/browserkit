import type { Page, Frame } from "patchright";
import { waitUntil } from "./waiting.js";

// ── Form / element interaction helpers ───────────────────────────────────────
// Ported from israeli-bank-scrapers helpers/elements-interactions.ts.

/**
 * Fill an input field with `value`, replacing any existing content.
 * Triggers input and change events (correct for React controlled components).
 */
export async function fillInput(
  page: Page | Frame,
  selector: string,
  value: string
): Promise<void> {
  await page.locator(selector).fill(value);
}

/**
 * Click a button or element by selector.
 */
export async function clickButton(
  page: Page | Frame,
  selector: string
): Promise<void> {
  await page.locator(selector).click();
}

/**
 * Set an input's `.value` property directly without firing keyboard events.
 * Use this when the site reads `.value` directly rather than listening for
 * input/change events (non-React forms, legacy apps).
 */
export async function setValue(
  page: Page | Frame,
  selector: string,
  value: string
): Promise<void> {
  await page.locator(selector).evaluate(
    (el, v) => {
      (el as HTMLInputElement).value = v;
    },
    value
  );
}

/**
 * Return true if at least one element matching `selector` exists in the DOM
 * right now. Does not wait — use `waitUntilElementFound` for polling.
 */
export async function elementPresentOnPage(
  page: Page | Frame,
  selector: string
): Promise<boolean> {
  return (await page.locator(selector).count()) > 0;
}

/**
 * Wait until an element matching `selector` is present in the DOM.
 *
 * @param isVisible  When true, also waits for the element to be visible.
 * @param timeout    Override the default Playwright timeout (ms).
 */
export async function waitUntilElementFound(
  page: Page | Frame,
  selector: string,
  isVisible = false,
  timeout?: number
): Promise<void> {
  await page.waitForSelector(selector, {
    state: isVisible ? "visible" : "attached",
    ...(timeout !== undefined ? { timeout } : {}),
  });
}

/**
 * Wait until an element matching `selector` disappears from the DOM (or
 * becomes hidden). Useful for waiting out loading spinners.
 */
export async function waitUntilElementDisappear(
  page: Page | Frame,
  selector: string,
  timeout?: number
): Promise<void> {
  await page.waitForSelector(selector, {
    state: "hidden",
    ...(timeout !== undefined ? { timeout } : {}),
  });
}

/**
 * Wait until a frame matching `framePredicate` appears among the page's frames.
 * Returns the matched frame.
 */
export async function waitUntilIframeFound(
  page: Page,
  framePredicate: (frame: Frame) => boolean,
  description = "waiting for iframe",
  timeout = 30_000
): Promise<Frame> {
  let found: Frame | undefined;
  await waitUntil(
    () => {
      found = page.frames().find(framePredicate);
      return Promise.resolve(found ?? null);
    },
    description,
    timeout,
    1_000
  );
  if (!found) throw new Error("failed to find iframe");
  return found;
}

/**
 * Typed `$eval` with graceful missing-element handling.
 * Returns `defaultResult` when no element matches `selector`.
 */
export async function pageEval<R>(
  page: Page | Frame,
  selector: string,
  defaultResult: R,
  callback: (element: Element) => R
): Promise<R> {
  try {
    const locator = page.locator(selector);
    if ((await locator.count()) === 0) return defaultResult;
    return await locator.first().evaluate(callback);
  } catch {
    return defaultResult;
  }
}

/**
 * Typed `$$eval` with graceful missing-element handling.
 * Calls `callback` with all matching elements; returns `defaultResult` on error.
 */
export async function pageEvalAll<R>(
  page: Page | Frame,
  selector: string,
  defaultResult: R,
  callback: (elements: Element[]) => R
): Promise<R> {
  try {
    return await page.locator(selector).evaluateAll(callback);
  } catch {
    return defaultResult;
  }
}

// ── Miscellaneous browser utilities ──────────────────────────────────────────

/**
 * Strip "HeadlessChrome/" from the navigator user agent string so headless
 * Chrome reports as regular Chrome. Call from `preparePage` to apply once at
 * startup before any navigation.
 */
export async function maskHeadlessUserAgent(page: Page): Promise<void> {
  const raw = await page.evaluate(() => navigator.userAgent);
  const masked = raw.replace("HeadlessChrome/", "Chrome/");
  await page.addInitScript(
    (ua: string) => {
      Object.defineProperty(navigator, "userAgent", { get: () => ua });
    },
    masked
  );
}

/**
 * Read and JSON-parse a value from the page's `sessionStorage`.
 * Returns null if the key is absent or the value is not valid JSON.
 */
export async function getFromSessionStorage<T>(
  page: Page,
  key: string
): Promise<T | null> {
  const raw = await page.evaluate(
    (k: string) => sessionStorage.getItem(k),
    key
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Split an array into chunks of at most `size` elements.
 *
 * @example
 * chunk([1, 2, 3, 4, 5], 2) // [[1, 2], [3, 4], [5]]
 */
export function chunk<T>(array: T[], size: number): T[][] {
  if (size <= 0) throw new Error(`chunk size must be positive, got ${size}`);
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
