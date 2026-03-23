# Architecture

## Overview

browserkit is a local-first framework for building site-specific MCP servers over real authenticated user browser sessions. Each adapter runs as a dedicated MCP HTTP server. Multiple AI agents can connect concurrently — the framework handles session persistence, locking, rate limiting, and human handoff.

## Package Structure

```
browserkit/                          # monorepo root
├── packages/
│   ├── core/                         # @browserkit/core (published)
│   │   └── src/
│   │       ├── types.ts              # SiteAdapter, ToolDefinition, FrameworkConfig
│   │       ├── define-adapter.ts     # defineAdapter() — type-safe adapter factory
│   │       ├── define-config.ts      # defineConfig() — config validation
│   │       ├── session-manager.ts    # Playwright lifecycle, auth, CDP endpoint
│   │       ├── lock-manager.ts       # FIFO async mutex per adapter
│   │       ├── rate-limiter.ts       # min-delay enforcement between calls
│   │       ├── human-handoff.ts      # background re-auth, login command flow
│   │       ├── adapter-server.ts     # per-adapter McpServer factory (per-session), HTTP transport
│   │       ├── adapter-utils.ts      # validateSelectors, screenshotOnError, etc.
│   │       ├── observability.ts      # Playwright traces, a11y snapshots
│   │       ├── server.ts             # orchestrator: load adapters, start servers
│   │       ├── create-adapter.ts     # scaffolding for new adapter packages
│   │       └── cli.ts                # start | login | status | config | create-adapter
│   ├── adapter-linkedin/             # @browserkit/adapter-linkedin (reference impl)
│   ├── adapter-hackernews/           # @browserkit/adapter-hackernews (demo adapter)
│   └── harness/                      # @browserkit/harness (test utilities, private)
│       └── src/
│           ├── test-server.ts        # createTestAdapterServer() — isolated in-process server
│           └── mcp-client.ts         # createTestMcpClient() — typed MCP HTTP test client
├── browserkit.config.js             # local config (gitignored credentials)
└── docs/reference/                   # research notes
```

Adapter packages live in **their own git repos**, not inside this monorepo. The `adapter-linkedin` package is the reference implementation showing the expected structure.

## Deployment Model

```
browserkit start   →   one Node.js process
                         │
                         ├── linkedin  :3847  MCP HTTP server
                         │   └── Chromium (headless, persistent profile)
                         ├── shufersal :3848  MCP HTTP server
                         │   └── Chromium (headless, persistent profile)
                         └── status sidecar :3846
```

Multiple AI agents (Cursor windows, Claude Desktop, custom scripts) connect over HTTP to whichever adapters they need. All requests to the same adapter are serialized by `LockManager`.

## Components

### SessionManager

- One Playwright `launchPersistentContext` per adapter (headless by default)
- Auth state on disk at XDG data dir (`~/Library/Application Support/browserkit/` on macOS)
- `setMode(site, mode, slowMoMs?)`: close/reopen with headless or headed + optional slowMo
- `getCdpUrl(site)`: returns `http://127.0.0.1:debugPort` if `debugPort` was configured
- `injectStorageState(site, cookies, origins)`: transfers auth from temp browser to running session

### SiteAdapter

```typescript
interface SiteAdapter {
  readonly site: string;           // unique id → MCP server name
  readonly domain: string;         // e.g. "linkedin.com"
  readonly loginUrl: string;       // where to navigate for login
  readonly rateLimit?: { minDelayMs: number };
  tools(): ToolDefinition[];
  isLoggedIn(page: Page): Promise<boolean>;
}
```

No abstract base class — `SiteAdapter` is a plain interface. Shared helpers live in `adapter-utils.ts` as standalone functions.

### AdapterServer

Each adapter gets its own `McpServer` + `StreamableHTTPServerTransport` **per connecting client**. When an MCP client sends `initialize`, the HTTP server creates a fresh `McpServer + StreamableHTTPServerTransport` pair keyed by the session ID. All sessions share the same underlying browser, `LockManager`, and `RateLimiter` — the McpServer per-session only separates protocol state. Auto-registered tools on every adapter:

| Tool | Lock? | Description |
|---|---|---|
| `set_mode` | No | Switch `headless` / `watch` / `paused` |
| `take_screenshot` | No | Capture page as inline image |
| `get_page_state` | No | URL, title, mode, CDP endpoint |
| `health_check` | No | Login status, selector report |
| `navigate` | Yes | Navigate to URL (within lock) |

### LockManager

FIFO async mutex per adapter key. Tool calls queue behind it. `holdForUser` / `releaseUserHold` supports `paused` mode (held by the AI on behalf of the user).

### HumanHandoff

Two flows:
- **`browserkit login <site>`**: opens browser on same profile dir (captures everything), polls `isLoggedIn()`, closes when done
- **Mid-session re-auth**: opens temporary headed browser on fresh temp dir, transfers `storageState` into running headless context, no downtime

## Raw Playwright Access via CDP

When `debugPort` is configured, the adapter's browser launches with `--remote-debugging-port=debugPort`. External agents can attach to the **already-authenticated** session:

```javascript
// Claude Code writes this, executes via shell
const { chromium } = require("playwright");
const browser = await chromium.connectOverCDP("http://127.0.0.1:4847");
const context = browser.contexts()[0]; // authenticated
const page = context.pages()[0];
// full Playwright API — arbitrary automation
await browser.disconnect(); // disconnect only — session stays alive
```

This follows the [Playwright skill pattern](https://github.com/lackeyjb/playwright-skill): AI writes a script to `/tmp`, runs it via shell, reads stdout. The browserkit difference: the browser is already authenticated — no login step needed.

**When to use raw access:**
- Ad-hoc tasks on a site without a pre-built adapter
- Exploring what a site supports before writing formal adapter tools
- Operations too complex for the adapter's current tool set

**When to use adapter tools:**
- Common recurring operations (faster, reliable, tested, no token overhead)
- When deterministic selector-based extraction is needed

Enable in config: set `debugPort` to `adapterPort + 1000` (e.g. `4847` for adapter on `3847`).

## Browser Mode State Machine

```
headless  (default, invisible)
    ↕  set_mode
watch     (visible, automation continues, optional slowMoMs)
    ↕  set_mode
paused    (visible, LockManager held, user drives manually)
```

All transitions use `SessionManager.setMode()` which closes and reopens the persistent context with the correct `headless` and `slowMo` flags.

## Auth Strategies

| Strategy | Use case | How it works |
|---|---|---|
| `persistent` (default) | Most sites | `launchPersistentContext(profileDir)` — full browser state on disk |
| `storage-state` | CI / testing | Export/import cookies + localStorage as JSON |
| `cdp-attach` | User manages Chrome | `connectOverCDP(url)` — attach to running browser |

## Key Technical Decisions

- **TypeScript**, not Python — native Playwright types, npm ecosystem
- **HTTP MCP** (`StreamableHTTPServerTransport`), not stdio — multi-agent, persistent daemon
- **Per-adapter MCP server** — each adapter gets its own port; tools are not namespaced (server name is the namespace)
- **No naming convention** for adapter packages — config keys are npm package names (`require(key)`)
- **Headless by default** — no visible window; headed only for login, watch mode, pause mode
- **No Docker** — headed browser + human handoff requires native display (X11/XQuartz adds too much friction)
- **CDP over Playwright WS** for raw access — stable, documented, compatible with any CDP tool

## Open Architectural Questions

### Shared authentication profiles across adapters

Today each adapter gets its own persistent browser profile, keyed by `site` name. This means multiple adapters for the same service (e.g. `adapter-google-discover`, `adapter-gmail`, `adapter-gcal`) would each require a separate login even though they share the same authentication domain (`*.google.com`).

A future improvement would be a `sharedProfile` field in `AdapterConfig` — adapters that specify the same `sharedProfile` key share a single persistent profile directory. The `SessionManager` would manage the shared profile as a first-class concept. This would also allow `authStrategy: "cdp-attach"` to reuse a running session across adapters.

**Deferred until there are at least two adapters that need the same login.**
