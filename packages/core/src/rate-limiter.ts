/**
 * Enforces a minimum delay between consecutive tool calls for the same key.
 * Configured per adapter via adapter.rateLimit.minDelayMs.
 */
export class RateLimiter {
  private readonly lastCallAt = new Map<string, number>();

  /**
   * Wait until at least `minDelayMs` has passed since the last call for `key`.
   * If no previous call, resolves immediately.
   */
  async waitIfNeeded(key: string, minDelayMs: number): Promise<void> {
    const last = this.lastCallAt.get(key);
    if (last === undefined) return;
    const elapsed = Date.now() - last;
    const remaining = minDelayMs - elapsed;
    if (remaining > 0) {
      await sleep(remaining);
    }
  }

  /** Record that a call just completed for `key`. */
  recordCall(key: string): void {
    this.lastCallAt.set(key, Date.now());
  }

  /** Reset state (for testing). */
  reset(): void {
    this.lastCallAt.clear();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
