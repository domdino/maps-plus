import { describe, expect, it } from 'vitest';
import ok from './fixtures/single-image-search.ok.json';
import noResults from './fixtures/single-image-search.no-results.json';
import {
  buildSingleImageSearchRequest,
  parseSingleImageSearchResponse,
  type SearchParams,
} from '@/features/pano-date/protobuf';
import {
  monthWindow,
  resolvePanoDate,
  stepsNeeded,
  PanoDateError,
} from '@/features/pano-date/resolver';

describe('buildSingleImageSearchRequest', () => {
  it('builds the month lookup (with image key)', () => {
    expect(
      buildSingleImageSearchRequest({
        lat: 40.758,
        lng: -73.9855,
        panoId: 'ywskIOsAFskiKHt5fwIUWA',
      }),
    ).toEqual([
      ['apiv3'],
      [[null, null, 40.758, -73.9855], 30],
      [null, null, null, null, null, null, null, null, [2], null, [[[2, true, 2]]]],
      [[2, 6]],
      [2, 'ywskIOsAFskiKHt5fwIUWA'],
    ]);
  });
  it('puts photoAge at queryOptions.filterOptions[10]', () => {
    const req = buildSingleImageSearchRequest({
      lat: 1,
      lng: 2,
      photoAge: { startSeconds: 10, endSeconds: 20 },
    });
    const q = req[2] as unknown[];
    expect((q[0] as unknown[])[10]).toEqual([10, 20]);
    expect((q[0] as unknown[]).slice(0, 10).every((x) => x === null)).toBe(true);
    expect(req).toHaveLength(4); // no image key
  });
});

describe('parseSingleImageSearchResponse', () => {
  it('reads a real success response (captured 2026-11, public Times Square pano)', () => {
    expect(parseSingleImageSearchResponse(ok)).toEqual({
      ok: true,
      statusCode: 0,
      panoId: 'ywskIOsAFskiKHt5fwIUWA',
      year: 2024,
      month: 8,
      lat: 40.75800333244899,
      lng: -73.98556809141381,
    });
  });
  it('reads NO_RESULTS', () => {
    expect(parseSingleImageSearchResponse(noResults)).toEqual({ ok: false, statusCode: 5 });
  });
  it('never throws on junk', () => {
    for (const junk of [null, 1, 'x', [], [null], [[0]], {}]) {
      expect(parseSingleImageSearchResponse(junk).ok).toBe(false);
    }
  });
});

describe('resolvePanoDate', () => {
  /** Fake server: one pano captured at `truth` (Unix s), in 2024-08. */
  function fakeSearch(truth: number) {
    const calls: SearchParams[] = [];
    const fn = async (p: SearchParams) => {
      calls.push(p);
      if (p.panoId)
        return { ok: true, statusCode: 0, year: 2024, month: 8, lat: 40.758, lng: -73.985 };
      const a = p.photoAge!;
      const hit = truth >= a.startSeconds && truth <= a.endSeconds;
      return hit ? { ok: true, statusCode: 0 } : { ok: false, statusCode: 5 };
    };
    return { fn, calls };
  }

  it('finds the capture time within ±2 s in ~21 requests', async () => {
    const truth = Date.UTC(2024, 7, 17, 14, 3, 27) / 1000;
    const { fn, calls } = fakeSearch(truth);
    const progress: number[] = [];
    const r = await resolvePanoDate(
      { lat: 40.758, lng: -73.985, panoId: 'ywskIOsAFskiKHt5fwIUWA' },
      fn,
      {
        onProgress: (s) => progress.push(s),
      },
    );
    expect(Math.abs(r.timestamp - truth)).toBeLessThanOrEqual(2);
    expect(r.accuracy).toBeLessThanOrEqual(1);
    expect(calls.length).toBeGreaterThanOrEqual(20);
    expect(calls.length).toBeLessThanOrEqual(23);
    expect(progress.at(-1)).toBe(calls.length - 1);
  });

  it('handles captures at the very edges of the month', async () => {
    for (const truth of [Date.UTC(2024, 7, 1) / 1000, Date.UTC(2024, 8, 1) / 1000 - 1]) {
      const r = await resolvePanoDate({ lat: 0, lng: 0, panoId: 'x' }, fakeSearch(truth).fn);
      expect(Math.abs(r.timestamp - truth)).toBeLessThanOrEqual(2);
    }
  });

  it('throws a typed error when nothing is there', async () => {
    await expect(
      resolvePanoDate({ lat: 0, lng: 0 }, async () => ({ ok: false, statusCode: 5 })),
    ).rejects.toBeInstanceOf(PanoDateError);
  });

  it('can be aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      resolvePanoDate({ lat: 0, lng: 0 }, fakeSearch(0).fn, { signal: ac.signal }),
    ).rejects.toThrow('Cancelled');
  });

  it('month window has slack on both sides', () => {
    const [a, b] = monthWindow(2024, 2);
    expect(a).toBe(Date.UTC(2024, 1, 1) / 1000 - 2 * 86400);
    expect(b).toBe(Date.UTC(2024, 2, 1) / 1000 + 2 * 86400);
    expect(stepsNeeded(a, b, 2)).toBe(21);
  });
});
