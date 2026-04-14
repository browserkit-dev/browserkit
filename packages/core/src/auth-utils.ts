import type { Page } from "patchright";

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
 * auth-blocking route. Handles trailing slashes and sub-paths correctly
 * so a profile slug like "/login-tips" does NOT match "/login".
 */
export function isAuthBlockerUrl(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }

  for (const blocker of AUTH_BLOCKER_PATHS) {
    if (pathname === blocker) return true;
    if (pathname === `${blocker}/`) return true;
    if (pathname.startsWith(`${blocker}/`)) return true;
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
export async function detectAuthBarrier(
  page: Page,
  quick = true
): Promise<string | null> {
  try {
    const url = page.url();

    if (isAuthBlockerUrl(url)) {
      return `auth blocker URL: ${url}`;
    }

    if (quick) return null;

    const title = await page.title().catch(() => "");
    const titleLower = title.trim().toLowerCase();
    const loginTitles = [
      "linkedin login",
      "sign in | linkedin",
      "log in | linkedin",
    ];
    if (loginTitles.some((t) => titleLower.includes(t))) {
      return `login page title: ${title}`;
    }

    const hasMain = (await page.locator("main").count()) > 0;
    if (!hasMain) {
      const bodyText = await page
        .locator("body")
        .innerText({ timeout: 1000 })
        .catch(() => "");
      if (typeof bodyText === "string" && bodyText.length < 5_000) {
        const normalized = bodyText
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
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
