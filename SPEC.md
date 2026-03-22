# session-mcp — Product Spec

## Problem

Most high-value websites (LinkedIn, Google News, Twitter/X, Shufersal, Rami Levy, El Al, etc.) either have no public API or actively block scraping. Yet as a logged-in user you can freely browse, search, and interact with all of them.

General-purpose browser agents exist but are unreliable: they "freestyle on the DOM" and break on any UI change. Playwright-style automation works but requires per-site expertise and lacks MCP integration, session lifecycle management, or human-handoff primitives.

## Solution

An open-source framework for building **site-specific MCP servers** that operate over a **real, authenticated user browser session** — running locally on the user's machine.

The key insight: _turn your logged-in user session into a private, programmable API_.

## Core Properties

| Property | Description |
|---|---|
| **Local-first** | Runs on the user's machine; no cloud infrastructure required |
| **Session-persistent** | Maintains authenticated browser sessions across tool calls |
| **Site-specific** | Each wrapper knows the site's structure (not a generic DOM agent) |
| **MCP-native** | Wrappers expose clean tools consumable by any AI or automation |
| **Human-in-the-loop** | Opens the real browser for 2FA, CAPTCHA, or confirmation steps |
| **Testable** | Tool actions can be unit-tested and retried deterministically |

## Architecture

### Components

1. **Session Manager** — manages one or more headless browser processes with persisted auth state (Playwright profile or CDP attachment)
2. **Site Adapter** — per-site module that knows how to log in, navigate, and extract/perform actions reliably
3. **MCP Server** — wraps site adapters and exposes them as typed MCP tools
4. **Human Handoff** — brings the visible browser to foreground when manual intervention is required
5. **Tool Registry** — discovers and registers all site adapters at server startup

### Key Design Decisions

- **Headless but attachable** — runs headless by default; surfaces to foreground for human-in-the-loop steps
- **One browser process per authenticated domain** — avoids cross-site session contamination
- **Deterministic retry** — each tool call is idempotent or explicitly flagged as side-effecting
- **Credentials never leave the machine** — no cloud relay, no OAuth redirect to third party

## Use Cases (MVP)

1. **LinkedIn digest** — read feed, connection updates, messages
2. **Grocery comparison** — search products across Shufersal + Rami Levy, return price list
3. **News digest** — pull top stories from Google News by topic

## Competitive Landscape

| Tool | Relation | Gap |
|---|---|---|
| Playwright MCP (Microsoft) | Closest MCP-native analog | Generic DOM control, not a framework for site-specific MCP wrappers |
| Browser Use | Closest session-aware agent | Framed as general agent runtime, not opinionated MCP wrapper framework |
| Stagehand + Browserbase | Dev-friendly Playwright + cloud runtime | Cloud-first; your concept is local/personal-first |
| OpenAI Operator / computer-use | Model-level browser control | Model layer, not a developer framework |
| UiPath / RPA | Enterprise attended automation | Enterprise-first, not AI-native or MCP-aware |

**The gap**: no OSS framework exists for building per-site, local-first, MCP-native wrappers with session lifecycle, human handoff, and testable primitives.

## Out of Scope (v1)

- Cloud deployment or multi-user hosting
- Fully autonomous checkout / order placement (human-in-the-loop required for side effects)
- Sites that require native app sessions (no web UI)

## Future Ideas

- Plugin registry: community-contributed site adapters
- Cross-site composition (e.g., search Shufersal + Rami Levy + Tiv Ta'am in one call)
- Replay / test harness for recorded interactions
- Rate limiting and anti-detection heuristics

## Reference

- Original brainstorm: `docs/reference/MCPs עבור סקרייפינג אתרים.mhtml`
- ChatGPT conversation URL: https://chatgpt.com/c/69bf1e4f-eb74-8394-bebe-eb7e7a14bc2d
