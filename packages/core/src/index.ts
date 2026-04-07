// ─── Adapter authoring API ────────────────────────────────────────────────────
export { defineAdapter } from "./define-adapter.js";
export { defineConfig } from "./define-config.js";

// ─── Server / session internals (used by harness and CLI) ─────────────────────
export { SessionManager } from "./session-manager.js";
export { createAdapterServer } from "./adapter-server.js";
export type { AdapterServerOptions, AdapterServerHandle } from "./adapter-server.js";

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  SiteAdapter,
  ToolDefinition,
  ToolResult,
  ToolContent,
  ToolReference,
  AuthStrategy,
  SessionConfig,
  AdapterConfig,
  FrameworkConfig,
  HandoffResult,
  SelectorReport,
  SelectorMatch,
  AdapterStatus,
  DaemonStatus,
  BrowserMode,
  ModeState,
  AuthErrorType,
  LoginOptions,
  PossibleLoginResults,
  AdapterRequirements,
} from "./types.js";
export { LoginError } from "./types.js";

// ─── Utilities for adapter implementations ────────────────────────────────────
export {
  validateSelectors,
  snapshotSelectors,
  waitForLogin,
  extractByRole,
  screenshotToContent,
  screenshotOnError,
  detectRateLimit,
  dismissModals,
  scrollContainer,
  isAuthBlockerUrl,
  detectAuthBarrier,
  // Navigation
  getCurrentUrl,
  waitForRedirect,
  waitForUrl,
  // Element interaction
  fillInput,
  clickButton,
  setValue,
  elementPresentOnPage,
  waitUntilElementFound,
  waitUntilElementDisappear,
  waitUntilIframeFound,
  pageEval,
  pageEvalAll,
  // Miscellaneous browser
  maskHeadlessUserAgent,
  getFromSessionStorage,
  chunk,
} from "./adapter-utils.js";

// ─── Async polling primitives ────────────────────────────────────────────────
export {
  TimeoutError,
  SECOND,
  waitUntil,
  raceTimeout,
  runSerial,
  sleep,
} from "./waiting.js";

// ─── In-page fetch utilities ─────────────────────────────────────────────────
export {
  fetchGet,
  fetchPost,
  fetchGraphql,
  fetchGetWithinPage,
  fetchPostWithinPage,
} from "./fetch-utils.js";

// ─── Login flow (opt-in automated login) ─────────────────────────────────────
export { withLoginFlow } from "./login-flow.js";

// ─── Version utilities ────────────────────────────────────────────────────────
export { readCoreVersion, satisfies, parseSemver, readAdapterVersion } from "./version-check.js";

// ─── Observability ────────────────────────────────────────────────────────────
export { withObservability } from "./observability.js";
export type { TraceEntry, ObservabilityOptions } from "./observability.js";
