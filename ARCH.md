# Architecture

## Overview

session-mcp is a local-first framework for building MCP servers that operate over authenticated user browser sessions. Instead of scraping or reverse-engineering APIs, it reuses the user's real logged-in browser profile to perform actions and extract data, then exposes those capabilities as MCP tools.

## Planned File Tree

```
session-mcp/
├── src/
│   ├── core/
│   │   ├── session-manager.ts     # browser process lifecycle, auth persistence
│   │   ├── human-handoff.ts       # bring browser to foreground for user action
│   │   └── tool-registry.ts       # discover + register site adapters at startup
│   ├── adapters/
│   │   ├── base-adapter.ts        # abstract SiteAdapter interface
│   │   ├── linkedin/
│   │   │   └── index.ts           # LinkedIn-specific MCP tools
│   │   └── shufersal/
│   │       └── index.ts           # Shufersal-specific MCP tools
│   ├── mcp-server.ts              # MCP server entry point
│   └── index.ts
├── tests/
│   ├── core/
│   └── adapters/
├── docs/
│   └── reference/                 # brainstorm notes, saved chats
├── .context/                      # AI session memory
├── .claude/                       # Claude commands, skills, hooks
├── .cursor/rules/                 # Cursor always-on rules
├── SPEC.md
├── CLAUDE.md
├── ARCH.md
└── TASKS.md
```

## Components

### SessionManager

- Manages one Playwright browser instance per authenticated domain
- Persists storage state (cookies, localStorage) to disk per site
- Exposes `getPage(site)` returning a ready, logged-in `Page`
- Handles re-auth if session expires

### SiteAdapter (abstract)

```typescript
interface SiteAdapter {
  readonly domain: string;
  tools(): MCPTool[];            // list of MCP tools this adapter exposes
  login(page: Page): Promise<void>;
  isLoggedIn(page: Page): Promise<boolean>;
}
```

### MCPServer

- Collects all registered adapters' tools
- Starts an MCP-compatible JSON-RPC server (stdio or HTTP)
- Routes tool calls to the correct adapter

### HumanHandoff

- Detects when a browser action requires human intervention (CAPTCHA, 2FA, order confirmation)
- Brings the relevant browser window to foreground
- Waits for user completion signal before resuming

## Data Model

- **StorageState**: serialized browser cookies + localStorage per site (never leaves machine)
- **MCPTool**: `{ name, description, inputSchema, handler }`
- **SiteAdapter**: domain + login flow + tool set

## Key Technical Decisions (TBD)

- Language: TypeScript (Playwright-native) vs Python (more AI ecosystem)
- Session storage: disk-based JSON vs encrypted keychain
- MCP transport: stdio (for Cursor/Claude Desktop) vs HTTP+SSE (for remote)
- Headless strategy: Playwright CDP attach to existing Chrome profile vs fresh profile per site
