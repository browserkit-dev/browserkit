# browserkit

> **Note:** The name "browserkit" is a working title. See SPEC.md for the full product vision.

An open-source framework for building site-specific MCP servers that operate over real, authenticated user browser sessions — running locally on your machine.

**Turn your logged-in browser sessions into composable, testable AI tools.**

---

## Quick Start

```bash
# Install core + an adapter
pnpm add @browserkit/core @browserkit/adapter-hackernews

# Log in once (for sites that need auth)
browserkit login hackernews

# Start the daemon
browserkit start --config browserkit.config.js
```

Configure your MCP client (Cursor, Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "browserkit-hackernews": {
      "url": "http://localhost:3847/mcp"
    }
  }
}
```

---

## How It Works

Each adapter runs as a **dedicated MCP HTTP server** on its own port. Multiple AI agents can connect concurrently — requests are serialized per adapter to protect the browser session.

```
AI Agent (Cursor / Claude / OpenClaw)
         ↓ HTTP MCP
browserkit daemon
  ├── linkedin  :3847  headless Chromium  (authenticated)
  ├── shufersal :3848  headless Chromium  (authenticated)
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
  bearerToken: process.env.SESSION_MCP_TOKEN,  // optional auth

  adapters: {
    // key = npm package name (no naming convention required)
    "@browserkit/adapter-linkedin": {
      port: 3847,
      debugPort: 4847,      // optional: enables raw Playwright access
    },
    "@someone/my-custom-adapter": {
      port: 3848,
      debugPort: 4848,
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

### Browser control (auto-registered, no lock)
| Tool | Description |
|---|---|
| `set_mode` | Switch between `headless`, `watch` (visible), `paused` (user control) |
| `take_screenshot` | Capture current page as inline image — AI can see it directly |
| `get_page_state` | URL, title, mode, CDP endpoint for raw access |

### Diagnostics (auto-registered, no lock)
| Tool | Description |
|---|---|
| `health_check` | Browser alive, login status, selector validation |

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
const browser = await chromium.connectOverCDP("http://127.0.0.1:4847");
const context = browser.contexts()[0];
const page = context.pages()[0];

// Full Playwright API — write any automation
await page.goto("https://linkedin.com/search/results/people/?keywords=Playwright");
await page.waitForSelector(".entity-result__title-text");
const names = await page.$$eval(
  ".entity-result__title-text",
  (els) => els.map((el) => el.textContent?.trim())
);
console.log(JSON.stringify(names));

await browser.disconnect(); // disconnect only — session stays alive
```

This is the pattern from the [Playwright skill for Claude Code](https://github.com/lackeyjb/playwright-skill):
1. AI writes a Playwright script to `/tmp/script.js`
2. AI executes it via shell: `node /tmp/script.js`
3. AI reads stdout for results

The difference: instead of launching a fresh unauthenticated browser, the script attaches to browserkit's existing authenticated session.

**When to use raw access vs adapter tools:**
- **Adapter tools**: common operations, reliable, fast, tested
- **Raw access**: one-off tasks, sites without an adapter, exploring what a site can do

### Enabling raw access

```javascript
// browserkit.config.js
export default {
  adapters: {
    "@browserkit/adapter-linkedin": {
      port: 3847,
      debugPort: 4847,   // ← enables CDP; recommended: adapterPort + 1000
    },
  },
};
```

---

## Building an Adapter

```bash
# Scaffold a standalone adapter (lives in its own repo)
npx @browserkit/core create-adapter my-site
cd adapter-my-site
pnpm install
# fill in src/selectors.ts and src/index.ts
pnpm test
npm publish
```

```typescript
// src/index.ts
import { defineAdapter } from "@browserkit/core";
import { z } from "zod";

export default defineAdapter({
  site: "my-site",
  domain: "my-site.com",
  loginUrl: "https://my-site.com/login",
  rateLimit: { minDelayMs: 2000 },

  async isLoggedIn(page) {
    return page.getByRole("navigation").isVisible({ timeout: 3000 });
  },

  tools: () => [
    {
      name: "get_data",
      description: "Get data from my-site",
      inputSchema: z.object({ query: z.string() }),
      async handler(page, { query }) {
        await page.goto(`https://my-site.com/search?q=${encodeURIComponent(query)}`);
        await page.waitForSelector(".result");
        const results = await page.$$eval(".result", (els) =>
          els.map((el) => el.textContent?.trim())
        );
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
      },
    },
  ],
});
```

Adapters are published as any npm package name — no naming convention required. Users reference the package name directly in `browserkit.config.js`.

---

## Architecture

See [ARCH.md](ARCH.md) for full architecture details.

Key properties:
- **Local-first**: runs on your machine, no cloud required
- **Session-persistent**: maintains auth across tool calls
- **Site-specific**: deterministic adapters, not DOM-guessing agents
- **MCP-native**: each adapter is a standard MCP HTTP server
- **Human-in-the-loop**: opens browser for login, 2FA, CAPTCHA
- **Testable**: tools are unit-testable without a live browser

---

## License

MIT
