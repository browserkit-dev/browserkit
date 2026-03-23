# Progress

## Session 0 — Project Setup (2026-03-22)

- Synthesized SPEC.md from ChatGPT brainstorm conversation about authenticated MCP wrappers
- Created ARCH.md with planned file tree and component interfaces
- Created TASKS.md with backlog from SPEC
- Archived original brainstorm MHTML to `docs/reference/`
- Scaffolded full AI-native project structure (CLAUDE.md, .context/, .claude/, .cursor/)

## Session 3 — HN Adapter Test Harness (2026-03-23)

### Bug fixes

- **`SiteAdapter.selectors` type mismatch**: changed from `Record<string, Locator>` to `Record<string, string>` in `types.ts`; updated `validateSelectors` / `snapshotSelectors` in `adapter-utils.ts` to accept CSS strings and call `page.locator()` internally. HN adapter now exports `SELECTORS` as `adapter.selectors`, enabling `health_check` selector reporting.
- **`get_comments` storyId parsing**: added `z.string().refine()` validation rejecting non-numeric, non-URL IDs at the schema level; removed `id.replace(/\D/g, "")` silent bad-URL path.
- **`Story.storyUrl` renamed to `discussionUrl`**: the field held the HN discussion URL, not the external article URL (which is in `url`).
- **Comment truncation**: `slice(0, 500)` now appends `"…"` when the comment was truncated.
- **`StreamableHTTPServerTransport as any`**: removed unnecessary cast — SDK 1.27.1 types match correctly.
- **HTTP path filter**: server now returns 404 for requests to any path other than `/mcp`.
- **Multi-client support**: refactored `adapter-server.ts` to a per-session McpServer+transport factory. Each connecting MCP client gets its own `McpServer` + `StreamableHTTPServerTransport` pair keyed by session ID. Shared state (browser, lock, rate limiter) is preserved across sessions.
- **Build order**: root `pnpm build` now uses `--workspace-concurrency=1` so core always builds before adapters.

### Testing harness

Added `packages/harness` (`@browserkit/harness`) — shared test utilities:
- `src/test-server.ts` — `createTestAdapterServer(adapter)`: spins up an isolated in-process adapter server on a dynamic port with a temp `dataDir` (avoids pidfile conflicts); cleans up on `stop()`.
- `src/mcp-client.ts` — `createTestMcpClient(url)`: wraps `Client` + `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk`; provides `callTool`, `listTools`, `close`.

**Layer tests added:**
- **L1 — Unit** (`adapter-hackernews/tests/hackernews.test.ts`): 16 tests covering schema, metadata, `get_comments` ID validation edge cases, boundary counts, `discussionUrl` field, selector export.
- **L3 — MCP Protocol** (`harness/tests/mcp-protocol.test.ts`): 13 tests covering tool registry (10 tools listed), `health_check`, `get_page_state`, `get_top` shape, `get_comments` dispatch, `isError:true` on schema violations, bearer token 401.
- **L4 — Reliability** (`harness/tests/reliability.test.ts`): 7 tests covering lock serialization under concurrent calls, p50/p95 latency measurement, error recovery after schema violations, no lock leaks under 10 rapid sequential calls.
- **L2 — Scraping Integration** (`adapter-hackernews/tests/hackernews.integration.test.ts`): 11 live-browser tests covering all 5 tools, story shape assertions, `discussionUrl` vs `storyUrl`, truncation ellipsis, selector health after navigation.

**Scripts:**
- `pnpm test` — unit + L3 + L4 (no live network required)
- `pnpm test:integration` — L2 live browser scraping (requires network)

**Results:** 61 tests pass across all 4 packages (core: 19, adapter-hackernews: 16, adapter-linkedin: 6, harness: 20).

- Added `debugPort` to `AdapterConfig` and `SessionConfig`
- `SessionManager.launchSession()` passes `--remote-debugging-port=debugPort` to Chromium when configured
- `SessionManager.getCdpUrl(site)` returns `http://127.0.0.1:debugPort` for external attachment
- `get_page_state` MCP tool now includes `cdpUrl` in its response
- `AdapterStatus` type includes `wsEndpoint` (CDP URL)
- Wrote `README.md` (was absent) — covers quickstart, config, all tools, raw access pattern, adapter authoring
- Updated `ARCH.md` — current package structure, CDP section, browser mode state machine, key decisions
- Updated `AGENTS.md` via continual-learning with session patterns
- CDP attach pattern: `chromium.connectOverCDP(cdpUrl)` → reuses authenticated session, `browser.disconnect()` leaves session alive

- Established monorepo with pnpm workspaces (`packages/core`, `packages/adapter-linkedin`)
- Implemented `@browserkit/core`:
  - `types.ts` — full type system: `SiteAdapter`, `ToolDefinition`, `ToolResult` (text+image), `FrameworkConfig`, `SessionConfig`, `AdapterStatus`, `DaemonStatus`
  - `define-adapter.ts` — `defineAdapter()` with compile-time + runtime validation
  - `define-config.ts` — `defineConfig()` with security validation (non-localhost requires bearer token)
  - `session-manager.ts` — `SessionManager` (persistent/storage-state/CDP, XDG dirs on macOS+Linux, pidfile lock, SIGTERM/SIGINT cleanup)
  - `lock-manager.ts` — FIFO async mutex per key, configurable timeout
  - `rate-limiter.ts` — min delay enforcement between calls per adapter
  - `human-handoff.ts` — `triggerHandoff()` (navigate + bringToFront) + `waitForHandoff()` (polling for CLI login command) + `buildHandoffResult()` (immediate error return for tool path)
  - `adapter-utils.ts` — `validateSelectors()`, `snapshotSelectors()`, `waitForLogin()`, `extractByRole()`, `screenshotToContent()`, `screenshotOnError()`
  - `adapter-server.ts` — per-adapter `McpServer` + `StreamableHTTPServerTransport`, bearer token middleware, auto `health_check` tool, full handler wrapper (lock → rate limiter → isLoggedIn → handler → screenshot on error)
  - `server.ts` — orchestrator: loads adapter packages, creates per-adapter servers, status sidecar endpoint
  - `cli.ts` — `start`, `login`, `status`, `config cursor`, `create-adapter` commands; startup banner with auth status
  - `create-adapter.ts` — standalone project scaffolding (package.json, tsconfig, selectors, index, tests, README)
  - `observability.ts` — `withObservability()` wrapping Playwright trace + screenshot + ARIA snapshot + timing log
- Implemented `@browserkit/adapter-linkedin`:
  - `selectors.ts` — named selector constants for feed, messaging, people search
  - `index.ts` — `defineAdapter()` with `isLoggedIn`, `get_feed`, `get_messages`, `search_people`
- 23 tests passing across both packages (LockManager, RateLimiter, defineAdapter, SessionManager, LinkedIn adapter)
