import { describe, it, expect, vi, beforeEach } from "vitest";
import { LockManager } from "../src/lock-manager.js";

describe("LockManager", () => {
  let lm: LockManager;

  beforeEach(() => {
    lm = new LockManager();
  });

  it("returns a release function", async () => {
    const release = await lm.acquire("site-a");
    expect(typeof release).toBe("function");
    release();
  });

  it("serializes concurrent acquires (FIFO)", async () => {
    const order: number[] = [];

    const r1 = await lm.acquire("x");
    const p2 = lm.acquire("x").then((r) => {
      order.push(2);
      r();
    });
    const p3 = lm.acquire("x").then((r) => {
      order.push(3);
      r();
    });

    order.push(1);
    r1();
    await Promise.all([p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("isolates different keys", async () => {
    const r1 = await lm.acquire("a");
    const r2 = await lm.acquire("b"); // should not block
    expect(typeof r2).toBe("function");
    r1();
    r2();
  });

  it("rejects after timeout", async () => {
    const r1 = await lm.acquire("timeout-key");
    await expect(lm.acquire("timeout-key", 50)).rejects.toThrow(/timeout/i);
    r1();
  });
});
