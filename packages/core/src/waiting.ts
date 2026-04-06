type Falsy = false | "" | 0 | null | undefined;

/**
 * Thrown by waitUntil when the timeout elapses before the predicate resolves truthy.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export const SECOND = 1000;

function timeoutPromise<T>(
  ms: number,
  promise: Promise<T>,
  description: string,
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new TimeoutError(description));
    }, ms);
  });
  return Promise.race([promise, timeout]);
}

/**
 * Poll `asyncTest` every `interval` ms until it resolves with a truthy value,
 * or reject with TimeoutError after `timeout` ms.
 *
 * This is the core polling primitive. Build higher-level waits on top of it:
 * waitForRedirect, waitForUrl, waitUntilIframeFound, and any custom
 * "wait for app state" patterns.
 *
 * @param asyncTest   Async predicate — resolves truthy to stop polling.
 * @param description Human-readable label included in the TimeoutError message.
 * @param timeout     Max wait in ms (default: 10 000).
 * @param interval    Poll interval in ms (default: 100).
 */
export function waitUntil<T>(
  asyncTest: () => Promise<T | Falsy>,
  description = "",
  timeout = 10_000,
  interval = 100,
): Promise<T> {
  const promise = new Promise<T>((resolve, reject) => {
    function poll() {
      asyncTest()
        .then((value) => {
          if (value) {
            resolve(value as T);
          } else {
            setTimeout(poll, interval);
          }
        })
        .catch(() => reject(new Error(`waitUntil predicate threw: ${description}`)));
    }
    poll();
  });
  return timeoutPromise(timeout, promise, description);
}

/**
 * Race a promise against a timeout. Silently swallows TimeoutError so callers
 * can "try but continue if too slow" without a try/catch.
 */
export function raceTimeout<T>(ms: number, promise: Promise<T>): Promise<T | void> {
  return timeoutPromise(ms, promise, "timeout").catch((err: unknown) => {
    if (!(err instanceof TimeoutError)) throw err;
  });
}

/**
 * Run an array of async action factories sequentially, collecting results.
 * Equivalent to `for...of await` but expressed as a reducer for composability.
 */
export function runSerial<T>(actions: Array<() => Promise<T>>): Promise<T[]> {
  return actions.reduce(
    (acc, action) => acc.then(async (results) => [...results, await action()]),
    Promise.resolve([] as T[]),
  );
}

/**
 * Pause execution for `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
