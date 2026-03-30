import { defineAdapter } from "@browserkit/core";
import { z } from "zod";
import type { Page } from "patchright";
import { scrapeElAlFlights, ELAL_SELECTORS } from "./elal.js";
import { scrapeIsrairFlights, ISRAIR_SELECTORS } from "./israir.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const elAlInputSchema = z.object({
  direction: z
    .enum(["to_israel", "from_israel"])
    .default("to_israel")
    .describe('Direction: "to_israel" (flights landing in Israel) or "from_israel" (flights departing Israel)'),
});

const israirInputSchema = z.object({
  direction: z
    .enum(["to_tel_aviv", "from_tel_aviv"])
    .default("to_tel_aviv")
    .describe('Direction: "to_tel_aviv" (rescue flights to TLV) or "from_tel_aviv" (rescue flights from TLV)'),
});

type ElAlInput = z.infer<typeof elAlInputSchema>;
type IsrairInput = z.infer<typeof israirInputSchema>;

// ─── Adapter ──────────────────────────────────────────────────────────────────

export default defineAdapter({
  site: "rescue-flights",
  domain: "elal.com",
  loginUrl: "https://www.elal.com/heb/seat-availability",
  rateLimit: { minDelayMs: 2_000 },

  // Both sites are fully public — no authentication required.
  async isLoggedIn(_page: Page): Promise<boolean> {
    return true;
  },

  // Expose selector maps so health_check can report whether they still match the live DOM.
  selectors: {
    ...Object.fromEntries(
      Object.entries(ELAL_SELECTORS).map(([k, v]) => [`elal_${k}`, v])
    ),
    ...Object.fromEntries(
      Object.entries(ISRAIR_SELECTORS).map(([k, v]) => [`israir_${k}`, v])
    ),
  },

  tools: () => [
    // ── get_elal_flights ────────────────────────────────────────────────────
    {
      name: "get_elal_flights",
      description:
        "Get El Al rescue flight availability for the next 8 days. " +
        "Returns all flights with flight number, departure time, exact seat count, origin, and destination. " +
        "availableSeats=0 means sold out; >0 means bookable. " +
        'Use direction="to_israel" for flights arriving in Israel, "from_israel" for departures from Israel.',
      inputSchema: elAlInputSchema,
      annotations: { readOnlyHint: true as const, openWorldHint: true as const },
      async handler(page: Page, input: unknown) {
        const { direction } = elAlInputSchema.parse(input) satisfies ElAlInput;
        try {
          const flights = await scrapeElAlFlights(page, direction);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(flights, null, 2) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Failed to scrape El Al flights: ${message}` }],
            isError: true,
          };
        }
      },
    },

    // ── get_israir_flights ──────────────────────────────────────────────────
    {
      name: "get_israir_flights",
      description:
        "Get Israir rescue flight availability (30+ days ahead). " +
        "Returns flights with seat count, price per person, and — for flights with available seats — " +
        "flight number, departure time, and a direct booking URL (detailUrl). " +
        "Uses the Israir internal priceBar + FLIGHTS APIs for real-time data. " +
        "availableSeats=0 means sold out; >0 is the exact remaining count. null means priceBar data unavailable for that date. " +
        'Use direction="to_tel_aviv" for flights arriving at TLV, "from_tel_aviv" for departures.',
      inputSchema: israirInputSchema,
      annotations: { readOnlyHint: true as const, openWorldHint: true as const },
      async handler(page: Page, input: unknown) {
        const { direction } = israirInputSchema.parse(input) satisfies IsrairInput;
        try {
          const flights = await scrapeIsrairFlights(page, direction);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(flights, null, 2) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to scrape Israir flights: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
    },
  ],
});
