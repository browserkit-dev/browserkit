/**
 * Adapter utilities barrel re-export.
 * All symbols are re-exported from focused modules below so existing
 * `import { ... } from "@browserkit-dev/core"` and
 * `import { ... } from "./adapter-utils.js"` imports continue to work unchanged.
 */

export {
  validateSelectors,
  snapshotSelectors,
} from "./selector-utils.js";

export {
  screenshotToContent,
  screenshotOnError,
  waitForLogin,
  extractByRole,
} from "./screenshot-utils.js";

export {
  detectRateLimit,
  dismissModals,
  scrollContainer,
  getCurrentUrl,
  waitForRedirect,
  waitForUrl,
} from "./navigation-utils.js";

export {
  isAuthBlockerUrl,
  detectAuthBarrier,
} from "./auth-utils.js";

export {
  fillInput,
  clickButton,
  setValue,
  elementPresentOnPage,
  waitUntilElementFound,
  waitUntilElementDisappear,
  waitUntilIframeFound,
  pageEval,
  pageEvalAll,
  maskHeadlessUserAgent,
  getFromSessionStorage,
  chunk,
} from "./form-utils.js";
