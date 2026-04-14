import fs from "node:fs";
import path from "node:path";
import type { Page, Locator } from "patchright";
import type { ToolContent } from "./types.js";
import { sleep } from "./waiting.js";

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
