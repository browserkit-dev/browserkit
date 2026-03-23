# Tasks

## Completed

- [x] Project scaffolding (SPEC, CLAUDE, ARCH, context, claude config)
- [x] Reference brainstorm archived to `docs/reference/`
- [x] Full framework implementation (Phases 1–9) — see `.context/progress.md`
- [x] CDP raw access: `debugPort` config, `--remote-debugging-port` launch arg, `getCdpUrl()` in SessionManager, surfaced in `get_page_state`
- [x] README, ARCH.md updated with raw Playwright access via CDP use-case

## In Progress

## Backlog

### Foundation
- [ ] Decide stack: TypeScript + Playwright vs Python + Playwright
- [ ] Init package.json / pyproject.toml with Playwright dependency
- [ ] Implement `SessionManager` — browser launch, storage state persist/restore
- [ ] Implement `SiteAdapter` base interface / abstract class
- [ ] Implement `MCPServer` entry point (stdio transport first)
- [ ] Implement `ToolRegistry` — auto-discover and register adapters

### First Site Adapter: LinkedIn
- [ ] LinkedIn `isLoggedIn` detection
- [ ] LinkedIn `login` flow (manual-first via HumanHandoff)
- [ ] LinkedIn tool: `get_feed` — fetch top N feed items
- [ ] LinkedIn tool: `get_messages` — list unread messages
- [ ] LinkedIn tool: `search_people` — search by name/company

### First Site Adapter: Shufersal
- [ ] Shufersal login flow
- [ ] Shufersal tool: `search_products(query)` — return name, price, unit
- [ ] Shufersal tool: `get_cart` — return current cart contents

### Human Handoff
- [ ] Implement `HumanHandoff` — foreground browser, wait for signal
- [ ] Integrate handoff into adapters for 2FA and order confirmation

### Testing
- [ ] Unit tests for SessionManager (mock browser)
- [ ] Unit tests for each site adapter tool
- [ ] Integration test: full login + tool call flow

### Developer Experience
- [ ] README with quickstart
- [ ] Example: multi-site grocery price comparison in 10 lines
- [ ] CLI: `browserkit start [adapter...]`

## Follow-up Ideas

- [ ] Plugin registry for community-contributed site adapters
- [ ] Cross-site composition tools (search N sites, merge results)
- [ ] Replay / test harness from recorded sessions
- [ ] Rate-limit and jitter config per adapter
