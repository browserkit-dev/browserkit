# @browserkit/adapter-rescue-flights

A [browserkit](https://github.com/browserkit-dev/browserkit) adapter that **consistently and reliably** queries real-time rescue flight availability from **El Al** and **Israir** — two Israeli airlines that have been operating emergency rescue flights since March 2025.

> **Repo:** [jonzarecki/adapter-rescue-flights](https://github.com/jonzarecki/adapter-rescue-flights)

## What it does

| Tool | Site | Data |
|---|---|---|
| `get_elal_flights` | elal.com | Next 8 days — flight#, departure time, exact seat count per flight |
| `get_israir_flights` | israir.co.il | 30+ days ahead — seat count, price per person, flight# + time for available flights, booking URL |

Both tools require no login — the pages are publicly accessible.

## How it works

**El Al** — scrapes `elal.com/heb/seat-availability` which is an Angular SPA with a CDK virtual-scroll list. The scraper scrolls through the full list in 300px steps, collecting rendered rows at each position (DOM nodes are recycled on scroll, so data is captured incrementally).

**Israir** — two-phase approach:
1. Reads the listing page DOM to find all announced rescue flights (58+ cards across dates)
2. Seeds a browser session, then calls Israir's internal `priceBar` API for real-time seat counts and cheapest prices across all route+date combos — **one API call per unique route** rather than one browser navigation per flight
3. For flights with available seats, opens parallel search pages and intercepts the `FLIGHTS` API response to get exact flight numbers and departure times

> The Israir APIs (`/api/results/priceBar`, `/api/search/FLIGHTS`) are called via `page.evaluate()` from within the browser context — direct Node.js `fetch` is rejected by Imperva due to TLS fingerprinting.

**Reliability notes:**
- El Al results are verified by visual comparison against the live page on every run (see `make agent-check`)
- Israir seat counts come directly from the internal `priceBar` JSON API — not fragile HTML parsing
- Both scrapers handle the most common failure modes: Angular virtual-scroll recycling (El Al), Imperva bot protection (Israir), SPA routing without `<a href>` links (Israir listing), and dynamic session tokens

## Setup

```bash
# Inside the browserkit monorepo
pnpm add @browserkit/adapter-rescue-flights

# browserkit.config.js
export default {
  adapters: {
    "@browserkit/adapter-rescue-flights": { port: 52746 }
  }
}
```

## Usage

```bash
browserkit start
```

Then in your MCP client:

```
get_elal_flights({ direction: "to_israel" })
get_elal_flights({ direction: "from_israel" })
get_israir_flights({ direction: "to_tel_aviv" })
get_israir_flights({ direction: "from_tel_aviv" })
```

## Output shape

```typescript
interface Flight {
  airline:        "elal" | "israir";
  flightNumber:   string;          // e.g. "LY333", "6H997"
  date:           string;          // ISO: "2026-04-11"
  origin:         string;          // IATA: "TLV", "ATH", "FCO"
  destination:    string;
  departureTime:  string;          // "16:00" — empty for near-term Israir
  availableSeats: number | null;   // 0 = sold out; null = priceBar gap
  seatClasses:    string[];
  price?:         string;          // "$545" — Israir only
  detailUrl?:     string;          // Israir search URL — only on available flights
}
```

## Verification

```bash
# From the repo root — requires browserkit start
make agent-check
```

Runs the scrapers via MCP, writes `agent-check-results.json`, then prompts the agent to navigate the live sites and visually verify the output. See `.claude/commands/agent-check.md` for the full workflow.
