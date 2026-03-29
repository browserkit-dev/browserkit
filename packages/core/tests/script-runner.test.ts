/**
 * Tests for Feature 3: `runScript` QuickJS sandbox
 */
import { describe, it, expect } from "vitest";
import { runScript, ScriptTimeoutError } from "../src/script-runner.js";

// ── Mock page ─────────────────────────────────────────────────────────────────

function makeMockPage(overrides: Record<string, unknown> = {}): import("patchright").Page {
  return {
    url: () => "https://example.com",
    title: async () => "Example Domain",
    goto: async () => null,
    click: async () => {},
    fill: async () => {},
    type: async () => {},
    press: async () => {},
    waitForSelector: async () => null,
    waitForURL: async () => {},
    textContent: async () => "some text",
    innerHTML: async () => "<p>hello</p>",
    evaluate: async (fn: unknown) => {
      if (typeof fn === "function") return fn();
      return null;
    },
    $$eval: async () => [],
    $eval: async () => null,
    screenshot: async () => Buffer.from("fake-png"),
    ...overrides,
  } as unknown as import("patchright").Page;
}

// ── Basic execution ───────────────────────────────────────────────────────────

describe("runScript", () => {
  it("collects console.log output as stdout", async () => {
    const lines: string[] = [];
    await runScript(
      `console.log("hello world");`,
      makeMockPage(),
      { onStdout: (d) => lines.push(d), onStderr: () => {} }
    );
    expect(lines.join("")).toContain("hello world");
  });

  it("routes console.warn and console.error to stderr", async () => {
    const stderr: string[] = [];
    await runScript(
      `console.warn("a warning"); console.error("an error");`,
      makeMockPage(),
      { onStdout: () => {}, onStderr: (d) => stderr.push(d) }
    );
    const out = stderr.join("");
    expect(out).toContain("a warning");
    expect(out).toContain("an error");
  });

  it("can call await page.title()", async () => {
    const lines: string[] = [];
    const page = makeMockPage({ title: async () => "My Page" });
    await runScript(
      `const t = await page.title(); console.log(t);`,
      page,
      { onStdout: (d) => lines.push(d), onStderr: () => {} }
    );
    expect(lines.join("")).toContain("My Page");
  });

  it("can call await page.url()", async () => {
    const lines: string[] = [];
    const page = makeMockPage({ url: () => "https://test.com/path" });
    await runScript(
      `const u = await page.url(); console.log(u);`,
      page,
      { onStdout: (d) => lines.push(d), onStderr: () => {} }
    );
    expect(lines.join("")).toContain("https://test.com/path");
  });

  it("can call await page.textContent()", async () => {
    const lines: string[] = [];
    const page = makeMockPage({ textContent: async () => "scraped text" });
    await runScript(
      `const t = await page.textContent(".result"); console.log(t);`,
      page,
      { onStdout: (d) => lines.push(d), onStderr: () => {} }
    );
    expect(lines.join("")).toContain("scraped text");
  });

  it("supports JSON.stringify in console.log", async () => {
    const lines: string[] = [];
    await runScript(
      `console.log(JSON.stringify({ a: 1, b: "two" }));`,
      makeMockPage(),
      { onStdout: (d) => lines.push(d), onStderr: () => {} }
    );
    const parsed = JSON.parse(lines.join("").trim()) as { a: number; b: string };
    expect(parsed.a).toBe(1);
    expect(parsed.b).toBe("two");
  });

  it("throws ScriptTimeoutError when script exceeds timeout", async () => {
    await expect(
      runScript(
        // Spin-loop the event loop with setTimeout — will time out
        `await new Promise(resolve => setTimeout(resolve, 99999));`,
        makeMockPage(),
        { timeoutMs: 500, onStdout: () => {}, onStderr: () => {} }
      )
    ).rejects.toBeInstanceOf(ScriptTimeoutError);
  });

  it("throws on script syntax error", async () => {
    await expect(
      runScript(
        `this is not valid javascript }{`,
        makeMockPage(),
        { onStdout: () => {}, onStderr: () => {} }
      )
    ).rejects.toThrow();
  });

  it("throws when script throws an error", async () => {
    await expect(
      runScript(
        `throw new Error("intentional failure");`,
        makeMockPage(),
        { onStdout: () => {}, onStderr: () => {} }
      )
    ).rejects.toThrow("intentional failure");
  });
});

// ── Sandbox isolation ─────────────────────────────────────────────────────────

describe("runScript sandbox isolation", () => {
  it("does not expose process global", async () => {
    const stderr: string[] = [];
    await expect(
      runScript(
        `if (typeof process !== 'undefined') throw new Error("process is exposed");`,
        makeMockPage(),
        { onStdout: () => {}, onStderr: (d) => stderr.push(d) }
      )
    ).resolves.toBeUndefined(); // process is not defined in QuickJS — no error thrown
  });

  it("does not allow require()", async () => {
    await expect(
      runScript(
        `require("fs")`,
        makeMockPage(),
        { onStdout: () => {}, onStderr: () => {} }
      )
    ).rejects.toThrow();
  });
});
