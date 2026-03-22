# System Patterns

## General Conventions

- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- Strict typing everywhere — no `any` (TS) or untyped functions (Python)
- Update `.context/progress.md` after completing tasks
- Reference `SPEC.md` for product requirements

## Architecture Patterns

- **One browser process per domain** — prevents cross-site session bleed
- **Adapter pattern** — each site is an isolated module implementing `SiteAdapter`
- **Tool-first design** — think in MCP tool names before implementation
- **HumanHandoff as escape hatch** — never block on side-effecting actions; hand off to user

## Naming

- Site adapter directories: `src/adapters/{domain-slug}/` (e.g., `linkedin/`, `shufersal/`)
- Tool names: `{site}_{verb}_{noun}` (e.g., `linkedin_get_feed`, `shufersal_search_products`)
- Tests: colocated at `tests/adapters/{domain-slug}/`

## Security Constraints

- Credentials and session state stay on disk, never in env vars committed to git
- `.gitignore` must include all session state files (`*.storage-state.json`, `.credentials/`)
