/**
 * Live check against Google's real SingleImageSearch RPC. Skipped unless LIVE=1:
 *   LIVE=1 npx vitest run tests/live
 * Makes ~22 requests, spaced like the extension does. Never run in CI.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSingleImageSearchRequest,
  parseSingleImageSearchResponse,
  SINGLE_IMAGE_SEARCH_URL,
  type SearchParams,
} from '@/features/pano-date/protobuf';
import { resolvePanoDate } from '@/features/pano-date/resolver';
import { RateLimiter } from '@/shared/rate-limit';

const limiter = new RateLimiter({ concurrency: 1, minSpacingMs: 150 });

async function search(p: SearchParams) {
  return limiter.schedule(async () => {
    const res = await fetch(SINGLE_IMAGE_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json+protobuf' },
      body: JSON.stringify(buildSingleImageSearchRequest(p)),
    });
    return parseSingleImageSearchResponse(await res.json());
  });
}

describe.skipIf(!process.env.LIVE)('live SingleImageSearch', () => {
  it('resolves a public Times Square pano to a moment inside its capture month', async () => {
    const r = await resolvePanoDate(
      { lat: 40.758, lng: -73.9855, panoId: 'ywskIOsAFskiKHt5fwIUWA' },
      search,
    );
    const d = new Date(r.timestamp * 1000);
    console.log('resolved', d.toISOString(), `±${r.accuracy}s`, `${r.steps} requests`);
    expect(r.accuracy).toBeLessThanOrEqual(1);
    expect(d.getUTCFullYear()).toBe(r.year);
    // Allow the ±2-day slack across month boundaries.
    expect(Math.abs(d.getUTCMonth() + 1 - r.month) <= 1).toBe(true);
    // Sanity: the pano itself still comes back for a tight window around the answer.
    const tight = await search({
      lat: 40.758,
      lng: -73.9855,
      photoAge: { startSeconds: r.timestamp - 5, endSeconds: r.timestamp + 5 },
    });
    expect(tight.ok).toBe(true);
  }, 60_000);
});
