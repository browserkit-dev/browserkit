# /agent-check

Verify the rescue-flights adapter scrapers against the live sites.
Use the cursor-ide-browser MCP tools directly for all browser interaction.
Loop until all checks pass.

## Tools to use

- `browser_navigate` — load each live URL
- `browser_take_screenshot` — capture the rendered page for visual comparison
- `browser_snapshot` — get the ARIA tree for structural checks
- `browser_scroll` — scroll the El Al list to expose virtual-scroll rows

## Loop

### Step 1 — Run scrapers

```
make agent-check
```

This builds the adapter, runs all four scraper calls, and writes
`agent-check-results.json` to the repo root.

Read the file. Note any entries where `availableSeats > 0` (El Al) and the
full flight count (Israir).

### Step 2 — El Al visual check (`to_israel`)

1. `browser_navigate` → `https://www.elal.com/heb/seat-availability?d=1`
2. Dismiss any cookie banner if present.
3. Scroll down slowly (the list uses Angular CDK virtual scroll — rows only
   render when in viewport). Take screenshots as you scroll.
4. For each flight row visible in the screenshots, verify the scraper JSON
   agrees on the seat count, especially any row showing a number > 0.

**Failure condition:** a flight row visible on screen shows seats > 0 but the
scraper JSON says 0 or is missing that entry entirely.

### Step 3 — El Al visual check (`from_israel`)

Same as Step 2 with `?d=0`.

### Step 4 — Israir visual check (`to_tel_aviv`)

1. `browser_navigate` → `https://www.israir.co.il/Flights/Rescue_Flights/To_Tel_Aviv`
2. Take a screenshot. Count the visible flight cards.
3. Use `browser_snapshot` to confirm button count.
4. Verify scraper JSON count matches and all `origin` fields are IATA codes
   (3 uppercase letters), not raw Hebrew text.

### Step 5 — Israir visual check (`from_tel_aviv`)

Same as Step 4 with the From_Tel_Aviv URL.  
**Important:** this page loads flight cards asynchronously — wait for them to
appear before counting. If the screenshot shows skeleton/placeholder UI, wait
and retry the screenshot.

### Step 6 — Evaluate

- **All checks pass** → report PASS and stop.
- **Any check fails** → identify the exact discrepancy, fix the relevant
  source file in `packages/adapter-rescue-flights/src/`, then go back to Step 1.

## Notes

- Do not stop until the loop exits cleanly on a fresh run.
- Transient page load failures are expected; just retry that step.
- For El Al, the "show only flights with available seats" checkbox can be
  ticked to reduce noise and make the screenshot easier to read.
