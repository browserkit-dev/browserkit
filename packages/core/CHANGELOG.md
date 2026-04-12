# @browserkit-dev/core

## 0.2.1

### Patch Changes

- 8a49004: Refactor internal browser session management into a `BrowserBackend` strategy pattern. Each auth strategy (`persistent`, `storage-state`, `cdp-attach`, `extension`) is now a self-contained class implementing a `BrowserBackend` interface. No behavior change — public API is unchanged.

## 0.2.0

### Minor Changes

- Adapter ecosystem hardening: `minCoreVersion` + `AdapterRequirements` on `SiteAdapter`, `version-check.ts` with `satisfies()`/`readCoreVersion()`, `browserkit doctor` CLI command, dynamic `create-adapter` scaffold versioning, cross-repo `test-adapters.yml` CI.

## 0.1.0

### Minor Changes

- Initial public release of @browserkit-dev/core — the framework for building site-specific MCP servers over authenticated browser sessions.
  Key features:
  - `defineAdapter` / `SiteAdapter` interface for building adapters
  - `SessionManager` with persistent, storage-state, and CDP-attach strategies
  - `withLoginFlow` for opt-in automated form-based login
  - `waitUntil`, `fetchGetWithinPage`, `fetchPostWithinPage` and other scraping utilities
  - `preparePage` lifecycle hook for per-page configuration
  - `LockManager`, `RateLimiter`, and `withObservability` for production reliability
  - HTTP MCP transport via `StreamableHTTPServerTransport`
  - `LockManager`, `RateLimiter`, and `withObservability` for production reliability
  - HTTP MCP transport via `StreamableHTTPServerTransport`
