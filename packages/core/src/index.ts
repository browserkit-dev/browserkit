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
} from "./types.js";

// ─── Utilities for adapter implementations ────────────────────────────────────
export {
  validateSelectors,
  snapshotSelectors,
  waitForLogin,
  extractByRole,
  screenshotToContent,
  screenshotOnError,
} from "./adapter-utils.js";

// ─── Observability ────────────────────────────────────────────────────────────
export { withObservability } from "./observability.js";
export type { TraceEntry, ObservabilityOptions } from "./observability.js";
