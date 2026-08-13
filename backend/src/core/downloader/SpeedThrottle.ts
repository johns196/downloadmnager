/**
 * Token-bucket rate limiter shared by every chunk worker of a single job
 * (and optionally by a global bucket for the whole process). Workers call
 * `consume(n)` before writing `n` bytes and await until enough tokens have
 * refilled -- this is what makes pause (limit=0 is handled by the queue,
 * not here) and speed-throttling behave the same way at the code level.
 */
export class SpeedThrottle {
  private capacityBytesPerSec: number | null;
  private tokens: number;
  private lastRefill: number;

  constructor(bytesPerSec: number | null) {
    this.capacityBytesPerSec = bytesPerSec;
    this.tokens = bytesPerSec ?? Number.POSITIVE_INFINITY;
    this.lastRefill = Date.now();
  }

  setLimit(bytesPerSec: number | null): void {
    this.capacityBytesPerSec = bytesPerSec;
    if (bytesPerSec === null) this.tokens = Number.POSITIVE_INFINITY;
  }

  getLimit(): number | null {
    return this.capacityBytesPerSec;
  }

  private refill(): void {
    if (this.capacityBytesPerSec === null) return;
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.lastRefill = now;
    this.tokens = Math.min(
      this.capacityBytesPerSec,
      this.tokens + elapsedSec * this.capacityBytesPerSec,
    );
  }

  async consume(bytes: number, signal?: AbortSignal): Promise<void> {
    if (this.capacityBytesPerSec === null) return;
    // Pays the *full* amount, potentially across several refill cycles --
    // capping what's charged per call to the bucket capacity (as an
    // earlier version of this did) undercharges every read larger than
    // one second's worth of tokens, letting the real transfer rate run
    // well above the configured cap. The bucket can only ever hold
    // `capacityBytesPerSec` tokens (see refill()), so a single read
    // larger than that necessarily spans multiple wait/refill cycles --
    // that's correct throttling, not a bug to avoid.
    let remaining = bytes;
    while (remaining > 0) {
      this.refill();
      const take = Math.min(remaining, this.tokens);
      if (take > 0) {
        this.tokens -= take;
        remaining -= take;
      }
      if (remaining <= 0) return;
      const shortfall = Math.min(remaining, this.capacityBytesPerSec);
      const waitMs = Math.max(5, Math.ceil((shortfall / this.capacityBytesPerSec) * 1000));
      await sleep(Math.min(waitMs, 250), signal);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
