# browserkit

Open-source framework for building site-specific MCP servers over real authenticated user browser sessions. Turns your logged-in web sessions into composable, testable AI tools — locally.

## Quick start

No runtime code yet. See SPEC.md for the full product spec.

## Build & test

TBD — stack not decided yet (TypeScript + Playwright or Python + Playwright).

## Architecture

- **Session Manager** — persistent auth browser processes
- **Site Adapter** — per-site structured action modules
- **MCP Server** — wraps adapters as typed MCP tools
- **Human Handoff** — foregrounds browser for 2FA/confirmation
- See `ARCH.md` for full architecture and file tree
- See `SPEC.md` for detailed product spec

## Non-negotiables

- Strict typing — no `any` (TS) or untyped functions (Python)
- Every new module must have tests
- Reference `SPEC.md` for product requirements
- Never cloud-sync credentials — local-only

## How to work here

- Small incremental commits with conventional messages
- Update `.context/progress.md` after completing tasks
- Update `.context/activeContext.md` when switching focus
- Run `/status` to see current project state
- Run `/plan` to decide what to work on next
- Run `/review` before committing

## Forbidden patterns

- No `any` types (TS) or untyped functions (Python)
- No hardcoded credentials anywhere
- No `console.log` in committed code (use proper logging)
- No new top-level folders without updating ARCH.md
