# Contributing to browserkit

## Overview

browserkit is a framework for building site-specific MCP servers over real authenticated browser sessions. This guide covers how to contribute adapters, extend the core, and maintain code quality.

## Development Setup

```bash
git clone https://github.com/browserkit-dev/browserkit
cd browserkit
pnpm install
pnpm build
pnpm test
```

## Scraping Philosophy: Stable Over Clever

The most important principle for adapter development: **favour stability over specificity**.

Google changes `.DY5T1d` class names constantly. LinkedIn redesigns component structure every few months. The adapters that survive these changes anchor on stable signals:

**Prefer structural/semantic selectors over class names:**

```typescript
// ✅ Stable — Google uses data-hveid for click tracking internally
"[data-hveid]"

// ✅ Stable — heading roles are semantic, not layout
"h3, [role='heading']"

// ❌ Fragile — will break when Google pushes a CSS update
".DY5T1d-RZkmj"
```

**Prefer `textContent` extraction over DOM walking:**

```typescript
// ✅ Resilient — extracts longest text node as title (works even if markup changes)
const allText = Array.from(card.querySelectorAll("div, span"))
  .filter(el => el.children.length === 0)
  .map(el => el.textContent.trim())
  .filter(t => t.length > 20);
const title = allText.sort((a, b) => b.length - a.length)[0];

// ❌ Fragile — breaks when class name changes
card.querySelector(".article-title-class").textContent
```

**Prefer URL navigation over clicking:**

```typescript
// ✅ Navigate directly to the section URL
await page.goto("https://linkedin.com/in/username/details/experience/");

// ❌ Click a tab element whose selector may change
await page.click('[data-section="experience"]');
```

**Document any DOM dependency** with a comment explaining why `textContent`/URL navigation isn't sufficient.

---

## Checklist: Building a New Adapter

### Scaffold

```bash
npx @browserkit/core create-adapter my-site
cd adapter-my-site
pnpm install
```

### Code

- [ ] `src/selectors.ts` — CSS selector constants with stability comments; prefer `data-*` attributes and semantic elements over class names
- [ ] `src/index.ts`:
  - [ ] `defineAdapter({ site, domain, loginUrl, selectors, rateLimit })` — set `rateLimit` for authenticated sites
  - [ ] `isLoggedIn(page)` — check current page only (no navigation); return `true` for public sites
  - [ ] `tools()` — one tool per distinct URL/action; include `annotations: { readOnlyHint, openWorldHint }`
  - [ ] Tool handlers return `{ content, references? }` — include `references` for extractable links
- [ ] Extract complex scraping logic into a `src/scraper.ts` function that takes a `Page` and can be tested independently

### Tests

- [ ] `tests/<site>.test.ts` — L1 unit: schema validation, metadata, selectors exported
- [ ] `tests/<site>.scraping.test.ts` — mock DOM tests using a local HTML fixture; launch real Playwright browser against `file://` fixture URL; no network
- [ ] `tests/mcp-protocol.test.ts` — L3: MCP initialize, tool list (includes `browser` + `close_session`), tool dispatch, `isError` on schema violations
- [ ] `tests/reliability.test.ts` — L4: concurrency, latency p50/p95, error recovery
- [ ] `tests/<site>.integration.test.ts` — L2: live scraping; tagged so default `pnpm test` excludes it

### Docs

- [ ] `README.md` — tool table, installation, config example with `deviceEmulation`/`channel` if needed
- [ ] Update `browserkit.config.js` example in the main repo README if relevant

### Verify

```bash
pnpm build
pnpm test                # L1 + mock scraping + L3 + L4
pnpm test:integration    # L2 live (requires auth if applicable)
```

---

## Checklist: Adding a Tool to an Existing Adapter

- [ ] Add tool to `tools()` array in `src/index.ts`
- [ ] Include `annotations: { readOnlyHint, openWorldHint }` (readOnly=false + destructiveHint=true for write operations)
- [ ] Add `references` to the return value if the result contains navigable links
- [ ] Update `src/selectors.ts` if new selectors are needed
- [ ] Add L1 schema test covering the new input
- [ ] Add mock scraping test if the tool involves DOM extraction
- [ ] Update `README.md` tool table

---

## Tool Annotations Reference

All adapter tools should declare annotations so AI agents can reason about safety:

```typescript
{
  name: "get_posts",
  annotations: {
    readOnlyHint: true,    // tool does not modify state
    openWorldHint: true,   // tool calls external services (always true for web adapters)
  },
  // ...
}
```

| Annotation | When to use |
|---|---|
| `readOnlyHint: true` | Any read-only scraping tool |
| `readOnlyHint: false` + `destructiveHint: true` | Posting, deleting, purchasing |
| `openWorldHint: true` | Any tool that hits a real website (always) |

---

## References in Tool Results

If a tool result contains links to other entities (articles, profiles, comments), include them in `references`:

```typescript
return {
  content: [{ type: "text", text: JSON.stringify(articles) }],
  references: articles.map(a => ({
    kind: "article",
    url: a.url,
    text: a.title,
    context: a.source,
  })),
};
```

This allows AI agents to follow links without parsing JSON from the main content string.

---

## Code Style

- **No `any` types** — strict TypeScript throughout
- **No `console.log`** in committed code — use `getLogger()` from core
- **Conventional commits**: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- **Small incremental changes** — PRs should be reviewable in under 10 minutes

## Architecture

See [ARCH.md](ARCH.md) for the full framework architecture and open design questions.
