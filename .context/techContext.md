# Tech Context

## Stack

- Language: **To be decided** — TypeScript (Playwright-native, typed MCP SDKs) vs Python (richer AI ecosystem)
- Browser automation: Playwright (primary candidate)
- MCP transport: stdio first (Cursor / Claude Desktop), HTTP+SSE later
- Session storage: disk-based JSON storage state (Playwright built-in)

## Key Technical Decisions Pending

- Language choice (TypeScript vs Python)
- Headless strategy: fresh Playwright profile per site vs CDP attach to existing Chrome profile
- Session encryption: plain JSON on disk vs OS keychain integration
- Human handoff signal: OS-level window focus vs explicit user keystroke
- MCP SDK: `@modelcontextprotocol/sdk` (TS) vs `mcp` (Python)

## Competitive Reference

- Playwright MCP — generic browser-as-MCP, not site-specific framework
- Browser Use — agent runtime with real session support, Python
- Stagehand + Browserbase — Playwright + cloud runtime, TS
