# Reddit Adapter Phase 2: Authenticated Features

## Prerequisites

- Phase 1 complete: `browserkit-dev/adapter-reddit` published with 4 public tools (`get_subreddit`, `get_thread`, `search`, `get_user`)
- CI passing on Phase 1

## 2a. Auth detection

Replace `isLoggedIn: () => true` with real detection in `src/index.ts`:

```typescript
async isLoggedIn(page: Page): Promise<boolean> {
  // old.reddit.com shows username link in header when logged in
  const userLink = await page.locator('#header-bottom-right .user a').count();
  if (userLink > 0) return true;
  // Fallback: check for login prompt text
  const loginPrompt = await page.locator('#header-bottom-right .login-required').count();
  return loginPrompt === 0;
}
```

## 2b. New tools (3)

| Tool | Inputs | URL pattern | Description |
|------|--------|-------------|-------------|
| `get_feed` | `sort?` (best/hot/new/rising/top), `count?` (1-50) | `old.reddit.com/` (logged-in front page) | Personal front page based on subscriptions |
| `get_saved` | `count?` (1-50) | `old.reddit.com/user/{me}/saved` | Saved posts and comments |
| `get_messages` | `section?` (inbox/unread/sent), `count?` (1-25) | `old.reddit.com/message/{section}` | Reddit inbox messages |

Phase 1 tools continue to work for both authenticated and unauthenticated users. Phase 2 tools return handoff errors when not logged in (framework handles this automatically via `isLoggedIn` check before each tool call).

`get_feed` reuses `scrapePostListing` from Phase 1. `get_saved` reuses the same scraper but targets the saved page. `get_messages` needs a new `scrapeMessages` function in `scraper.ts` for the message DOM.

## 2c. Config

```javascript
adapters: {
  "@browserkit/adapter-reddit": { port: 3849 },
  // no channel: "chrome" needed — Reddit doesn't block Chromium login
}
```

Login: `browserkit login reddit` opens old.reddit.com/login in a headed browser.

## 2d. Testing

**Unit tests (update `reddit.test.ts`):**
- 3 new tool schemas validated
- `isLoggedIn` with mocked page (logged in vs logged out HTML)
- `scrapeMessages` pure function tests

**L3 MCP protocol (update `mcp-protocol.test.ts`):**
- Tool count increases from 6 to 9
- `get_feed` / `get_saved` / `get_messages` dispatch correctly
- Unauthenticated calls to auth tools return handoff error

**L2 integration (`reddit.integration.test.ts`):**
- `get_feed` returns personalized posts (requires `browserkit login reddit`)
- `get_saved` returns saved items
- `get_messages` returns inbox
- Mark these as skip-in-CI (need live auth session)

## 2e. Execution order

1. Update `isLoggedIn` with real auth detection
2. Add `scrapeMessages` to `scraper.ts`
3. Add `get_feed`, `get_saved`, `get_messages` tool handlers to `index.ts`
4. Update L1 + L3 tests for new tools
5. Add L2 auth integration tests (excluded from CI)
6. Push, verify CI passes
7. Update main browserkit README if needed
