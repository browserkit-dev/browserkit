import { describe, it, expect, beforeEach, vi } from "vitest";
import { RateLimiter } from "../src/rate-limiter.js";

describe("RateLimiter", () => {
  let rl: RateLimiter;

  beforeEach(() => {
    rl = new RateLimiter();
  });

  it("resolves immediately on first call", async () => {
    const start = Date.now();
    await rl.waitIfNeeded("site", 1000);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("enforces min delay after recordCall", async () => {
    rl.recordCall("site");
    const start = Date.now();
    await rl.waitIfNeeded("site", 100);
    expect(Date.now() - start).toBeGreaterThanOrEqual(90);
  });

  it("does not wait if enough time has already passed", async () => {
    rl.recordCall("site");
    await new Promise((r) => setTimeout(r, 120));
    const start = Date.now();
    await rl.waitIfNeeded("site", 100);
    expect(Date.now() - start).toBeLessThan(30);
  });

  it("isolates different keys", async () => {
    rl.recordCall("a");
    const start = Date.now();
    await rl.waitIfNeeded("b", 500); // b has no record
    expect(Date.now() - start).toBeLessThan(30);
  });

  it("reset clears state", async () => {
    rl.recordCall("x");
    rl.reset();
    const start = Date.now();
    await rl.waitIfNeeded("x", 500);
    expect(Date.now() - start).toBeLessThan(30);
  });
});
