/**
 * QuickJS sandbox script runner for browserkit.
 *
 * Exposes a `page` proxy inside the QuickJS VM that bridges to the real
 * Playwright Page object on the Node.js host. Scripts run isolated from the
 * host filesystem and Node.js environment — only the page proxy and console
 * are available.
 *
 * Inspired by dev-browser's sandbox architecture but uses a direct method-proxy
 * approach rather than embedding a full Playwright client inside the VM.
 */

import {
  getQuickJS,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSContext,
} from "quickjs-emscripten";
import type { Page } from "patchright";
import util from "node:util";
import { getLogger } from "./logger.js";

const log = getLogger("script-runner");

// ── Public API ────────────────────────────────────────────────────────────────

export class ScriptTimeoutError extends Error {
  constructor(timeoutMs: number) {
    const s = timeoutMs >= 1000 ? `${timeoutMs / 1000}s` : `${timeoutMs}ms`;
    super(`Script timed out after ${s} and was terminated`);
    this.name = "ScriptTimeoutError";
  }
}

export interface ScriptRunnerOptions {
  /** Maximum wall-clock time for the script. Default: 30 000 ms. */
  timeoutMs?: number | undefined;
  /** Called for each console.log / console.info line from the sandbox. */
  onStdout: (data: string) => void;
  /** Called for each console.warn / console.error line from the sandbox. */
  onStderr: (data: string) => void;
}

/**
 * Run `code` inside a QuickJS WASM sandbox with a proxied Playwright Page.
 *
 * The sandbox exposes:
 *   - `page`         — Playwright Page proxy (async methods)
 *   - `console`      — routes to onStdout / onStderr
 *   - `setTimeout`   — sandboxed timer
 *
 * The code is wrapped in an async IIFE automatically.
 *
 * @example
 * await runScript(`
 *   await page.goto("https://example.com");
 *   console.log(await page.title());
 * `, livePage, { onStdout: process.stdout.write.bind(process.stdout), onStderr: ... });
 */
export async function runScript(
  code: string,
  page: Page,
  opts: ScriptRunnerOptions
): Promise<void> {
  const { timeoutMs = 30_000, onStdout, onStderr } = opts;

  const qjs = await getQuickJS();
  const runtime: QuickJSRuntime = qjs.newRuntime();
  const ctx: QuickJSContext = runtime.newContext();

  const pendingDeferreds = new Set<QuickJSDeferredPromise>();

  // ── Handle conversion ────────────────────────────────────────────────────

  function toHandle(value: unknown): QuickJSHandle {
    if (value === undefined || value === null) return ctx.undefined.dup();
    if (typeof value === "boolean") return value ? ctx.true.dup() : ctx.false.dup();
    if (typeof value === "number") return ctx.newNumber(value);
    if (typeof value === "string") return ctx.newString(value);
    if (Buffer.isBuffer(value)) return ctx.newString(value.toString("base64"));
    if (value instanceof Uint8Array) return ctx.newString(Buffer.from(value).toString("base64"));
    if (Array.isArray(value)) {
      const arr = ctx.newArray();
      value.forEach((item, i) => {
        const h = toHandle(item);
        try { ctx.setProp(arr, i, h); } finally { h.dispose(); }
      });
      return arr;
    }
    if (typeof value === "object") {
      const obj = ctx.newObject();
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const h = toHandle(v);
        try { ctx.setProp(obj, k, h); } finally { h.dispose(); }
      }
      return obj;
    }
    return ctx.newString(String(value));
  }

  function makeErrorHandle(err: unknown): QuickJSHandle {
    const name = err instanceof Error ? (err.name || "Error") : "Error";
    const msg = err instanceof Error ? err.message : String(err);
    return ctx.newError({ name, message: msg });
  }

  // ── Job draining (QuickJS microtask queue) ────────────────────────────────

  function drainJobs(): void {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = runtime.executePendingJobs();
      if (result.error) {
        result.error.dispose();
        break;
      }
      if (result.value === 0) break;
    }
  }

  // ── Bridge a Node.js Promise into a QuickJS Promise ───────────────────────

  function bridgeAsync(promise: Promise<unknown>): QuickJSHandle {
    const deferred = ctx.newPromise();
    pendingDeferreds.add(deferred);

    promise
      .then((value) => {
        if (!deferred.alive) return;
        const h = toHandle(value);
        try { deferred.resolve(h); } finally { h.dispose(); }
      })
      .catch((err: unknown) => {
        if (!deferred.alive) return;
        const h = makeErrorHandle(err);
        try { deferred.reject(h); } finally { h.dispose(); }
      })
      .finally(() => {
        pendingDeferreds.delete(deferred);
        drainJobs();
      });

    return deferred.handle;
  }

  // ── Argument deserialization ──────────────────────────────────────────────
  // The sandbox serializes call args to JSON. Functions are serialized as
  // { __fn__: "source string" } so they can be reconstructed on the host.

  function deserializeArg(raw: unknown): unknown {
    if (
      raw !== null &&
      typeof raw === "object" &&
      "__fn__" in (raw as object) &&
      typeof (raw as { __fn__: unknown }).__fn__ === "string"
    ) {
      const src = (raw as { __fn__: string }).__fn__;
      // Reconstruct the function — Playwright serialises it again when
      // sending to the browser context, so this is safe.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      return new Function(`return (${src})`)();
    }
    if (Array.isArray(raw)) return raw.map(deserializeArg);
    return raw;
  }

  // ── Page method dispatch ──────────────────────────────────────────────────

  async function dispatchPageCall(method: string, argsJson: string): Promise<unknown> {
    const rawArgs: unknown[] = JSON.parse(argsJson) as unknown[];
    const args = rawArgs.map(deserializeArg);

    switch (method) {
      case "goto":
        return page.goto(args[0] as string, args[1] as never);
      case "title":
        return page.title();
      case "url":
        return page.url();
      case "click":
        return page.click(args[0] as string, args[1] as never);
      case "fill":
        return page.fill(args[0] as string, args[1] as string, args[2] as never);
      case "type":
        return page.type(args[0] as string, args[1] as string, args[2] as never);
      case "press":
        return page.press(args[0] as string, args[1] as string, args[2] as never);
      case "waitForSelector":
        return page.waitForSelector(args[0] as string, args[1] as never);
      case "waitForURL":
        return page.waitForURL(args[0] as string | RegExp, args[1] as never);
      case "textContent":
        return page.textContent(args[0] as string, args[1] as never);
      case "innerHTML":
        return page.innerHTML(args[0] as string, args[1] as never);
      case "evaluate":
        // args[0] is a function (deserialized from __fn__ source) or a string
        return page.evaluate(args[0] as never, args[1]);
      case "$$eval":
        // args: selector, fn, arg
        return page.$$eval(args[0] as string, args[1] as never, args[2]);
      case "$eval":
        return page.$eval(args[0] as string, args[1] as never, args[2]);
      case "screenshot": {
        const buf = await page.screenshot({ type: "png", ...(args[0] as object ?? {}) });
        return buf.toString("base64");
      }
      default:
        throw new Error(`page.${method}() is not supported in the sandbox`);
    }
  }

  // ── Console ───────────────────────────────────────────────────────────────

  function installConsole(): void {
    const consoleObj = ctx.newObject();
    for (const level of ["log", "info", "warn", "error"] as const) {
      const fn = ctx.newFunction(level, (...argHandles) => {
        const parts = argHandles.map((h) => {
          const v = ctx.dump(h);
          return typeof v === "string" ? v : util.inspect(v, { depth: 4, compact: true, colors: false });
        });
        const line = parts.join(" ") + "\n";
        if (level === "warn" || level === "error") onStderr(line);
        else onStdout(line);
      });
      ctx.setProp(consoleObj, level, fn);
      fn.dispose();
    }
    ctx.setProp(ctx.global, "console", consoleObj);
    consoleObj.dispose();
  }

  // ── setTimeout (needed for page.waitForTimeout and user scripts) ──────────

  // Track all duped callback handles so we can dispose them on cleanup
  const activeTimerCallbacks: QuickJSHandle[] = [];

  function installTimers(): void {
    let nextId = 1;
    const timers = new Map<number, ReturnType<typeof setTimeout>>();

    const setTimeoutFn = ctx.newFunction("setTimeout", (callbackHandle, delayHandle) => {
      const timerId = nextId++;
      const delay = Math.max(0, ctx.getNumber(delayHandle));
      const callbackDup = callbackHandle.dup();
      activeTimerCallbacks.push(callbackDup);
      const nodeTimer = setTimeout(() => {
        timers.delete(timerId);
        // Remove from tracking list
        const idx = activeTimerCallbacks.indexOf(callbackDup);
        if (idx !== -1) activeTimerCallbacks.splice(idx, 1);
        if (ctx.alive) {
          const result = ctx.callFunction(callbackDup, ctx.undefined);
          if (result.error) result.error.dispose();
          else result.value.dispose();
          callbackDup.dispose();
          drainJobs();
        } else {
          callbackDup.dispose();
        }
      }, delay);
      timers.set(timerId, nodeTimer);
      return ctx.newNumber(timerId);
    });

    const clearTimeoutFn = ctx.newFunction("clearTimeout", (timerIdHandle) => {
      const id = ctx.getNumber(timerIdHandle);
      const t = timers.get(id);
      if (t !== undefined) { clearTimeout(t); timers.delete(id); }
    });

    ctx.setProp(ctx.global, "setTimeout", setTimeoutFn);
    ctx.setProp(ctx.global, "clearTimeout", clearTimeoutFn);
    setTimeoutFn.dispose();
    clearTimeoutFn.dispose();
  }

  // ── __page_call host function ─────────────────────────────────────────────

  function installPageHostFn(): void {
    const hostFn = ctx.newFunction("__page_call", (methodHandle, argsJsonHandle) => {
      const method = ctx.getString(methodHandle);
      const argsJson = ctx.getString(argsJsonHandle);
      return bridgeAsync(dispatchPageCall(method, argsJson));
    });
    ctx.setProp(ctx.global, "__page_call", hostFn);
    hostFn.dispose();
  }

  // ── Sandbox page object init script ──────────────────────────────────────
  // Runs inside QuickJS to set up `page` and `globalThis.page`.

  const PAGE_INIT = `
    (function() {
      function wrapArg(arg) {
        if (typeof arg === 'function') return { __fn__: arg.toString() };
        if (Array.isArray(arg)) return arg.map(wrapArg);
        return arg;
      }
      function callPage(method) {
        var args = Array.prototype.slice.call(arguments, 1);
        return __page_call(method, JSON.stringify(args.map(wrapArg)));
      }
      var page = {
        goto:            function(url, opts)     { return callPage('goto', url, opts); },
        title:           function()              { return callPage('title'); },
        url:             function()              { return callPage('url'); },
        click:           function(sel, opts)     { return callPage('click', sel, opts); },
        fill:            function(sel, val, opts){ return callPage('fill', sel, val, opts); },
        type:            function(sel, txt, opts){ return callPage('type', sel, txt, opts); },
        press:           function(sel, key, opts){ return callPage('press', sel, key, opts); },
        waitForSelector: function(sel, opts)     { return callPage('waitForSelector', sel, opts); },
        waitForURL:      function(url, opts)     { return callPage('waitForURL', url, opts); },
        textContent:     function(sel, opts)     { return callPage('textContent', sel, opts); },
        innerHTML:       function(sel, opts)     { return callPage('innerHTML', sel, opts); },
        evaluate:        function(fn, arg)       { return callPage('evaluate', fn, arg); },
        $$eval:          function(sel, fn, arg)  { return callPage('$$eval', sel, fn, arg); },
        $eval:           function(sel, fn, arg)  { return callPage('$eval', sel, fn, arg); },
        screenshot:      function(opts)          { return callPage('screenshot', opts); },
      };
      Object.defineProperty(globalThis, 'page', { value: page, enumerable: true, writable: false, configurable: false });
    })();
  `;

  // ── Event loop pump ───────────────────────────────────────────────────────
  // Awaits a QuickJS promise by repeatedly draining pending jobs and yielding
  // to the Node.js event loop until the promise settles.

  async function awaitQuickJSPromise(promiseHandle: QuickJSHandle): Promise<void> {
    let settled = false;

    const nativePromise = ctx.resolvePromise(promiseHandle).finally(() => {
      settled = true;
    });

    const deadline = Date.now() + timeoutMs;

    while (!settled) {
      drainJobs();
      if (settled) break;
      if (Date.now() > deadline) {
        throw new ScriptTimeoutError(timeoutMs);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    drainJobs();

    const result = await nativePromise;
    if (result.error) {
      const err = ctx.dump(result.error);
      result.error.dispose();
      const name = (err as { name?: unknown } | null)?.name;
      const msg = (err as { message?: unknown } | null)?.message ?? String(err);
      const error = new Error(typeof msg === "string" ? msg : String(msg));
      if (typeof name === "string") error.name = name;
      throw error;
    }
    result.value.dispose();
  }

  // ── Main execution ────────────────────────────────────────────────────────

  try {
    installConsole();
    installTimers();
    installPageHostFn();

    // Set up the page proxy
    const initResult = ctx.evalCode(PAGE_INIT, "sandbox-init.js");
    if (initResult.error) {
      const err = ctx.dump(initResult.error);
      initResult.error.dispose();
      throw new Error(`Sandbox init failed: ${JSON.stringify(err)}`);
    }
    initResult.value.dispose();

    // Execute the user script wrapped in an async IIFE
    const wrapped = `(async () => {\n${code}\n})()`;
    const scriptResult = ctx.evalCode(wrapped, "user-script.js");
    if (scriptResult.error) {
      const err = ctx.dump(scriptResult.error);
      scriptResult.error.dispose();
      throw new Error(`Script syntax error: ${JSON.stringify(err)}`);
    }

    // Wait for the async IIFE promise to settle — always dispose the handle
    try {
      await awaitQuickJSPromise(scriptResult.value);
    } finally {
      try { if (scriptResult.value.alive) scriptResult.value.dispose(); } catch { /* ignore */ }
    }
  } finally {
    // Clean up any pending deferreds
    for (const d of pendingDeferreds) {
      try { d.dispose(); } catch { /* ignore */ }
    }
    pendingDeferreds.clear();

    // Dispose any timer callback handles that outlived their timers
    for (const h of activeTimerCallbacks) {
      try { if (h.alive) h.dispose(); } catch { /* ignore */ }
    }
    activeTimerCallbacks.length = 0;

    try { ctx.dispose(); } catch (err) { log.warn({ err }, "ctx dispose error"); }
    try { runtime.dispose(); } catch (err) { log.warn({ err }, "runtime dispose error"); }
  }
}
