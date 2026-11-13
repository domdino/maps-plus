import { describe, expect, it } from 'vitest';
import { RateLimiter, RetryableError, isRetryableStatus } from '@/shared/rate-limit';

describe('RateLimiter', () => {
  it('never exceeds the concurrency limit and spaces starts', async () => {
    const limiter = new RateLimiter({ concurrency: 4, minSpacingMs: 20 });
    let active = 0;
    let peak = 0;
    const starts: number[] = [];
    const task = async () => {
      starts.push(Date.now());
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
    };
    await Promise.all(Array.from({ length: 12 }, () => limiter.schedule(task)));
    expect(peak).toBeLessThanOrEqual(4);
    const sorted = starts.sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++)
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(18);
  });

  it('retries retryable errors with backoff, then gives up', async () => {
    const limiter = new RateLimiter({ minSpacingMs: 0, baseBackoffMs: 5, maxRetries: 2 });
    let n = 0;
    await expect(
      limiter.schedule(async () => {
        n++;
        throw new RetryableError('HTTP 429', 429);
      }),
    ).rejects.toThrow('429');
    expect(n).toBe(3);
  });

  it('succeeds after a transient failure', async () => {
    const limiter = new RateLimiter({ minSpacingMs: 0, baseBackoffMs: 5 });
    let n = 0;
    const v = await limiter.schedule(async () => {
      if (n++ === 0) throw new RetryableError('HTTP 503', 503);
      return 'ok';
    });
    expect(v).toBe('ok');
  });

  it('does not retry ordinary errors', async () => {
    const limiter = new RateLimiter({ minSpacingMs: 0 });
    let n = 0;
    await expect(
      limiter.schedule(async () => {
        n++;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(n).toBe(1);
  });

  it('classifies statuses', () => {
    expect([429, 500, 503].every(isRetryableStatus)).toBe(true);
    expect([200, 400, 404].some(isRetryableStatus)).toBe(false);
  });
});
