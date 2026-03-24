import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "patchright";
import { getLogger } from "./logger.js";

const log = getLogger("observability");

export interface TraceEntry {
  tool: string;
  site: string;
  startedAt: string;
  durationMs: number;
  success: boolean;
  error?: string | undefined;
  screenshotPath?: string | undefined;
  tracePath?: string | undefined;
  accessibilitySnapshotPath?: string | undefined;
}

export interface ObservabilityOptions {
  dataDir: string;
  site: string;
  toolName: string;
  context?: BrowserContext | undefined;
  page?: Page | undefined;
}

/**
 * Wraps a tool call with full observability:
 * - Playwright trace (start/stop)
 * - Screenshot on completion (error) or on request
 * - Accessibility tree snapshot
 * - Structured timing log
 */
export async function withObservability<T>(
  opts: ObservabilityOptions,
  fn: () => Promise<T>
): Promise<T> {
  const { dataDir, site, toolName, context, page } = opts;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const traceDir = path.join(dataDir, "traces", site, `${timestamp}-${toolName}`);
  fs.mkdirSync(traceDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  let tracePath: string | undefined;
  let screenshotPath: string | undefined;
  let accessibilitySnapshotPath: string | undefined;

  // Start Playwright trace
  if (context) {
    try {
      await context.tracing.start({ screenshots: true, snapshots: true });
    } catch {
      // tracing may already be started; ignore
    }
  }

  let success = false;
  let error: string | undefined;
  let result: T;

  try {
    result = await fn();
    success = true;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const durationMs = Date.now() - startMs;

    // Stop trace
    if (context) {
      try {
        tracePath = path.join(traceDir, "trace.zip");
        await context.tracing.stop({ path: tracePath });
      } catch {
        tracePath = undefined;
      }
    }

    // Screenshot on error
    if (!success && page) {
      try {
        screenshotPath = path.join(traceDir, "error.png");
        await page.screenshot({ path: screenshotPath, type: "png", fullPage: false });
      } catch {
        screenshotPath = undefined;
      }
    }

    // Accessibility snapshot (best-effort — API varies by Playwright version)
    if (page) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pageAny = page as any;
        const snapshot: string | undefined =
          typeof pageAny.ariaSnapshot === "function"
            ? await pageAny.ariaSnapshot()
            : undefined;
        if (snapshot) {
          accessibilitySnapshotPath = path.join(traceDir, "a11y.txt");
          fs.writeFileSync(accessibilitySnapshotPath, snapshot);
        }
      } catch {
        accessibilitySnapshotPath = undefined;
      }
    }

    // Write timing log
    const entry: TraceEntry = {
      tool: toolName,
      site,
      startedAt,
      durationMs,
      success,
      error,
      screenshotPath,
      tracePath,
      accessibilitySnapshotPath,
    };
    const logPath = path.join(traceDir, "trace.json");
    fs.writeFileSync(logPath, JSON.stringify(entry, null, 2));
    log.debug({ site, tool: toolName, durationMs, success }, "tool call complete");
  }

  return result!;
}
