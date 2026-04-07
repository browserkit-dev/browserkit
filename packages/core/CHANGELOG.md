# @browserkit-dev/core

## 0.2.0

### Minor Changes

- 732686d: Initial public release of @browserkit-dev/core — the framework for building site-specific MCP servers over authenticated browser sessions.

  Key features:

  - `defineAdapter` / `SiteAdapter` interface for building adapters
  - `SessionManager` with persistent, storage-state, and CDP-attach strategies
  - `withLoginFlow` for opt-in automated form-based login
  - `waitUntil`, `fetchGetWithinPage`, `fetchPostWithinPage` and other scraping utilities
  - `preparePage` lifecycle hook for per-page configuration
  - `LockManager`, `RateLimiter`, and `withObservability` for production reliability
  - HTTP MCP transport via `StreamableHTTPServerTransport`
