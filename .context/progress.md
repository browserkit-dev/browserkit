# Progress

## Session 6 — Rescue Flights Adapter (2026-03-30)

### `packages/adapter-rescue-flights` — new public adapter

Built a complete Phase 1+2 rescue flights adapter covering El Al and Israir:

- **El Al scraper** (`elal.ts`): Angular CDK virtual-scroll page. Scrolls in 300px steps and collects data at each position to handle DOM node recycling. Returns flight#, departure time, and exact seat count (0 = sold out) for all flights in the next 8 days.
- **Israir scraper** (`israir.ts`): Two-phase approach.
  - Phase 1: reads listing page DOM for all announced rescue flights (58+ cards, two directions).
  - Phase 2: seeds a browser session, then calls Israir's internal `priceBar` API (`/api/results/priceBar`) per unique route for seat counts + prices across all dates. For available flights, intercepts the `FLIGHTS` API (`/api/search/FLIGHTS`) via `page.route()` to get exact flight#, departure time, and per-flight seat count.
  - Total time: ~45s for from_tel_aviv (51 flights), ~15s for to_tel_aviv listing-only.
  - All API calls via `page.evaluate()` — Imperva/TLS fingerprint bound, Node.js fetch rejected.
- **`run-check.ts`** and **`Makefile`**: `make agent-check` calls adapter tools over MCP, dumps `agent-check-results.json`. Agent does visual verification using browser screenshots.
- **14 unit tests** passing; integration tests updated for Phase 2 assertions.
- **`browserkit.config.js`** updated: port 52746.
- **`pnpm-workspace.yaml`** updated.
- **README.md** updated with rescue flights entry in Available Adapters table.

## Session 0 — Project Setup (2026-03-22)

- Synthesized SPEC.md from ChatGPT brainstorm conversation about authenticated MCP wrappers
- Created ARCH.md with planned file tree and component interfaces
- Created TASKS.md with backlog from SPEC
- Archived original brainstorm MHTML to `docs/reference/`
- Scaffolded full AI-native project structure (CLAUDE.md, .context/, .claude/, .cursor/)

## Session 5 — LinkedIn adapter: live testing & bug fixes (2026-03-24)

### LinkedIn adapter bugs fixed

- **`isLoggedIn` false negative on startup**: Browser starts at `about:blank`; URL wasn't an authenticated path so `isLoggedIn` always returned `false`. Fix: navigate to `linkedin.com/feed/` first if on `about:blank` — cookies load and auth check succeeds. LinkedIn now shows `logged in` in the daemon startup banner.
- **`get_feed` selector failure**: `div[data-id^="urn:li:activity"]` stopped matching LinkedIn's current DOM. Rewrote feed extraction using `page.evaluate()` to find post cards by walking up from social action buttons (`aria-label` containing "like"/"comment"/"repost"/"send") — resilient to React component version changes and class-name churn.
- **Updated `selectors.ts`**: Expanded `feedPost` to a multi-selector comma list as fallback; updated `feedPostAuthorName`, `feedPostText`, `feedPostReactions` with modern class alternatives.

### Verified working tools (all 7)

- `get_feed` — returns real feed posts with author, text, context blocks
- `get_person_profile` — works (Bill Gates test: returns `main_profile`, `experience`, etc.)
- `search_people` — works (`keywords` param; returns paginated LinkedIn search results)
- `search_jobs` — works (returns job listings with title, company, location)
- `get_company_profile`, `get_company_posts`, `get_job_details` — not yet live-tested but share same `extractPage`/`extractOverlay` path

### Daemon status at end of session

All 3 adapters logged in and serving tools:
- `hackernews` → port 52741 ✓
- `google-discover` → port 52743 ✓
- `linkedin` → port 52744 ✓



### Core framework additions

- **`browserkit reload <site>`** — reloads a single adapter's MCP server without restarting the daemon. Browser session (cookies, profile) stays alive. POST `/reload/:site` endpoint on the status sidecar. 60s CLI timeout to accommodate `isLoggedIn` navigation.
- **`browser` consolidated tool** — replaces the 5 individual management tools (`health_check`, `set_mode`, `take_screenshot`, `get_page_state`, `navigate`) with a single `browser({ action })` tool. Per-adapter tool count: HN 10→6, Google Discover 6→2. Removed `workflow-raw-access` prompt (niche, covered in README).
- **`channel` in `AdapterConfig`** — pass `"chrome"` to use real Google Chrome instead of Playwright's Chromium. Fixes SIGTRAP crash when `set_mode` switches to headed on a profile that was created with real Chrome.
- **Anti-automation flags** (`--disable-blink-features=AutomationControlled`) applied to all persistent contexts — removes `navigator.webdriver` signal that blocks Google login.
- **`isLoggedIn` fix in `cli.ts`** — checks running pidfile BEFORE creating `SessionManager` to avoid "already running" error when logging in with daemon active.

### Google Discover adapter (`browserkit-dev/adapter-google-discover`)

- New standalone adapter using Pixel 5 mobile emulation so `google.com` serves the full Discover feed regardless of desktop rollout status
- `get_feed({ count: 1–60, scroll: boolean })` — personalised articles; `scroll:true` progressively scrolls to load up to 60 cards
- `src/scraper.ts` extracted for testability — heuristic extraction: longest leaf text = title, time-unit pattern = age, short non-title/age = source
- `tests/fixtures/discover-mock.html` — mock DOM fixture matching real Google Discover structure
- 44 tests: 9 unit, 23 mock DOM scraping (no network), 7 L3 protocol, 5 L4 reliability
- Auth: `browserkit login google-discover` uses real Chrome via `channel:"chrome"` to bypass Google's bot detection; `isLoggedIn` no longer navigates during polling (fixed redirect loop bug)
- `browserkit.config.js` updated with `channel:"chrome"` and `deviceEmulation:"Pixel 5"` for google-discover

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
