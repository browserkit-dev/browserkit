import type { Page } from "patchright";
import type { ElAlDirection, Flight } from "./types.js";

// ─── URL mapping ──────────────────────────────────────────────────────────────

const DIRECTION_PARAM: Record<ElAlDirection, string> = {
  to_israel: "1",
  from_israel: "0",
};

// ─── Confirmed selectors (verified against live DOM 2026-03-30) ───────────────
export const ELAL_SELECTORS = {
  /** The Angular component that wraps the full flight table. */
  container: ".seat-availability-list",
  /** One entry per flight (Angular repeating component). Filter by non-empty innerText. */
  flightItem: ".flight-item",
};

// ─── Raw extraction shape ─────────────────────────────────────────────────────

interface RawElAlEntry {
  flightNumber: string;
  departureTime: string;
  iataCode: string;
  date: string;
  seats: number | null;
}

// ─── Scraper ──────────────────────────────────────────────────────────────────

export async function scrapeElAlFlights(
  page: Page,
  direction: ElAlDirection
): Promise<Flight[]> {
  const url = `https://www.elal.com/heb/seat-availability?d=${DIRECTION_PARAM[direction]}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

  // Both tabs render a .seat-availability-list; use state:"attached" to avoid
  // timing out waiting for the hidden-tab one to become visible.
  await page.waitForSelector(ELAL_SELECTORS.container, { timeout: 20_000, state: "attached" });
  await page.waitForTimeout(2_000);

  // Angular CDK virtual scroll only renders rows in the viewport.
  // We scroll in steps and COLLECT data at each position, then deduplicate.
  // Scrolling back to top after reaching the bottom causes Angular to recycle
  // DOM nodes, so we must not rely on a final post-scroll extraction.
  const seen = new Map<string, RawElAlEntry>();
  await scrollAndCollect(page, seen);

  return [...seen.values()].map((r) => ({
    airline: "elal" as const,
    flightNumber: r.flightNumber,
    date: normalizeElAlDate(r.date),
    origin: direction === "to_israel" ? r.iataCode : "TLV",
    destination: direction === "to_israel" ? "TLV" : r.iataCode,
    departureTime: r.departureTime,
    availableSeats: r.seats,
    seatClasses: [],
    price: undefined,
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract all visible .flight-item rows from the current viewport. */
function extractVisible(): Array<RawElAlEntry> {
  const results: RawElAlEntry[] = [];
  const items = Array.from(document.querySelectorAll(".flight-item"));
  for (const item of items) {
    const text = (item as HTMLElement).innerText?.trim() ?? "";
    if (!text) continue;

    const fnSpans = Array.from(item.querySelectorAll(".flight-number span"));
    const flightNumber = (fnSpans[fnSpans.length - 1] as HTMLElement | undefined)?.innerText.trim() ?? "";
    if (!flightNumber) continue;

    const ftSpans = Array.from(item.querySelectorAll(".flight-time span"));
    const departureTime = (ftSpans[ftSpans.length - 1] as HTMLElement | undefined)?.innerText.trim() ?? "";

    const originEl = item.querySelector(".origin-value") as HTMLElement | null;
    const originText = originEl?.innerText.trim() ?? "";
    const iataMatch = originText.match(/\(([A-Z]{3})\)/);
    const iataCode = iataMatch?.[1] ?? originText;

    const dateHeaders = Array.from(item.querySelectorAll(".date-header")).map(
      (el) => (el as HTMLElement).innerText.trim()
    );

    const cellWrappers = Array.from(item.querySelectorAll(".availability-cell-wrapper"));
    cellWrappers.forEach((wrapper, i) => {
      if (wrapper.querySelector(".no-flight-icon")) return;
      const valueEl = wrapper.querySelector(".availability-value") as HTMLElement | null;
      const rawSeats = valueEl?.innerText.trim() ?? "";
      const date = dateHeaders[i] ?? "";
      if (!date) return;

      // Parse "+9" as 9, "0" as 0, empty as null
      const numeric = parseInt(rawSeats.replace("+", ""), 10);
      const seats = rawSeats === "" ? null : isNaN(numeric) ? null : numeric;

      results.push({ flightNumber, departureTime, iataCode, date, seats });
    });
  }
  return results;
}

/**
 * Scroll the Angular CDK virtual-scroll list in steps, extracting visible rows
 * at each position. Results are merged into `seen` keyed by "flightNumber|date"
 * so we keep the data for every row even after Angular recycles DOM nodes.
 */
async function scrollAndCollect(
  page: Page,
  seen: Map<string, RawElAlEntry>
): Promise<void> {
  const totalHeight = await page.evaluate(
    () => document.querySelector(".seat-availability-list")?.scrollHeight ?? 0
  );

  const collect = async () => {
    const batch: RawElAlEntry[] = await page.evaluate(extractVisible);
    for (const entry of batch) {
      const key = `${entry.flightNumber}|${entry.date}`;
      if (!seen.has(key)) seen.set(key, entry);
    }
  };

  // First pass: scroll top → bottom, collecting at every step
  const step = 300;
  let pos = 0;
  await collect();
  while (pos < totalHeight + step) {
    await page.evaluate((y: number) => {
      const list = document.querySelector(".seat-availability-list");
      if (list) list.scrollTop = y;
      window.scrollBy(0, 300);
    }, pos);
    pos += step;
    await page.waitForTimeout(200);
    await collect();
  }
}

/**
 * Normalize "30.03" or "05.04" (El Al format dd.MM) to ISO "YYYY-MM-DD".
 */
function normalizeElAlDate(raw: string): string {
  const m = raw.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (!m) return raw;
  const [, dd, mm] = m;
  if (!dd || !mm) return raw;
  const year = new Date().getFullYear();
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}
