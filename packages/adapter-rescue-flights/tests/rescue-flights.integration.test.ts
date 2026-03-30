/**
 * L2 — Scraping Integration Tests
 *
 * Runs a real headless browser against the live El Al and Israir rescue flight pages.
 * These tests require network access and are NOT run in CI by default.
 *
 * Run with:
 *   pnpm --filter @browserkit/adapter-rescue-flights test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import rescueFlightsAdapter from "../src/index.js";
import { createTestAdapterServer, type TestAdapterServer } from "@browserkit/core/testing";
import { createTestMcpClient, type TestMcpClient } from "@browserkit/core/testing";
import type { Flight } from "../src/types.js";

// ── Shared server ─────────────────────────────────────────────────────────────

let server: TestAdapterServer;
let client: TestMcpClient;

beforeAll(async () => {
  server = await createTestAdapterServer(rescueFlightsAdapter);
  client = await createTestMcpClient(server.url);
}, 30_000);

afterAll(async () => {
  await client.close();
  await server.stop();
});

// ── Flight shape assertions ───────────────────────────────────────────────────

function assertFlightShape(flight: Flight, index: number): void {
  expect(typeof flight.airline,      `flight[${index}].airline`).toBe("string");
  expect(["elal", "israir"],         `flight[${index}].airline must be elal or israir`).toContain(flight.airline);
  expect(typeof flight.flightNumber, `flight[${index}].flightNumber`).toBe("string");
  expect(typeof flight.date,         `flight[${index}].date`).toBe("string");
  expect(/^\d{4}-\d{2}-\d{2}$/.test(flight.date), `flight[${index}].date is ISO`).toBe(true);
  expect(typeof flight.origin,       `flight[${index}].origin`).toBe("string");
  expect(/^[A-Z]{3}$/.test(flight.origin), `flight[${index}].origin is IATA`).toBe(true);
  expect(typeof flight.destination,  `flight[${index}].destination`).toBe("string");
  expect(/^[A-Z]{3}$/.test(flight.destination), `flight[${index}].destination is IATA`).toBe(true);
  expect(typeof flight.departureTime, `flight[${index}].departureTime`).toBe("string");
  expect(Array.isArray(flight.seatClasses), `flight[${index}].seatClasses is array`).toBe(true);
  if (flight.availableSeats !== null) {
    expect(typeof flight.availableSeats, `flight[${index}].availableSeats`).toBe("number");
    expect(flight.availableSeats, `flight[${index}].availableSeats >= 0`).toBeGreaterThanOrEqual(0);
  }
  if (flight.price !== undefined) {
    expect(typeof flight.price, `flight[${index}].price`).toBe("string");
    expect(flight.price, `flight[${index}].price starts with $`).toMatch(/^\$/);
  }
}

function assertElAlShape(flight: Flight, index: number): void {
  assertFlightShape(flight, index);
  // El Al always has flight number, departure time, and exact seat count
  expect(flight.flightNumber.length,  `elal[${index}].flightNumber non-empty`).toBeGreaterThan(0);
  expect(/^LY/i.test(flight.flightNumber), `elal[${index}].flightNumber starts LY`).toBe(true);
  expect(flight.departureTime.length, `elal[${index}].departureTime non-empty`).toBeGreaterThan(0);
  expect(flight.availableSeats,       `elal[${index}].availableSeats is number`).not.toBeNull();
  expect(flight.availableSeats,       `elal[${index}].availableSeats >= 0`).toBeGreaterThanOrEqual(0);
}

function assertIsrairAvailableShape(flight: Flight, index: number): void {
  assertFlightShape(flight, index);
  // Available Israir flights (seats > 0) should have a price and a detailUrl
  expect(flight.price,     `israir available[${index}].price exists`).toBeTruthy();
  expect(flight.detailUrl, `israir available[${index}].detailUrl exists`).toBeTruthy();
  expect(flight.detailUrl, `israir available[${index}].detailUrl is string`).toBeTypeOf("string");
  // Flight number may be empty for near-term dates where FLIGHTS API is unavailable,
  // but seat count must be a non-negative number
  expect(flight.availableSeats, `israir available[${index}].availableSeats >= 0`).toBeGreaterThanOrEqual(0);
}

// ── El Al integration ─────────────────────────────────────────────────────────

describe("get_elal_flights (live El Al)", () => {
  it("to_israel: returns flights with full data (number, time, seats)", async () => {
    const result = await client.callTool("get_elal_flights", { direction: "to_israel" });
    expect(result.isError).toBeFalsy();

    const flights = JSON.parse(result.content[0]?.text ?? "[]") as Flight[];
    expect(Array.isArray(flights)).toBe(true);
    if (flights.length > 0) {
      flights.forEach((f, i) => assertElAlShape(f, i));
      expect(flights.every((f) => f.airline === "elal")).toBe(true);
      // All origins should be non-TLV (arriving in Israel)
      const nonTlvOrigins = flights.filter((f) => f.origin !== "TLV");
      expect(nonTlvOrigins.length).toBeGreaterThan(0);
    }
  });

  it("from_israel: returns flights with TLV as origin", async () => {
    const result = await client.callTool("get_elal_flights", { direction: "from_israel" });
    expect(result.isError).toBeFalsy();

    const flights = JSON.parse(result.content[0]?.text ?? "[]") as Flight[];
    expect(Array.isArray(flights)).toBe(true);
    if (flights.length > 0) {
      flights.forEach((f, i) => assertElAlShape(f, i));
      expect(flights.every((f) => f.origin === "TLV")).toBe(true);
    }
  });

  it("covers multiple dates (8-day window)", async () => {
    const result = await client.callTool("get_elal_flights", { direction: "from_israel" });
    const flights = JSON.parse(result.content[0]?.text ?? "[]") as Flight[];
    if (flights.length > 0) {
      const uniqueDates = new Set(flights.map((f) => f.date));
      expect(uniqueDates.size).toBeGreaterThanOrEqual(2);
    }
  });
});

// ── Israir integration ────────────────────────────────────────────────────────

describe("get_israir_flights (live Israir)", () => {
  it("to_tel_aviv: seat counts from priceBar API, all destinations are TLV", async () => {
    const result = await client.callTool("get_israir_flights", { direction: "to_tel_aviv" });
    expect(result.isError).toBeFalsy();

    const flights = JSON.parse(result.content[0]?.text ?? "[]") as Flight[];
    expect(Array.isArray(flights)).toBe(true);
    expect(flights.length).toBeGreaterThan(0);
    expect(flights.every((f) => f.airline === "israir")).toBe(true);
    expect(flights.every((f) => f.destination === "TLV")).toBe(true);

    flights.forEach((f, i) => assertFlightShape(f, i));

    // Available flights should have price + detailUrl
    const available = flights.filter((f) => (f.availableSeats ?? 0) > 0);
    if (available.length > 0) {
      available.forEach((f, i) => assertIsrairAvailableShape(f, i));
    }
  });

  it("from_tel_aviv: seat counts, prices, flight numbers for available flights", async () => {
    const result = await client.callTool("get_israir_flights", { direction: "from_tel_aviv" });
    expect(result.isError).toBeFalsy();

    const flights = JSON.parse(result.content[0]?.text ?? "[]") as Flight[];
    expect(Array.isArray(flights)).toBe(true);
    expect(flights.length).toBeGreaterThan(0);
    expect(flights.every((f) => f.airline === "israir")).toBe(true);
    expect(flights.every((f) => f.origin === "TLV")).toBe(true);

    flights.forEach((f, i) => assertFlightShape(f, i));

    const available = flights.filter((f) => (f.availableSeats ?? 0) > 0);
    if (available.length > 0) {
      available.forEach((f, i) => assertIsrairAvailableShape(f, i));
      // Available flights must have exact seat count (not null)
      expect(available.every((f) => f.availableSeats !== null)).toBe(true);
    }

    // Sold-out flights have seats=0
    const soldOut = flights.filter((f) => f.availableSeats === 0);
    soldOut.forEach((f) => {
      expect(f.flightNumber).toBe("");    // no schedule needed for sold-out
      expect(f.detailUrl).toBeUndefined();
    });
  });

  it("covers dates well beyond the El Al 8-day window", async () => {
    const result = await client.callTool("get_israir_flights", { direction: "from_tel_aviv" });
    const flights = JSON.parse(result.content[0]?.text ?? "[]") as Flight[];
    if (flights.length > 0) {
      const maxDate = flights.map((f) => f.date).sort().at(-1) ?? "";
      const today = new Date().toISOString().slice(0, 10);
      const daysOut = (new Date(maxDate).getTime() - new Date(today).getTime()) / 86_400_000;
      expect(daysOut).toBeGreaterThan(8);
    }
  });
});

// ── Selector health ───────────────────────────────────────────────────────────

describe("selector health (live sites)", () => {
  it("health_check runs without error after El Al navigation", async () => {
    await client.callTool("browser", {
      action: "navigate",
      url: "https://www.elal.com/heb/seat-availability?d=1",
    });
    const result = await client.callTool("health_check");
    expect(result.isError).toBeFalsy();
    if (result.content[0]?.text) {
      const status = JSON.parse(result.content[0].text) as {
        selectors?: Record<string, { found: boolean; count: number }>;
      };
      if (status.selectors) {
        expect(typeof status.selectors).toBe("object");
      }
    }
  });
});
