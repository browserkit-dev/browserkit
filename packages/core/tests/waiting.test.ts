import { describe, it, expect, vi } from "vitest";
import {
  TimeoutError,
  SECOND,
  waitUntil,
  raceTimeout,
  runSerial,
  sleep,
} from "../src/waiting.js";

describe("TimeoutError", () => {
  it("is an Error with name TimeoutError", () => {
    const err = new TimeoutError("too slow");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TimeoutError");
    expect(err.message).toBe("too slow");
  });
});

describe("SECOND", () => {
  it("equals 1000", () => {
    expect(SECOND).toBe(1000);
  });
});

describe("sleep", () => {
  it("resolves after approximately the given delay", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

describe("waitUntil", () => {
  it("resolves when the predicate becomes truthy", async () => {
    let count = 0;
    const result = await waitUntil(async () => {
      count++;
      return count >= 3 ? "done" : null;
    }, "counting", 1_000, 10);
    expect(result).toBe("done");
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it("rejects with TimeoutError when the predicate never becomes truthy", async () => {
    await expect(
      waitUntil(async () => null, "never-truthy", 100, 20),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("resolves immediately when predicate is truthy on first call", async () => {
    const result = await waitUntil(async () => "immediate", "first-try", 1_000, 100);
    expect(result).toBe("immediate");
  });

  it("propagates non-timeout errors from the predicate", async () => {
    await expect(
      waitUntil(async () => { throw new Error("predicate error"); }, "erroring", 500, 10),
    ).rejects.toThrow();
  });
});

describe("raceTimeout", () => {
  it("resolves with the value when promise finishes before timeout", async () => {
    const result = await raceTimeout(1_000, Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("returns void (not rejected) when the promise exceeds the timeout", async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 500));
    const result = await raceTimeout(50, slow);
    expect(result).toBeUndefined();
  });

  it("re-throws non-TimeoutError rejections", async () => {
    await expect(
      raceTimeout(1_000, Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
  });
});

describe("runSerial", () => {
  it("executes actions sequentially and collects results", async () => {
    const order: number[] = [];
    const actions = [1, 2, 3].map((n) => async () => {
      order.push(n);
      return n * 2;
    });
    const results = await runSerial(actions);
    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual([2, 4, 6]);
  });

  it("returns an empty array for an empty input", async () => {
    expect(await runSerial([])).toEqual([]);
  });

  it("executes strictly sequentially even with async delays", async () => {
    const order: string[] = [];
    await runSerial([
      async () => { await sleep(30); order.push("a"); return "a"; },
      async () => { order.push("b"); return "b"; },
    ]);
    expect(order).toEqual(["a", "b"]);
  });
});
