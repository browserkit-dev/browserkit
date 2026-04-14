import fs from "node:fs";
import path from "node:path";
import type { Page } from "patchright";
import type { SelectorReport } from "./types.js";

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
    } catch {
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
