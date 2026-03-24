# AGENTS.md — Workspace Memory

Durable facts and correction patterns for this workspace. Updated by continual-learning.

## Project: browserkit

- Project is named **browserkit** — decided and final. npm scope is `@browserkit`. GitHub org is `browserkit-dev` (`browserkit` org was taken on GitHub, available on npm).
- GitHub repos: `browserkit-dev/browserkit` (framework — `@browserkit/core` + `@browserkit/core/testing`), `browserkit-dev/adapter-hackernews` (standalone adapter repo), `browserkit-dev/adapter-google-discover` (private — not ready)
- Language is TypeScript, not Python
- MCP transport is HTTP (`StreamableHTTPServerTransport`), not stdio — preferred for multi-agent deployment
- Each adapter gets its own HTTP port; each connecting MCP client gets its own `McpServer + StreamableHTTPServerTransport` pair (per-session factory inside the HTTP handler). Shared state (browser, lock, rate limiter) lives outside the McpServer.
- All adapters share one daemon process — restarting the daemon to reload one adapter takes all adapters down. Use `browserkit reload <site>` to restart just one adapter's MCP server without stopping the daemon (browser session preserved).
- Adapter packages are plain npm packages with no naming convention — config keys are npm package names, resolved via `require(key)`
- Adapters live in external git repos as standalone packages; the monorepo's `adapter-linkedin` is a reference implementation only
- No abstract base class for adapters — `SiteAdapter` is an interface, shared logic is standalone utility functions (composition over inheritance)
- No Docker — headed browser + human handoff requires native display; Docker needs X11/XQuartz which breaks local-first UX
- Correct spelling is **adapter** (not adaptor)

## Browser Lifecycle

- Default: fully headless — no visible window, no Dock icon
- Headed browser opens only for: `browserkit login <site>` command, watch mode, pause mode
- Login when server not running: same profile dir (captures everything including IndexedDB)
- Login when server is running: temporary headed browser on fresh temp profile, storageState transfer into running headless context (zero downtime)
- Startup warns about unauthenticated adapters and continues (does not block)
- Session expiry mid-use: auto-retry in background — opens temp headed browser, transfers cookies when login detected

## Browser Control

- Browser mode switching (`headless` / `watch` / `paused`), screenshot, page state, and navigate are consolidated into a single `browser` MCP tool with an `action` parameter — user explicitly asked to reduce tool count ("too many tools"); do NOT revert to 5 separate management tools
- Management tools bypass the LockManager; regular automation tools go through it
- "Raw" Playwright access means exposing the CDP WebSocket URL (`wsEndpoint()`) of each adapter's browser — external agents (Claude Code, Cursor) attach to the already-authenticated session and write their own Playwright scripts via shell
- The Playwright skill pattern: AI writes a script to `/tmp`, executes it via shell — no `run(code)` MCP tool needed
- MCP resources use `page://${site}/snapshot` (site name dynamic) — user pushed back when the URI appeared to hardcode the adapter name
- Testing utilities (`createTestAdapterServer`, `createTestMcpClient`) live at `@browserkit/core/testing` subpath — a separate harness package was explicitly rejected ("I don't think we need it, it should be in either adapter or in core")
- Real Chrome (`channel: "chrome"`) is required for Google-based adapters — Playwright's bundled Chromium is blocked by Google's login with "This browser or app may not be secure". `isLoggedIn` must NOT navigate during login polling or it redirects the user away from the sign-in page.
- Google Discover has NO infinite scroll in automated browser contexts — confirmed with Pixel 5, Pixel 7, both headless and watch mode, both `window.scrollBy` and `mouse.wheel`. ~10 articles is the practical ceiling per call. Do NOT mention this limitation in marketing content.
- Patchright (drop-in Playwright replacement) is the next step for LinkedIn adapter — removes `Runtime.enable` CDP leak and other automation signals that authenticated sites detect. `channel: "chrome"` already covers some of the same ground for Google.

## Design Process Preferences

- User pushes back on recommendations blindly following research sources — "do not take anything as granted from the sources, it's a recommendation at best"
- User prefers reasoning through design decisions before implementation (brainstorming phase)
- Vertical slice approach rejected — user prefers abstraction-first (framework is the product, not the first adapter)
- When user provides inline decisions like `option || do this`, implement exactly what is specified
- HackerNews used as the first demo adapter (Shufersal is geo-blocked outside Israel)
- User prefers reviewing plans and code changes before execution starts — ask for review before implementing
- Testing preference: all 4 layers (unit, scraping integration, MCP protocol, reliability) — user said "all of those" without hesitation; don't propose a subset
- Bugs found during testing should be fixed inline ("fix issues on the go"), not deferred to a follow-up task
- Adapter developers should minimize visible dependency on the framework — adapters should feel like standalone npm packages, not framework plugins
- Documentation for AI agents building adapters is a first-class concern — README must include the full `SiteAdapter` interface, testing pattern (`@browserkit/core/testing`), and a link to the HN adapter as a reference
- Cursor uses `.cursor/mcp.json` for project-level MCP config; `.mcp.json` is the Claude Code format — these are different files serving different tools
- E2E install tests are wanted: spin up a clean environment, install core + HN adapter, verify tools work, install Google Discover adapter, verify it starts but returns auth error (no login)
- Squash CI fix commits to keep git history clean — user noticed multiple "fix CI" commits and asked to squash
