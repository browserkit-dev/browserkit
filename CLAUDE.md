# browserkit

Open-source framework for building site-specific MCP servers over real authenticated user browser sessions. Turns your logged-in web sessions into composable, testable AI tools — locally.

## Repo layout

```
packages/
  core/           @browserkit-dev/core — the framework (published to npm)
  adapter-hackernews/   gitignored — clone of browserkit-dev/adapter-hackernews
  adapter-linkedin/     gitignored — clone of browserkit-dev/adapter-linkedin
  adapter-rescue-flights/  personal adapter, local-only (never in browserkit-dev org)
tests/
  e2e/            Full-daemon smoke tests (require Chromium)
.github/workflows/
  ci.yml          Unit tests (job: unit) + E2E smoke (job: e2e, needs: unit)
  release.yml     Changesets publish pipeline — publishes @browserkit-dev/core on merge
  test-adapters.yml  Matrix CI: tests all 5 external adapters after core releases
```

## Build & test

```bash
pnpm install
pnpm build        # builds core + workspace adapters
pnpm test         # unit tests across all workspace packages (192 tests)
pnpm test:e2e     # E2E smoke tests (requires Chromium — run after pnpm build)
pnpm lint         # tsc --noEmit across all packages
```

Individual packages:
```bash
pnpm --filter @browserkit-dev/core build
pnpm --filter @browserkit-dev/core test
```

## Architecture

- **`SessionManager`** — owns all browser contexts (one per adapter site), handles persistent profiles, headed/headless switching, storage-state injection
- **`SiteAdapter` interface** — adapters implement `site`, `domain`, `loginUrl`, `isLoggedIn()`, `tools()` — optional: `preparePage()`, `getLoginOptions()`, `minCoreVersion`, `requirements`
- **`createAdapterServer`** — wraps an adapter as an HTTP MCP server; each connecting client gets its own `McpServer + StreamableHTTPServerTransport`
- **`LockManager`** — FIFO serialization of tool calls per site; `holdForUser` for paused mode
- **`withLoginFlow`** — opt-in automated form-fill login; falls back to human-handoff if not configured
- See `ARCH.md` for full file tree, `SPEC.md` for product requirements

## External adapter repos (all under `browserkit-dev/`)

All 5 adapters are published on npm at `@browserkit-dev/adapter-*`:

| Adapter | Repo | npm |
|---------|------|-----|
| HackerNews | `browserkit-dev/adapter-hackernews` | `@browserkit-dev/adapter-hackernews@0.1.0` |
| Google Discover | `browserkit-dev/adapter-google-discover` | `@browserkit-dev/adapter-google-discover@0.1.0` |
| LinkedIn | `browserkit-dev/adapter-linkedin` | `@browserkit-dev/adapter-linkedin@0.1.0` |
| Reddit | `browserkit-dev/adapter-reddit` | `@browserkit-dev/adapter-reddit@0.1.0` |
| Booking.com | `browserkit-dev/adapter-booking` | `@browserkit-dev/adapter-booking@0.1.0` |

Local dev: clone any adapter into `packages/` — pnpm workspace links `@browserkit-dev/core` automatically.

## CI overview

```
browserkit-dev/browserkit  ci.yml
  job: unit     pnpm install → pnpm build → pnpm test
  job: e2e      (needs: unit) install Chromium → build → checkout HN adapter → pnpm test:e2e

browserkit-dev/adapter-*   ci.yml (all identical)
  npm ci → install Chromium → npm run build → npm test

browserkit-dev/browserkit  release.yml
  On push to main: changesets/action → version bump PR or npm publish

browserkit-dev/browserkit  test-adapters.yml
  After Release workflow succeeds: matrix job runs each adapter's CI against latest core
```

**After every significant change, verify CI is green** before closing out a task:
```bash
for repo in browserkit adapter-hackernews adapter-google-discover adapter-linkedin adapter-reddit adapter-booking; do
  r=$(gh run list --repo browserkit-dev/$repo --workflow=ci.yml --limit 1 --json status,conclusion --jq '.[0] | "\(.status) \(.conclusion)"')
  echo "$repo: $r"
done
```

Known flaky: `e2e > get_top returns real HN articles` fails with `net::ERR_ABORTED` when GitHub IPs are rate-limited by HN — retrigger once if only this test fails with a network error.

## Non-negotiables

- Strict typing — no `any` (TS)
- Every new module must have tests
- No `console.log` in committed code (use `getLogger()` from `logger.ts`)
- No hardcoded credentials — local-only, never committed
- No new top-level folders without updating `ARCH.md`
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- Every behavioral change needs a changeset (`pnpm changeset`) before merging to main

## How to work here

- `AGENTS.md` — durable workspace facts; read before starting a session
- `ARCH.md` — file tree and component map
- `.context/progress.md` — update after completing tasks
- `browserkit doctor --config browserkit.config.js` — check adapter compatibility

## Forbidden patterns

- No `any` types
- No hardcoded credentials anywhere
- No `console.log` (use `log.info()` / `log.warn()` / `log.error()`)
- No new top-level folders without updating `ARCH.md`
- No pushing to main without verifying CI passes
