import type { Page } from "patchright";
import type { AuthErrorType, LoginOptions, PossibleLoginResults } from "./types.js";
import { LoginError } from "./types.js";
import {
  fillInput,
  clickButton,
  waitUntilElementFound,
  waitForRedirect,
  getCurrentUrl,
} from "./adapter-utils.js";
import { getLogger } from "./logger.js";

const log = getLogger("login-flow");

/**
 * Execute an automated form-based login described by `opts`.
 *
 * Steps:
 *  1. Navigate to opts.loginUrl
 *  2. opts.checkReadiness?.() — wait for the form to be ready
 *  3. opts.preAction?.()      — e.g. click "Sign in with password" tab
 *  4. Fill each opts.fields entry with fillInput()
 *  5. Click opts.submitButtonSelector (or call it if a function)
 *  6. opts.postAction?.()     — if set; otherwise waitForRedirect()
 *  7. Match the resulting URL against opts.possibleResults
 *     - SUCCESS match   → return void (caller continues normally)
 *     - AuthErrorType   → throw LoginError(type, url)
 *     - No match        → throw LoginError('GENERIC', url)
 *
 * Throws:
 *  - LoginError   for definitive failures (bad password, blocked, change-password)
 *  - Error        for transient/unexpected failures (navigation timeout, missing selector)
 *    Callers should catch transient errors and fall back to human-handoff.
 */
export async function withLoginFlow(page: Page, opts: LoginOptions): Promise<void> {
  const waitUntil = opts.waitUntil ?? "domcontentloaded";

  log.debug({ loginUrl: opts.loginUrl }, "withLoginFlow: navigating to login URL");
  await page.goto(opts.loginUrl, { waitUntil, timeout: 30_000 });

  if (opts.userAgent) {
    await page.setExtraHTTPHeaders({ "User-Agent": opts.userAgent });
  }

  if (opts.checkReadiness) {
    log.debug("withLoginFlow: running checkReadiness");
    await opts.checkReadiness();
  } else if (opts.fields[0]) {
    // Default readiness: wait for the first field to appear
    await waitUntilElementFound(page, opts.fields[0].selector, false, 15_000);
  }

  if (opts.preAction) {
    log.debug("withLoginFlow: running preAction");
    await opts.preAction();
  }

  log.debug({ fieldCount: opts.fields.length }, "withLoginFlow: filling login fields");
  for (const { selector, value } of opts.fields) {
    await fillInput(page, selector, value);
  }

  log.debug("withLoginFlow: submitting");
  if (typeof opts.submitButtonSelector === "string") {
    await clickButton(page, opts.submitButtonSelector);
  } else {
    await opts.submitButtonSelector();
  }

  if (opts.postAction) {
    log.debug("withLoginFlow: running postAction");
    await opts.postAction();
  } else {
    await waitForRedirect(page, 20_000);
  }

  const currentUrl = await getCurrentUrl(page);
  log.debug({ currentUrl }, "withLoginFlow: checking possibleResults");

  const outcome = await matchPossibleResults(page, currentUrl, opts.possibleResults);

  if (outcome === "SUCCESS") {
    log.debug("withLoginFlow: login succeeded");
    return;
  }

  if (outcome !== null) {
    log.debug({ outcome }, "withLoginFlow: definitive login failure");
    throw new LoginError(outcome, `Login failed with ${outcome} at ${currentUrl}`);
  }

  // No pattern matched
  log.debug({ currentUrl }, "withLoginFlow: no result pattern matched — generic failure");
  throw new LoginError("GENERIC", `Login result unknown at ${currentUrl}`);
}

/**
 * Match `currentUrl` against every entry in `possibleResults`.
 * Returns the matched key ("SUCCESS" or an AuthErrorType), or null if nothing matches.
 *
 * Matching priority: string exact match → RegExp test → async predicate.
 */
async function matchPossibleResults(
  page: Page,
  currentUrl: string,
  possibleResults: PossibleLoginResults,
): Promise<"SUCCESS" | AuthErrorType | null> {
  for (const [key, patterns] of Object.entries(possibleResults) as Array<
    ["SUCCESS" | AuthErrorType, PossibleLoginResults[keyof PossibleLoginResults]]
  >) {
    if (!patterns) continue;
    for (const pattern of patterns) {
      let matched = false;
      if (typeof pattern === "string") {
        matched = currentUrl.toLowerCase() === pattern.toLowerCase();
      } else if (pattern instanceof RegExp) {
        matched = pattern.test(currentUrl);
      } else {
        try {
          matched = await pattern(page);
        } catch {
          // predicate threw — treat as no-match
        }
      }
      if (matched) return key;
    }
  }
  return null;
}
