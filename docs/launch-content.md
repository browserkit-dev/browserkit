# LinkedIn Post

---

The sites you actually care about have no public API. LinkedIn, your company wiki, your internal tools, your personalised news feeds — as a logged-in user you can freely use all of them. Your AI agent can't.

General-purpose browser agents ("AI that browses the web") exist, but they freestyle on the DOM and break on any UI change. Raw Playwright works, but you're on your own for session management, re-authentication, and MCP integration.

I built **browserkit** to close this gap.

It's an open-source TypeScript framework that turns your real authenticated browser sessions into deterministic, testable MCP tools — running locally on your machine.

The key design choices:

**Site-specific, not general-purpose.** Each adapter knows the site's structure. No guessing. Selector changes break one adapter, not everything.

**One login, forever.** `browserkit login mysite` opens a real Chrome window. You authenticate normally. The session is saved. Every subsequent call — including headless — reuses it. If it expires mid-use, a background browser re-authenticates without interrupting anything.

**Your session, your machine.** No cloud. No API keys for the sites you're accessing. No credentials stored anywhere.

Built two adapters to validate it:
- Hacker News (public, 5 tools, 4-layer test suite)
- Google Discover (Pixel 7 mobile emulation to access the personalised feed)

The framework is live: [github.com/browserkit-dev/browserkit](https://github.com/browserkit-dev/browserkit)

Building an adapter is ~200 lines of TypeScript. The framework handles sessions, auth, locking, rate limiting, and the MCP server.

---

# Blog Post

---

# browserkit: Turn Your Logged-In Browser Sessions Into MCP Tools

## The problem nobody talks about

The sites you actually care about — LinkedIn, your company's internal tools, your personalised news feeds — either have no public API or actively block scraping. As a logged-in user you can freely use all of them. Your AI agent can't.

General-purpose browser agents exist, but they "freestyle on the DOM." They're unreliable, break on any UI change, and produce unpredictable results because they're guessing at each step. The alternative is writing raw Playwright scripts — which works, but leaves you managing browser sessions, authentication state, and MCP integration yourself.

The key insight in browserkit's SPEC: **turn your logged-in session into a private, programmable API.**

Not a general-purpose DOM agent. Not a public API with rate limits and API keys. A deterministic, testable, site-specific tool that operates over your real session — the same one you already use every day.

## What it is

browserkit is an open-source TypeScript framework for building site-specific MCP servers that run over real, authenticated user browser sessions — locally on your machine.

You write an **adapter** (a small TypeScript package) that describes:

1. How to detect whether you're logged in
2. What tools to expose (with Zod schemas and Playwright handlers)

The framework handles everything else: session persistence, auth re-acquisition, request locking, rate limiting, the MCP HTTP server, test utilities.

```
AI Agent (Cursor / Claude Desktop / custom)
         ↓ HTTP MCP
browserkit daemon
  ├── hackernews  :3847  headless Chromium  (public, no auth)
  ├── linkedin    :3848  headless Chromium  (authenticated)
  └── google-discover  :3849  Pixel 7 mobile emulation  (authenticated)
```

Each adapter is a standard MCP HTTP server. Your AI agent connects to it the same way it would connect to any MCP tool — `{"url": "http://127.0.0.1:3847/mcp"}` in your settings.

## The login flow

This is the part people usually get wrong with browser automation: how do you handle initial login, 2FA, CAPTCHAs?

browserkit's answer: you do it manually, once.

```bash
browserkit login linkedin
```

A Chrome window opens. You log in as you normally would. The window closes. The session is saved to a persistent profile directory. Every subsequent run — including headless runs — reuses that session without prompting you again.

If the session expires mid-use, browserkit opens a temporary background browser, waits for you to re-authenticate, transfers the fresh cookies to the running headless session, and continues. Zero downtime.

## Building an adapter

A minimal adapter is about 50 lines:

```typescript
import { defineAdapter } from "@browserkit/core";
import { z } from "zod";

export default defineAdapter({
  site: "my-site",
  domain: "my-site.com",
  loginUrl: "https://my-site.com/login",

  async isLoggedIn(page) {
    return page.getByRole("navigation", { name: "user menu" }).isVisible({ timeout: 3000 });
  },

  tools: () => [{
    name: "get_data",
    description: "Get data from my-site",
    inputSchema: z.object({ query: z.string() }),
    async handler(page, input) {
      const { query } = mySchema.parse(input);
      await page.goto(`https://my-site.com/search?q=${encodeURIComponent(query)}`);
      const results = await page.$$eval(".result", els => els.map(el => el.textContent));
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    },
  }],
});
```

The handler receives a live, already-authenticated Playwright `Page`. You navigate, scrape, interact — the framework handles the rest.

## What I actually built

To validate the framework, I built two adapters.

**Hacker News** ([github.com/browserkit-dev/adapter-hackernews](https://github.com/browserkit-dev/adapter-hackernews)) — public demo with 5 tools: `get_top`, `get_new`, `get_ask`, `get_show`, `get_comments`. HN's table layout is famously stable, so the selectors use `data-hveid` and structural patterns rather than fragile class names. The adapter is 230 lines including a data-driven feed tool pattern (4 near-identical tools collapsed into 20 lines).

**Google Discover** — personal feed via Pixel 7 mobile emulation. Google's Discover surface only appeared on desktop for a limited rollout, but Playwright's device emulation bypasses that — set `deviceEmulation: "Pixel 7"` in config and `google.com` serves the full mobile Discover feed regardless.

## The test harness

Every adapter ships with a 4-layer test suite:

- **L1 — Unit**: schema validation, metadata, no browser
- **L2 — Mock DOM**: real headless browser navigates to a local HTML fixture, scraping logic is tested without network or auth
- **L3 — MCP Protocol**: spins up a real in-process MCP server, connects via the SDK client, tests the full protocol stack
- **L4 — Reliability**: concurrency (lock serialization), latency measurement, error recovery

The testing utilities are in `@browserkit/core/testing`:

```typescript
const server = await createTestAdapterServer(myAdapter); // isolated temp dir, dynamic port
const client = await createTestMcpClient(server.url);    // real MCP HTTP client

const result = await client.callTool("get_top", { count: 5 });
const articles = JSON.parse(result.content[0].text);
```

## What the framework actually handles

Things you don't have to write:

- **Session persistence** — `launchPersistentContext` with XDG-correct data dirs (macOS: `~/Library/Application Support/browserkit`)
- **Auth re-acquisition** — detects `isLoggedIn() === false`, opens temp browser, transfers cookies, zero downtime
- **Request serialization** — FIFO async mutex per adapter (multiple AI agents can call tools concurrently; they queue safely)
- **Rate limiting** — configurable min delay between consecutive calls
- **per-session MCP** — each connecting AI agent gets its own `McpServer + StreamableHTTPServerTransport` so multiple clients can initialize independently
- **Pidfile locking** — prevents two daemon instances from corrupting the same profile
- **Browser modes** — `headless` / `watch` (visible) / `paused` (hand control to user)
- **CDP raw access** — expose `wsEndpoint` for external agents to attach Playwright scripts to an already-authenticated session

## Honest limitations

**Not a replacement for proper APIs.** If a site has a real API, use it. browserkit is for the sites that don't, or where you specifically want to use your existing authenticated session.

**DOM fragility is real.** Google's Discover adapter uses `data-hveid` (stable for analytics) because Google's class names change unpredictably. Every scraper breaks eventually. The `health_check` tool and selector reporting are the early warning system.

**Login still requires human interaction.** This is intentional. Storing credentials would be the wrong trade-off for a local-first tool.

## Get started

```bash
pnpm add @browserkit/core @browserkit/adapter-hackernews
browserkit start --config browserkit.config.js
```

Framework: [github.com/browserkit-dev/browserkit](https://github.com/browserkit-dev/browserkit)

Reference adapter: [github.com/browserkit-dev/adapter-hackernews](https://github.com/browserkit-dev/adapter-hackernews)

If you build an adapter, open a PR to add it to the README. The goal is a library of well-tested adapters for sites that people actually use.
