/**
 * Simple async FIFO mutex per key.
 * Serializes tool calls per adapter (one browser page, one navigation at a time).
 */
export class LockManager {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly userHolds = new Map<string, () => void>();

  /**
   * Acquire the lock for `key`. Returns a release function.
   * If the lock is held, waits in FIFO order.
   * Rejects after `timeoutMs` (default 60s) to prevent deadlocks.
   */
  acquire(key: string, timeoutMs = 60_000): Promise<() => void> {
    const existing = this.locks.get(key) ?? Promise.resolve();

    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(key, next);

    return Promise.race([
      existing.then(() => release),
      new Promise<() => void>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Lock timeout after ${timeoutMs}ms for key "${key}"`)),
          timeoutMs
        )
      ),
    ]);
  }

  /**
   * Acquire the lock on behalf of the user (pause mode).
   * The lock is held indefinitely until `releaseUserHold` is called.
   * If a tool is currently running, waits for it to finish first.
   *
   * Fire-and-forget: the caller does NOT await this — the browser becomes
   * "paused" once the current tool (if any) finishes.
   */
  holdForUser(key: string): void {
    if (this.userHolds.has(key)) return; // already held

    this.acquire(key, 10 * 60_000 /* 10 min max hold */).then((release) => {
      this.userHolds.set(key, release);
    }).catch(() => {
      // Timeout — user held too long, cleared automatically
      this.userHolds.delete(key);
    });
  }

  /**
   * Release a user-held lock (resume from pause mode).
   * Any queued tool calls will proceed immediately.
   */
  releaseUserHold(key: string): void {
    const release = this.userHolds.get(key);
    if (release) {
      release();
      this.userHolds.delete(key);
    }
  }

  isUserHolding(key: string): boolean {
    return this.userHolds.has(key);
  }

  releaseAll(): void {
    for (const [key, release] of this.userHolds.entries()) {
      release();
      this.userHolds.delete(key);
    }
    this.locks.clear();
  }
}
