# browserkit

An open-source framework for building site-specific MCP servers that operate over real, authenticated user browser sessions — running locally on your machine.

**Turn your logged-in browser sessions into composable, testable AI tools.**

---

## Why local sessions?

Cloud browser automation services work by running browsers on their servers and asking you to re-authenticate there. That model works well for anonymous or company-owned accounts, but breaks down for personal ones — you wouldn't hand your LinkedIn, Gmail, or bank credentials to a third-party server.

browserkit takes the opposite approach: **your machine is already authenticated everywhere.** It reuses the sessions that exist on your laptop right now, runs all browsers locally, and never sends cookies or credentials over the network. The AI gets access to your real identity on the web; nothing leaves localhost.

The trade-off is intentional — browserkit is single-user and local-only by design. If you need a cloud fleet or multi-tenant access, this is not that tool.

---

## Quick Start

```bash
# Install core + adapters
pnpm add @browserkit/core @browserkit/adapter-hackernews @browserkit/adapter-linkedin

# Log in once per authenticated site (opens a browser window)
browserkit login linkedin

# Start the daemon
browserkit start --config browserkit.config.js
```

Configure your MCP client (Cursor, Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "browserkit-hackernews": { "url": "http://localhost:3847/mcp" },
    "browserkit-linkedin":   { "url": "http://localhost:3848/mcp" }
  }
}
```

---

## Available Adapters

| Package | Site | Auth | Tools |
|---|---|---|---|
| [`@browserkit/adapter-hackernews`](https://github.com/browserkit-dev/adapter-hackernews) | Hacker News | none | `get_top`, `get_new`, `get_ask`, `get_show`, `get_comments` |
| [`@browserkit/adapter-linkedin`](https://github.com/browserkit-dev/adapter-linkedin) | LinkedIn | required | `get_person_profile`, `get_company_profile`, `get_company_posts`, `search_people`, `search_jobs`, `get_job_details`, `get_feed` |
| [`@browserkit/adapter-reddit`](https://github.com/browserkit-dev/adapter-reddit) | Reddit | none | `get_subreddit`, `get_thread`, `search`, `get_user` |

---

## How It Works

Each adapter runs as a **dedicated MCP HTTP server** on its own port. Multiple AI agents can connect concurrently — requests are serialized per adapter to protect the browser session.

```
AI Agent (Cursor / Claude / custom)
         ↓ HTTP MCP
browserkit daemon
  ├── hackernews  :3847  headless Chromium  (public, no auth needed)
  ├── linkedin    :3848  headless Chrome    (authenticated, uses real Chrome)
  └── ...
```

Browsers run **fully headless by default** — no window, no Dock icon. They only surface visibly during login (`browserkit login`) or when you explicitly switch to `watch` or `pause` mode.

---

## Configuration

```javascript
// browserkit.config.js
export default {
  host: "127.0.0.1",        // bind address (non-localhost requires bearerToken)
  basePort: 3847,           // first adapter auto-assigns from here
  bearerToken: process.env.BROWSERKIT_TOKEN,  // optional auth

  adapters: {
    // key = npm package name (no naming convention required)
    "@browserkit/adapter-hackernews": {
      port: 3847,
    },
    "@browserkit/adapter-linkedin": {
      port: 3848,
      channel: "chrome",    // use real Chrome — avoids bot detection on login
    },
    "@someone/my-custom-adapter": {
      port: 3849,
      debugPort: 4849,      // optional: enables raw Playwright access via CDP
      authStrategy: "persistent",   // "persistent" | "storage-state" | "cdp-attach"
      rateLimit: { minDelayMs: 3000 },
    },
  },
};
```

---

## CLI

```
browserkit start [--adapter <pkg>] [--port <n>] [--config <path>]
browserkit login <site>           # one-time login (opens browser)
browserkit status                 # show running adapters
browserkit config cursor          # generate Cursor MCP settings JSON
browserkit create-adapter <name>  # scaffold a new adapter package
```

---

## Tools on Every Adapter Server

Each adapter exposes its own domain tools plus these auto-registered tools:

### Domain tools (adapter-specific)
Whatever the adapter declares — e.g. `get_feed`, `search_people`, `get_top`.

### Browser control (auto-registered, bypass lock)
| Tool | Description |
|---|---|
| `set_mode` | Switch between `headless`, `watch` (visible), `paused` (user control) |
| `take_screenshot` | Capture current page as inline image — AI can see it directly |
| `get_page_state` | URL, title, mode, CDP endpoint for raw access |
| `navigate` | Navigate to a URL (within lock) |
| `health_check` | Browser alive, login status, selector validation report |

---

## Browser Modes

```
headless  →  fully invisible, automation runs normally (default)
watch     →  browser becomes visible, automation continues (optional slowMoMs)
paused    →  browser visible, tool calls queue — user has manual control
```

Switch modes via the `set_mode` MCP tool from any AI agent.

---

## Raw Playwright Access (via CDP)

When `debugPort` is configured, `get_page_state` returns a `cdpUrl`. External agents — Claude Code, Cursor, custom scripts — can attach to the **already-authenticated** browser session and run arbitrary Playwright code:

```javascript
// Script written by Claude Code, executed via shell
const { chromium } = require('playwright');

// Attach to the running session — already logged in, no auth needed
const browser = await chromium.connectOverCDP("http://127.0.0.1:4848");
const context = browser.contexts()[0];
const page = context.pages()[0];

// Full Playwright API — write any automation
await page.goto("https://my-site.com/data");
const results = await page.$$eval(".row", (els) => els.map((el) => el.textContent?.trim()));
console.log(JSON.stringify(results));

await browser.disconnect(); // disconnect only — session stays alive
```

Pattern: AI writes a script to `/tmp/script.js`, runs it via shell, reads stdout.

Enable in config: `debugPort: adapterPort + 1000` (e.g. adapter on 3848 → debugPort 4848).

---

## Building an Adapter

### Reference implementations

- [`browserkit-dev/adapter-hackernews`](https://github.com/browserkit-dev/adapter-hackernews) — public site, no auth, 5 tools, full 4-layer test suite. The simplest starting point.
- [`browserkit-dev/adapter-linkedin`](https://github.com/browserkit-dev/adapter-linkedin) — authenticated site, 7 tools, `innerText` extraction strategy + ARIA-anchor feed scraping. Good reference for adapters that need login and work against DOM-churning JS apps.

### Scaffold

```bash
npx @browserkit/core create-adapter my-site
cd adapter-my-site
pnpm install
```

This generates the full package structure: `src/index.ts`, `src/selectors.ts`, `vitest.config.ts`, `package.json`, `README.md`.

### SiteAdapter interface

```typescript
import { defineAdapter } from "@browserkit/core";
import { z } from "zod";
import type { Page } from "playwright";

export default defineAdapter({
  // ── Required ────────────────────────────────────────────────────────────
  site: "my-site",                          // unique ID, becomes the MCP server name
  domain: "my-site.com",                    // used for profile scoping
  loginUrl: "https://my-site.com/login",    // where to navigate for login flow

  async isLoggedIn(page: Page): Promise<boolean> {
    // Return true when the page shows an authenticated state.
    // Called before every tool call. If it returns false, browserkit
    // triggers the human handoff flow (opens browser, waits for login).
    // For public sites (no auth), always return true.
    return page.getByRole("navigation", { name: "user menu" }).isVisible({ timeout: 3000 });
  },

  tools: () => [ /* see below */ ],

  // ── Optional ────────────────────────────────────────────────────────────
  rateLimit: { minDelayMs: 2000 },          // min delay between consecutive tool calls

  selectors: {                              // exported CSS selectors for health_check reporting
    mainContent: ".main-content",           // health_check validates these on the live page
    loginButton: "button[data-testid=login]",
  },
});
```

### Tool definition

```typescript
tools: () => [
  {
    name: "get_data",
    description: "Get data from my-site",

    // Zod schema — validated before handler is called
    inputSchema: z.object({
      query: z.string().describe("Search query"),
      limit: z.number().int().min(1).max(50).default(10),
    }),

    // handler receives: the live authenticated Page + validated input
    async handler(page: Page, input: unknown) {
      const { query, limit } = mySchema.parse(input); // use schema.parse for type safety

      await page.goto(`https://my-site.com/search?q=${encodeURIComponent(query)}`);
      await page.waitForSelector(".result", { timeout: 10_000 });

      const results = await page.evaluate(({ sel, n }) => {
        return Array.from(document.querySelectorAll(sel))
          .slice(0, n)
          .map((el) => el.textContent?.trim() ?? "");
      }, { sel: ".result", n: limit });

      // Return value must have this shape:
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
        // isError: true  — set this if the tool failed but you want to return a message
      };
    },
  },
],
```

**Tool handler contract:**
- `page` is a live Playwright `Page` — already navigated, already authenticated
- `input` is the validated result of your Zod schema — always parse it inside the handler for type safety
- Return `{ content: [{ type: "text", text: string }] }` for text results
- Return `{ content: [{ type: "image", data: base64, mimeType: "image/png" }] }` for images
- Return `{ content: [...], isError: true }` to signal a tool-level error without crashing

### Testing your adapter

Use `@browserkit/core/testing` to write tests that spin up a real in-process server:

```typescript
// tests/mcp-protocol.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import myAdapter from "../src/index.js";
import { createTestAdapterServer, createTestMcpClient } from "@browserkit/core/testing";

let server, client;

beforeAll(async () => {
  server = await createTestAdapterServer(myAdapter);
  client = await createTestMcpClient(server.url);
}, 30_000);

afterAll(async () => {
  await client.close();
  await server.stop();
});

it("get_data returns results", async () => {
  const result = await client.callTool("get_data", { query: "test" });
  expect(result.isError).toBeFalsy();
  const data = JSON.parse(result.content[0].text);
  expect(Array.isArray(data)).toBe(true);
});
```

`createTestAdapterServer` launches the adapter with an isolated temp data directory (avoids pidfile conflicts with a running daemon). `createTestMcpClient` connects via the real MCP HTTP transport — the same path used by Cursor and Claude Desktop.

For a complete 4-layer example, see [`browserkit-dev/adapter-hackernews/tests/`](https://github.com/browserkit-dev/adapter-hackernews/tree/main/tests).

### Publish

```bash
pnpm build
npm publish --access public
```

Users add the package name to `browserkit.config.js` — no naming convention required. Any npm package name works.

---

## Planned Adapters

Community contributions welcome — use `browserkit create-adapter <name>` to scaffold, see [Building an Adapter](#building-an-adapter) above.

| Site | Why browserkit | Proposed tools | Status |
|---|---|---|---|
| **Twitter / X** | API is $100/mo+; most personal accounts have no API access | `get_feed`, `search`, `get_thread`, `get_bookmarks`, `get_dms`, `get_lists` | open |
| **Amazon** | No consumer API at all | `get_orders`, `search_products`, `get_product`, `get_wishlist`, `track_price` | open |
| **Airbnb** | No public API; useful for trip-planning agents | `search_listings`, `get_listing`, `get_bookings`, `get_messages` | open |
| **Google Maps** | Places API is expensive per-call; browser is free | `search_nearby`, `get_place`, `get_reviews`, `get_directions` | open |

If you're interested in building one, open an issue on [browserkit-dev/browserkit](https://github.com/browserkit-dev/browserkit/issues) to coordinate.

---

## Architecture

See [ARCH.md](ARCH.md) for full architecture details.

Key properties:
- **Session-persistent**: maintains auth across tool calls and process restarts
- **Site-specific**: deterministic selector-based tools, not DOM-guessing agents
- **MCP-native**: each adapter is a standard HTTP MCP server
- **Human-in-the-loop**: opens browser for login, 2FA, CAPTCHA
- **Multi-client**: multiple AI agents can connect to the same adapter concurrently

---

## License

MIT
