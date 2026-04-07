# AGENTS.md — Workspace Memory

Durable facts and correction patterns for this workspace. Updated by continual-learning.

## Project: browserkit

- Project is named **browserkit** — decided and final. npm scope is `@browserkit-dev`. GitHub org is `browserkit-dev` (`browserkit` org name was taken on both GitHub and npm; `@browserkit-dev` is the npm scope in use).
- GitHub repos: `browserkit-dev/browserkit` (framework — `@browserkit-dev/core` + `@browserkit-dev/core/testing`), `browserkit-dev/adapter-hackernews`, `browserkit-dev/adapter-google-discover`, `browserkit-dev/adapter-linkedin` — all standalone public repos
- Language is TypeScript, not Python
- MCP transport is HTTP (`StreamableHTTPServerTransport`), not stdio — preferred for multi-agent deployment
- Each adapter gets its own HTTP port; each connecting MCP client gets its own `McpServer + StreamableHTTPServerTransport` pair (per-session factory inside the HTTP handler). Shared state (browser, lock, rate limiter) lives outside the McpServer.
- All adapters share one daemon process — restarting the daemon to reload one adapter takes all adapters down. Use `browserkit reload <site>` to restart just one adapter's MCP server without stopping the daemon (browser session preserved).
- Adapter packages are plain npm packages with no naming convention — config keys are npm package names, resolved via `require(key)`
- Adapters live in external git repos as standalone packages; the monorepo's `adapter-linkedin` is gitignored (local dev copy of the published repo)
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
- The Playwright skill pattern: AI writes a script to `/tmp`, executes it via shell — primary approach for shell-capable clients (Cursor, Claude Code); opt-in `run_script` MCP tool planned for clients without shell access (Claude Desktop) — opt-in because Cursor/Claude Code already have shell, only Claude Desktop needs it
- MCP resources use `page://${site}/snapshot` (site name dynamic) — user pushed back when the URI appeared to hardcode the adapter name
- Testing utilities (`createTestAdapterServer`, `createTestMcpClient`) live at `@browserkit-dev/core/testing` subpath — a separate harness package was explicitly rejected ("I don't think we need it, it should be in either adapter or in core")
- Real Chrome (`channel: "chrome"`) is required for Google-based adapters — Playwright's bundled Chromium is blocked by Google's login with "This browser or app may not be secure". `isLoggedIn` must NOT navigate during login polling or it redirects the user away from the sign-in page.
- Google Discover has NO infinite scroll in automated browser contexts — confirmed with Pixel 5, Pixel 7, both headless and watch mode, both `window.scrollBy` and `mouse.wheel`. ~10 articles is the practical ceiling per call. Do NOT mention this limitation in marketing content.
- Patchright (drop-in Playwright replacement) **has been implemented** in core and all adapters — removes `Runtime.enable` CDP leak, `Console.enable` leak, and `--enable-automation` flag. Same API as Playwright; just change the import. `channel: "chrome"` still recommended on top of Patchright for Google-based adapters.
- LinkedIn adapter was rebuilt 1:1 with `stickerdaniel/linkedin-mcp-server`: innerText + URL navigation (not DOM selectors), section-based architecture, 7 tools (`get_person_profile`, `get_company_profile`, `get_company_posts`, `search_people`, `search_jobs`, `get_job_details`, `get_feed`). `isAuthBlockerUrl` + `detectAuthBarrier` promoted to `@browserkit-dev/core` as generic utilities.
- CSS class selectors break on JS-heavy apps (LinkedIn proved this) — prefer `page.evaluate()` + ARIA-label walk-up from stable action buttons, or raw `innerText` extraction. This is now in the `create-adapter` scaffold template.
- Framework navigates to `adapter.loginUrl` before calling `isLoggedIn()` when browser is at `about:blank` — adapters do NOT need to handle this themselves
- `warm_up_browser()` (visiting google/wiki/github before login) was evaluated from stickerdaniel's code — decided as "nice to have" for first-time login, not adopted yet
- `browserkit login <site>` is blocked by the `CI=1` env var that Cursor sets — must run as `CI="" node packages/core/dist/cli.js login <site>` to open a headed browser from within Cursor terminal
- `browser` tool `snapshot` action is planned — returns incremental aria-snapshot diff, more token-efficient than screenshots; `page-snapshot` MCP resource already exists, the action adds diff support. Inspired by `SawyerHood/dev-browser`.
- CloakBrowser is an optional npm package integrated in the Booking.com adapter for DataDome/headless bot-detection bypass — opt-in via adapter config, no hard dependency on core; other stealth patches (Patchright) remain in place alongside it.

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
- Documentation for AI agents building adapters is a first-class concern — README must include the full `SiteAdapter` interface, testing pattern (`@browserkit-dev/core/testing`), and a link to the HN adapter as a reference
- Cursor uses `.cursor/mcp.json` for project-level MCP config; `.mcp.json` is the Claude Code format — these are different files serving different tools
- E2E install tests are wanted: spin up a clean environment, install core + HN adapter, verify tools work, install Google Discover adapter, verify it starts but returns auth error (no login)
- Squash CI fix commits to keep git history clean — user noticed multiple "fix CI" commits and asked to squash
- Adapter roadmap priority: Reddit → Twitter/X (flagship, hardest bot detection) → Amazon (no consumer API at all) → Airbnb, Google Maps, Booking.com — all documented in the main README as planned adapters.
- Reddit adapter is two-phase: Phase 1 = unauthenticated `old.reddit.com` (stable HTML class names, no login required); Phase 2 = authenticated (separate plan file). Target `old.reddit.com` exclusively — new Reddit is a React SPA with aggressive DOM churn.
- Booking.com adapter was started (plan + Phase 1 architecture); user preference is to plan architecture first, then implement.
- Phased adapter development pattern: Phase 1 is unauthenticated/mock, Phase 2 is authenticated/live. Add verification gates between phases.
- Live scraping tests should run in GitHub CI via an external browser service (desired; specific service not yet chosen).
- The main browserkit README doubles as the project's public-facing "blogpost" — user refers to it interchangeably; keep it polished and up-to-date with available + planned adapters
- Personal adapters (outside the browserkit org) live in `jonzarecki/` GitHub repos — e.g., the rescue-flights adapter (Israir + El Al) is at `jonzarecki/` and must not appear in `browserkit-dev/` repos or CI
- Verification harness convention: `make agent-check` runs browser-snapshot-based checks and loops until they pass — add to `CLAUDE.md` of each adapter and run after every change

## Rescue-Flights Adapter (Personal)

- Source `.ts` files are NOT in the local workspace — only compiled `dist/` JS exists at `packages/adapter-rescue-flights/dist/`; the source lives in the `jonzarecki/` GitHub repo
- Runs locally at port 52746; registered in `.cursor/mcp.json` as `"rescue-flights"` (local config only, not committed to monorepo)
- **Israir tool**: `detailUrl`, `flightNumber`, and `departureTime` are only populated when `availableSeats > 0`; sold-out flights return empty strings for those fields
- **Israir `buildDetail()` bug**: guard `if (!available || !price)` is overly strict — flights with seats but no price get no booking link; fix is to change to `if (!available)` (1-line change, zero risk)
- **El Al tool**: always returns `flightNumber` and `departureTime` for all flights (including sold-out); `detailUrl` links to the seat-availability page (`?d=0` from Israel / `?d=1` to Israel) — El Al booking pages all return 403 (session tokens required), so the availability page is the best accessible link
- **El Al virtual scroll bug**: Angular virtual scroll recycles DOM nodes on scroll-back — must collect flight data incrementally *during* each scroll step (not after); single-pass post-scroll extraction returns only the currently-visible rows (~7 flights vs 168+ total)
- **Coverage difference**: El Al covers the next 8 days only; Israir covers 30+ days ahead
- El Al scraper returns `ERR_ABORTED` when called concurrently with Israir — run the two scrapers sequentially to avoid
- **Israir booking URL** format: `https://www.israir.co.il/he-IL/reservation/deal/searchFlight/abroadFlight?destCode=TLV&departDate=...&fNumbers=...&sessionId=...` — the `sessionId` is live-session-scoped and expires; cannot be reused outside the active browser session
- **Verification preference**: use the adapter's own headless Patchright browser (not the cursor-ide-browser MCP) for rescue-flights verification — user stated strong preference ("I prefer it immensely")

## Versioning

### @browserkit-dev/core

Follows semver. During 0.x, treat minor bumps as potentially breaking for consumers.

- **patch** (`0.1.x`): bug fixes, log/doc changes, internal refactors with no public API change.
  - Examples: fix a crash in `waitUntil`, fix a typo in an error message, optimize `scrollContainer`.
  - Rule: **no adapter needs to change any code** after updating core.

- **minor** (`0.x.0`): new features, new optional fields on `SiteAdapter`, new exported utilities, new CLI commands.
  - Examples: add `withLoginFlow`, add `minCoreVersion?` to `SiteAdapter`, add `browserkit doctor`.
  - Rule: **existing adapters compile and run without changes** (purely additive).

- **major** (`x.0.0`): breaking changes — removed exports, renamed functions, required new fields on `SiteAdapter`, changed tool-call contracts.
  - Examples: rename `detectRateLimit` → `detectChallenge`, make `minCoreVersion` required, remove `scrollContainer`.
  - Rule: **at least one published adapter must change source code** to compile against the new version.

**Decision shortcut**: run `test-adapters.yml` after your change (or locally build each adapter against the new core). If all 5 pass without code changes → patch or minor. If any fails → major (or the failing adapter's peer dep range was already wrong).

### Adapter packages (`@browserkit-dev/adapter-*`)

Same semver rules, but "breaking" means "an MCP tool's public interface changed":

- **patch**: bug fix, selector update, scraping logic change — no tool name/input/output signature change.
- **minor**: new tool added, new optional input field on an existing tool, new optional output field.
- **major**: tool removed or renamed, required input field added, output field removed or type-changed.

### Changeset workflow (required for every PR that changes behavior)

```bash
# In the monorepo (core changes)
pnpm changeset

# In an adapter repo
npx changeset
```

When prompted: choose `patch` / `minor` / `major` per the rules above, then write a one-sentence user-facing summary (what changed for users, not how it was implemented). Commit the generated `.changeset/*.md` file in the same PR.

The Release GitHub Action handles version bumping and `npm publish` automatically when the changeset PR is merged to `main`.

## CI Discipline

**After every significant change, verify CI passes before considering the task done.**

"Significant" means: any commit that touches `packages/core/src/`, adapter source files, `.github/workflows/`, `package.json` deps, or any change that gets pushed to `main`.

### How to check

```bash
# Monorepo CI (unit + E2E):
gh run list --repo browserkit-dev/browserkit --workflow=ci.yml --limit 1 --json status,conclusion

# All repos at once:
for repo in browserkit adapter-hackernews adapter-google-discover adapter-linkedin adapter-reddit adapter-booking; do
  r=$(gh run list --repo browserkit-dev/$repo --workflow=ci.yml --limit 1 --json status,conclusion --jq '.[0] | "\(.status) \(.conclusion)"')
  echo "$repo: $r"
done
```

### If CI fails

1. Read the failing step logs: `gh api repos/browserkit-dev/<repo>/actions/runs/<run_id>/jobs`  
2. Fix the root cause (don't push empty retrigger commits to mask real failures)  
3. Push the fix and wait for green before closing out the task

### Known flaky test

`tests/e2e/smoke.test.ts > Phase 1 > get_top returns real HN articles` occasionally fails with `net::ERR_ABORTED` when GitHub Actions IPs are rate-limited by HN. If **only** this test fails and the error is a network error (not a code error), retrigger once. If it fails twice in a row, investigate whether HN's DOM changed.
