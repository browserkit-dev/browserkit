# Session Persistence & Auth-Handoff Tools — Landscape Notes

> Researched April 2026. These are the closest tools to browserkit's auth/session layer.
> None of them have a site-specific adapter model or `tools()` interface on top — that's the gap.

---

## Chromectl

- **Repo:** [BartlomiejLewandowski/chromectl](https://github.com/BartlomiejLewandowski/chromectl)
- **HN:** [Show HN #47207790](https://news.ycombinator.com/item?id=47207790) (April 2026)
- **Language:** TypeScript (CLI)
- **Approach:** CLI that gives an AI agent a named, isolated Chrome session. You start a session, navigate to a site, log in manually, then hand control back to the agent. Each session gets its own `--user-data-dir` so cookies, auth, and localStorage survive restarts.
- **Key features:**
  - Named sessions (`chromectl session start mysite`)
  - Human-handoff: agent hands browser to human for login, then takes it back
  - Commands: `navigate`, `screenshot`, `eval`, `scrape`, `pick` (click any element → get selector/HTML/styles as JSON)
  - Lightweight CLI, not MCP tool definitions (avoids context bloat)
- **Gap vs browserkit:** No adapter layer, no `tools()`, no LockManager, no per-site MCP server, no ecosystem. A primitive that proves demand for the concept.
- **Watch:** Closest soul to browserkit's login flow; HN thread worth monitoring for community signal.

---

## AgentAuth

- **PyPI:** [agentauth-py](https://pypi.org/project/agentauth-py/)
- **Language:** Python
- **Approach:** SDK that extracts encrypted cookies from a live Chrome session for a target domain, then exports/imports them for remote agents.
- **Key features:**
  - `agent-auth grab <domain>` — extracts cookies without extensions
  - `agent-auth export / import` — portable session state for remote servers
  - AES encryption for stored sessions
- **Gap vs browserkit:** Python only; grabs cookies but doesn't expose them as typed AI tools; no adapter model; no headed browser management.

---

## BrowserState

- **PyPI:** [browserstate](https://pypi.org/project/browserstate/0.0.4/)
- **Language:** Python
- **Approach:** Captures and restores full browser context (cookies, localStorage, IndexedDB, service workers, fingerprints) across environments.
- **Key features:**
  - Works with Playwright, Selenium, Pyppeteer
  - Pluggable storage backends: local filesystem, Redis, S3, GCS
  - Enables portable session state across machines and CI pipelines
- **Gap vs browserkit:** Purely a state snapshot/restore utility; no live browser management, no MCP, no tool layer.

---

## web-ctl

- **Repo:** [agent-sh/web-ctl](https://github.com/agent-sh/web-ctl)
- **Language:** TypeScript
- **Approach:** Browser automation for AI agents with persistent session-based control. Headless actions (goto, click, type, read, snapshot) backed by Chrome `userDataDir` for persistence.
- **Key features:**
  - AES-256-GCM encrypted session storage
  - Human-in-the-loop authentication support
  - Works with Claude Code and shell-capable clients
- **Gap vs browserkit:** Generic action runner; no site-specific tooling, no adapter model, no MCP server.

---

## Playwrightess MCP

- **Link:** [scriptbyai.com/playwrightess](https://www.scriptbyai.com/playwrightess/)
- **Approach:** Single `playwright_eval` MCP interface that preserves Playwright browser context between API calls. No session resets between commands.
- **Key features:**
  - Persistent context across multi-step flows
  - Handles auth flows and form filling without re-login
- **Gap vs browserkit:** Generic eval surface; no typed tools, no adapter ecosystem, no headed/headless switching, no lock manager.

---

## Summary: What they all lack

| Capability | Chromectl | AgentAuth | BrowserState | web-ctl | Playwrightess |
|---|:---:|:---:|:---:|:---:|:---:|
| Site-specific typed tool library | ✗ | ✗ | ✗ | ✗ | ✗ |
| `tools()` adapter interface | ✗ | ✗ | ✗ | ✗ | ✗ |
| MCP server per site | ✗ | ✗ | ✗ | ✗ | ✓ (generic) |
| Multi-site daemon | ✗ | ✗ | ✗ | ✗ | ✗ |
| Human-handoff fallback | ✓ | ✗ | ✗ | ✓ | ✗ |
| Headed/headless switching | ✗ | ✗ | ✗ | ✗ | ✗ |
| LockManager (FIFO serialization) | ✗ | ✗ | ✗ | ✗ | ✗ |
| npm-publishable adapter packages | ✗ | ✗ | ✗ | ✗ | ✗ |
| Testing harness (`/testing` subpath) | ✗ | ✗ | ✗ | ✗ | ✗ |

browserkit operates one layer above all of these — it can use any of them as a backend primitive while adding the adapter/tool/ecosystem layer they all lack.
