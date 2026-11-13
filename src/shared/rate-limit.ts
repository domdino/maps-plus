/**
 * Polite request scheduler: at most `concurrency` tasks in flight, at least `minSpacingMs`
 * between task starts, and exponential backoff when a task signals a retryable failure
 * (HTTP 429 / 5xx). One instance lives in the background worker and every request goes
 * through it.
 */
export interface RateLimiterOptions {
  concurrency?: number;
  minSpacingMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  /** Injected for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class RetryableError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RateLimiter {
  private readonly concurrency: number;
  private readonly minSpacingMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private active = 0;
  private lastStart = -Infinity;
  /** While > now(), nobody starts (global backoff after 429/5xx). */
  private pausedUntil = 0;
  private readonly waiters: Array<() => void> = [];
  private pumping = false;

  constructor(opts: RateLimiterOptions = {}) {
    this.concurrency = opts.concurrency ?? 4;
    this.minSpacingMs = opts.minSpacingMs ?? 150;
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseBackoffMs = opts.baseBackoffMs ?? 1000;
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? realSleep;
  }

  get inFlight(): number {
    return this.active;
  }

  /** Run `task`, retrying on RetryableError with exponential backoff + jitter. */
  async schedule<T>(task: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.acquire();
      try {
        return await task();
      } catch (err) {
        if (!(err instanceof RetryableError) || attempt >= this.maxRetries) throw err;
        const backoff = this.baseBackoffMs * 2 ** attempt * (1 + Math.random() * 0.25);
        this.pausedUntil = Math.max(this.pausedUntil, this.now() + backoff);
      } finally {
        this.release();
      }
    }
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      void this.pump();
    });
  }

  private release(): void {
    this.active--;
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.waiters.length > 0 && this.active < this.concurrency) {
        const wait = Math.max(
          this.pausedUntil - this.now(),
          this.lastStart + this.minSpacingMs - this.now(),
        );
        if (wait > 0) await this.sleep(wait);
        if (this.active >= this.concurrency) break;
        const next = this.waiters.shift();
        if (!next) break;
        this.active++;
        this.lastStart = this.now();
        next();
      }
    } finally {
      this.pumping = false;
    }
  }
}
