import fs from "node:fs";
import path from "node:path";
import type { Page, Locator } from "playwright";
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
