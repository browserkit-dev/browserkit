import { describe, it, expect } from "vitest";
import adapter from "../src/index.js";

describe("rescue-flights adapter", () => {
  it("has correct metadata", () => {
    expect(adapter.site).toBe("rescue-flights");
    expect(adapter.domain).toBe("elal.com");
    expect(adapter.loginUrl).toContain("elal.com");
  });

  it("is always considered logged in (both sites are public)", async () => {
    const loggedIn = await adapter.isLoggedIn({} as never);
    expect(loggedIn).toBe(true);
  });

  it("exposes the two expected tools", () => {
    const names = adapter.tools().map((t) => t.name);
    expect(names).toContain("get_elal_flights");
    expect(names).toContain("get_israir_flights");
  });

  it("exposes selectors for health_check reporting", () => {
    expect(adapter.selectors).toBeDefined();
    const keys = Object.keys(adapter.selectors ?? {});
    expect(keys.some((k) => k.startsWith("elal_"))).toBe(true);
    expect(keys.some((k) => k.startsWith("israir_"))).toBe(true);
  });

  it("has a rate limit configured", () => {
    expect(adapter.rateLimit).toBeDefined();
    expect((adapter.rateLimit?.minDelayMs ?? 0)).toBeGreaterThan(0);
  });

  // ── get_elal_flights schema ───────────────────────────────────────────────

  it("get_elal_flights schema accepts 'to_israel'", () => {
    const tool = adapter.tools().find((t) => t.name === "get_elal_flights")!;
    expect(tool.inputSchema.safeParse({ direction: "to_israel" }).success).toBe(true);
  });

  it("get_elal_flights schema accepts 'from_israel'", () => {
    const tool = adapter.tools().find((t) => t.name === "get_elal_flights")!;
    expect(tool.inputSchema.safeParse({ direction: "from_israel" }).success).toBe(true);
  });

  it("get_elal_flights schema rejects unknown direction", () => {
    const tool = adapter.tools().find((t) => t.name === "get_elal_flights")!;
    expect(tool.inputSchema.safeParse({ direction: "sideways" }).success).toBe(false);
  });

  it("get_elal_flights schema uses 'to_israel' as default", () => {
    const tool = adapter.tools().find((t) => t.name === "get_elal_flights")!;
    const result = tool.inputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { direction: string }).direction).toBe("to_israel");
    }
  });

  // ── get_israir_flights schema ─────────────────────────────────────────────

  it("get_israir_flights schema accepts 'to_tel_aviv'", () => {
    const tool = adapter.tools().find((t) => t.name === "get_israir_flights")!;
    expect(tool.inputSchema.safeParse({ direction: "to_tel_aviv" }).success).toBe(true);
  });

  it("get_israir_flights schema accepts 'from_tel_aviv'", () => {
    const tool = adapter.tools().find((t) => t.name === "get_israir_flights")!;
    expect(tool.inputSchema.safeParse({ direction: "from_tel_aviv" }).success).toBe(true);
  });

  it("get_israir_flights schema rejects unknown direction", () => {
    const tool = adapter.tools().find((t) => t.name === "get_israir_flights")!;
    expect(tool.inputSchema.safeParse({ direction: "sideways" }).success).toBe(false);
  });

  it("get_israir_flights schema uses 'to_tel_aviv' as default", () => {
    const tool = adapter.tools().find((t) => t.name === "get_israir_flights")!;
    const result = tool.inputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { direction: string }).direction).toBe("to_tel_aviv");
    }
  });

  // ── tool annotations ──────────────────────────────────────────────────────

  it("both tools are annotated as readOnly and openWorld", () => {
    for (const tool of adapter.tools()) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.openWorldHint).toBe(true);
    }
  });
});
