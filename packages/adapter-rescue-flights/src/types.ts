// ─── Direction enums ──────────────────────────────────────────────────────────

export type ElAlDirection = "to_israel" | "from_israel";
export type IsrairDirection = "to_tel_aviv" | "from_tel_aviv";

// ─── Flight shape ─────────────────────────────────────────────────────────────

export interface Flight {
  /** Which airline operated the rescue flight. */
  airline: "elal" | "israir";
  /** Airline flight code, e.g. "LY316" or "6H505". */
  flightNumber: string;
  /** ISO date string, e.g. "2026-04-01". */
  date: string;
  /** Departure airport name or IATA code as returned by the site. */
  origin: string;
  /** Arrival airport name or IATA code as returned by the site. */
  destination: string;
  /** Departure time as a string, e.g. "14:35". */
  departureTime: string;
  /** Number of seats shown as available. null if the site did not expose a count. */
  availableSeats: number | null;
  /** Cabin classes mentioned on the site (may be empty). */
  seatClasses: string[];
  /** Raw price string as shown by the site (currency + amount). Optional. */
  price?: string;
  /** Source URL for the detail page (Israir only). */
  detailUrl?: string;
}
