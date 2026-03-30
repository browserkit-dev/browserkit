import type { Page } from "patchright";
import type { IsrairDirection, Flight } from "./types.js";

// ─── URL mapping ──────────────────────────────────────────────────────────────

const DIRECTION_URL: Record<IsrairDirection, string> = {
  to_tel_aviv:   "https://www.israir.co.il/Flights/Rescue_Flights/To_Tel_Aviv",
  from_tel_aviv: "https://www.israir.co.il/Flights/Rescue_Flights/From_Tel_Aviv",
};

const SEARCH_BASE =
  "https://www.israir.co.il/he-IL/reservation/search/flights-abroad/results";
const API_BASE = "https://www.israir.co.il/api";
const SITE_ID  = "isra2023";

// ─── Confirmed selectors ──────────────────────────────────────────────────────
export const ISRAIR_SELECTORS = {
  flightButton: "button.flight-promotion",
  cardTitle:    ".title",
  cardDate:     ".manualText_dates",
};

// ─── City encoding (extracted from live page, 2026-03-30) ─────────────────────
// ltravelId values are stable identifiers used by Israir's search API.
const CITY_JSON: Record<string, { cityCode: string; ltravelId: number | null; type: string }> = {
  TLV: { cityCode: "TLV", ltravelId: 2135, type: "ltravelId" },
  ATH: { cityCode: "ATH", ltravelId: 422,  type: "ltravelId" },
  LCA: { cityCode: "LCA", ltravelId: 931,  type: "ltravelId" },
  FCO: { cityCode: "ROM", ltravelId: 802,  type: "ltravelId" }, // Rome uses city code ROM
  TBS: { cityCode: "TBS", ltravelId: 1048, type: "ltravelId" },
  BUD: { cityCode: "BUD", ltravelId: 984,  type: "ltravelId" },
  FRA: { cityCode: "FRA", ltravelId: 731,  type: "ltravelId" },
  LHR: { cityCode: "LON", ltravelId: null, type: "IATA" },
  CDG: { cityCode: "PAR", ltravelId: null, type: "IATA" },
};

function cityParam(iata: string): string {
  const c = CITY_JSON[iata];
  if (!c) return JSON.stringify({ type: "IATA", destinationType: "CITY", cityCode: iata, ltravelId: null, countryCode: null, countryId: null });
  return JSON.stringify({ type: c.type, destinationType: "CITY", cityCode: c.cityCode, ltravelId: c.ltravelId, countryCode: null, countryId: null });
}

// API city code for priceBar/engine endpoints (may differ from IATA)
function apiCityCode(iata: string): string {
  return CITY_JSON[iata]?.cityCode ?? iata;
}

// ─── Hebrew city → IATA ───────────────────────────────────────────────────────
const CITY_TO_IATA: Record<string, string> = {
  "אתונה": "ATH", "לרנקה": "LCA", "לרנקה קפריסין": "LCA",
  "רומא": "FCO",  "טביליסי": "TBS", "בודפשט": "BUD",
  "פרנקפורט": "FRA", "לונדון": "LHR", "פריז": "CDG",
  "ברלין": "BER",  "וינה": "VIE",   "מילאנו": "MXP",
  "ברצלונה": "BCN", "אמסטרדם": "AMS", "ניו יורק": "JFK",
  "מוסקבה": "SVO", "איסטנבול": "IST", "דובאי": "DXB",
  "בנגקוק": "BKK",
};
function hebrewCityToIata(city: string): string {
  return CITY_TO_IATA[city.trim()] ?? city.trim();
}

// ─── API types ────────────────────────────────────────────────────────────────

interface PriceBarDate {
  date: string;
  seats: number;
  cheapestPrice?: { amount: number; currency: string };
}

interface FlightSegment {
  depLoc:          { location: string; scheduledDateTime: string };
  arrLoc:          { location: string; scheduledDateTime: string };
  carrierCode:     string;
  flightNumber:    string;
  seats:           string | number;  // exact seats on this flight+date
}

// ─── Seed session & make API calls from within the browser context ────────────
// The Israir API uses Imperva/Incapsula security tokens that are TLS-fingerprint
// bound — replaying them with Node.js fetch fails. All API calls go through
// page.evaluate() so they originate from the authenticated browser context.

async function seedSession(page: Page, originIata: string, destIata: string, dateStr: string): Promise<void> {
  const url =
    `${SEARCH_BASE}?` +
    `origin=${encodeURIComponent(cityParam(originIata))}` +
    `&destination=${encodeURIComponent(cityParam(destIata))}` +
    `&startDate=${encodeURIComponent(dateStr)}` +
    `&adults=1&subject=ALL&searchTime=${encodeURIComponent(new Date().toISOString())}`;

  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
}

async function fetchPriceBar(
  page: Page,
  origin: string,
  destination: string,
): Promise<PriceBarDate[]> {
  const originCode = apiCityCode(origin);
  const destCode   = apiCityCode(destination);
  const url = `${API_BASE}/results/priceBar?siteId=${SITE_ID}&origin=${originCode}&destination=${destCode}&isOneWay=true&adults=1`;

  const json = await page.evaluate(async (u: string) => {
    const res = await fetch(u, { credentials: "include" });
    if (!res.ok) return null;
    return res.json();
  }, url) as { priceBarDatesContainer?: { outboundDates?: PriceBarDate[] } } | null;

  return json?.priceBarDatesContainer?.outboundDates ?? [];
}

async function fetchFlightSchedule(
  page: Page,
  originIata: string,
  destIata: string,
  ddmmyyyy: string
): Promise<FlightSegment | null> {
  const newPage = await page.context().newPage();
  let segment: FlightSegment | null = null;

  // Resolve when the FLIGHTS API responds (or after timeout)
  let resolve: () => void;
  const dataArrived = new Promise<void>(res => { resolve = res; });

  await newPage.route("**/api/search/FLIGHTS**", async route => {
    const resp = await route.fetch();
    try {
      const json = await resp.json() as { data?: { ltsPackages?: Array<{
        legGroups?: Array<{ legList?: Array<{ legOptionList?: Array<{ legSegmentList?: FlightSegment[] }> }> }>
      }> } };
      segment = json?.data?.ltsPackages?.[0]?.legGroups?.[0]?.legList?.[0]?.legOptionList?.[0]?.legSegmentList?.[0] ?? null;
    } catch { /* ignore */ }
    await route.fulfill({ response: resp });
    resolve();
  });

  const url =
    `${SEARCH_BASE}?` +
    `origin=${encodeURIComponent(cityParam(originIata))}` +
    `&destination=${encodeURIComponent(cityParam(destIata))}` +
    `&startDate=${encodeURIComponent(ddmmyyyy)}` +
    `&adults=1&subject=ALL&searchTime=${encodeURIComponent(new Date().toISOString())}`;

  await newPage.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});

  // Wait for FLIGHTS data or a generous timeout, whichever comes first
  await Promise.race([
    dataArrived,
    new Promise<void>(res => setTimeout(res, 20_000)),
  ]);

  await newPage.close();
  return segment;
}

// ─── Main scraper ─────────────────────────────────────────────────────────────

export async function scrapeIsrairFlights(
  page: Page,
  direction: IsrairDirection
): Promise<Flight[]> {
  const listingUrl = DIRECTION_URL[direction];

  // Phase 1: read listing page to get announced flights (no clicking)
  await page.goto(listingUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForSelector(ISRAIR_SELECTORS.flightButton, { timeout: 20_000 });
  await page.waitForTimeout(500);

  const cards = await page.evaluate(
    ({ btnSel, titleSel, dateSel }) =>
      Array.from(document.querySelectorAll(btnSel)).map((btn) => {
        const titleEl = btn.querySelector(titleSel) as HTMLElement | null;
        const dateEl  = btn.querySelector(dateSel)  as HTMLElement | null;
        return {
          title: titleEl?.innerText.trim() ?? (btn as HTMLElement).innerText.split("\n")[0]?.trim() ?? "",
          date:  dateEl?.innerText.trim() ?? "",
        };
      }),
    { btnSel: ISRAIR_SELECTORS.flightButton, titleSel: ISRAIR_SELECTORS.cardTitle, dateSel: ISRAIR_SELECTORS.cardDate }
  );

  // Parse routes from listing
  const metas = cards.map(card => {
    const toTlvMatch   = card.title.match(/(?:טיסה|טיסות)\s+מ?(.+?)\s+לנתב"?ג/);
    const fromTlvMatch = card.title.match(/(?:טיסה|טיסות)\s+מנתב"?ג\s+ל(.+)/);
    let originHebrew: string, destHebrew: string;
    if (toTlvMatch?.[1]) {
      originHebrew = toTlvMatch[1].trim(); destHebrew = "TLV";
    } else if (fromTlvMatch?.[1]) {
      originHebrew = "TLV"; destHebrew = fromTlvMatch[1].trim();
    } else {
      originHebrew = card.title; destHebrew = direction === "to_tel_aviv" ? "TLV" : "";
    }
    const origin      = originHebrew === "TLV" ? "TLV" : hebrewCityToIata(originHebrew);
    const destination = destHebrew   === "TLV" ? "TLV" : hebrewCityToIata(destHebrew);
    return { origin, destination, date: normalizeIsrairDate(card.date) };
  });

  // Phase 2: seed session with ONE browser navigation, then call APIs directly
  const uniqueRoutes = [...new Map(metas.map(m => {
    const key = `${m.origin}|${m.destination}`;
    return [key, { origin: m.origin, destination: m.destination }];
  })).values()];

  // Pick first available announced date for the seed navigation
  const firstMeta = metas[0];
  if (!firstMeta) return [];
  const [y, mo, d] = firstMeta.date.split("-");
  const seedDate = `${d}/${mo}/${y}`; // DD/MM/YYYY

  await seedSession(
    page,
    direction === "to_tel_aviv" ? firstMeta.origin  : "TLV",
    direction === "to_tel_aviv" ? "TLV"             : firstMeta.destination,
    seedDate
  );

  // Fetch priceBar for every unique route in parallel — via page.evaluate()
  // so the browser's own security context + cookies are used
  const priceBarMap = new Map<string, PriceBarDate[]>();
  await Promise.all(uniqueRoutes.map(async r => {
    const originCode = direction === "to_tel_aviv" ? r.origin  : "TLV";
    const destCode   = direction === "to_tel_aviv" ? "TLV"     : r.destination;
    const dates = await fetchPriceBar(page, originCode, destCode);
    priceBarMap.set(`${r.origin}|${r.destination}`, dates);
  }));

  // For each announced flight, look up availability from priceBar
  // Then fetch the flight schedule (times + number) for available flights,
  // running up to PARALLEL_FLIGHTS concurrent searches.
  const PARALLEL_FLIGHTS = 4;
  const scheduleCache = new Map<string, FlightSegment | null>();

  // Gather unique available date+routes for FLIGHTS schedule fetch.
  const toFetch = metas
    .map((meta) => {
      const routeKey = `${meta.origin}|${meta.destination}`;
      const priceDates = priceBarMap.get(routeKey) ?? [];
      const dayInfo = priceDates.find(pd => pd.date === meta.date);
      const available = (dayInfo?.seats ?? 0) > 0;
      if (!available) return null;
      const [y, mo, d] = meta.date.split("-");
      const ddmmyyyy = `${d}/${mo}/${y}`;
      const originParam = direction === "to_tel_aviv" ? meta.origin : "TLV";
      const destParam   = direction === "to_tel_aviv" ? "TLV"       : meta.destination;
      const schedKey = `${routeKey}|${meta.date}`;
      return { schedKey, originParam, destParam, ddmmyyyy };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .filter((x, i, arr) => arr.findIndex(y => y?.schedKey === x.schedKey) === i); // dedupe

  // Fetch in parallel batches
  for (let i = 0; i < toFetch.length; i += PARALLEL_FLIGHTS) {
    const batch = toFetch.slice(i, i + PARALLEL_FLIGHTS);
    await Promise.all(batch.map(async ({ schedKey, originParam, destParam, ddmmyyyy }) => {
      const seg = await fetchFlightSchedule(page, originParam, destParam, ddmmyyyy);
      scheduleCache.set(schedKey, seg);
    }));
  }

  const flights: Flight[] = metas.map(meta => {
    const routeKey = `${meta.origin}|${meta.destination}`;
    const priceDates = priceBarMap.get(routeKey) ?? [];
    const dayInfo = priceDates.find(pd => pd.date === meta.date);

    const available = (dayInfo?.seats ?? 0) > 0;
    const price = dayInfo?.cheapestPrice ? `$${dayInfo.cheapestPrice.amount}` : undefined;

    const schedKey = `${routeKey}|${meta.date}`;
    const segment  = available ? (scheduleCache.get(schedKey) ?? null) : null;

    const depTime   = segment?.depLoc?.scheduledDateTime?.match(/\d{2}:\d{2}/)?.[0] ?? "";
    const flightNum = segment ? `${segment.carrierCode}${segment.flightNumber}` : "";
    // Prefer the exact seat count from the flight segment; fall back to priceBar
    const segSeats  = segment?.seats !== undefined ? Number(segment.seats) : undefined;
    const finalSeats: number | null = segSeats !== undefined ? segSeats
                                    : dayInfo ? dayInfo.seats
                                    : null;

    // Build the search URL for use as detailUrl on available flights
    const buildDetail = (): string | undefined => {
      if (!available || !price) return undefined;
      const [y, mo, d] = meta.date.split("-");
      const ddmmyyyy = `${d}/${mo}/${y}`;
      const originParam = direction === "to_tel_aviv" ? meta.origin : "TLV";
      const destParam   = direction === "to_tel_aviv" ? "TLV"       : meta.destination;
      try {
        return `${SEARCH_BASE}?origin=${encodeURIComponent(cityParam(originParam))}&destination=${encodeURIComponent(cityParam(destParam))}&startDate=${encodeURIComponent(ddmmyyyy)}&adults=1&subject=ALL`;
      } catch { return undefined; }
    };

    return {
      airline:        "israir",
      flightNumber:   flightNum,
      date:           meta.date,
      origin:         meta.origin,
      destination:    meta.destination,
      departureTime:  depTime,
      availableSeats: finalSeats,
      seatClasses:    ["Economy"],
      price,
      detailUrl:      buildDetail(),
    };
  });

  return flights;
}
// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeIsrairDate(raw: string): string {
  const m = raw.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (!m) return raw;
  const [, dd, mm] = m;
  if (!dd || !mm) return raw;
  const year = new Date().getFullYear();
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}
