/**
 * Pano Date Resolver — finds when a Street View panorama was captured, to within ~2 seconds.
 *
 * Technique by emily / itisem (https://pano-date.emily.bz,
 * https://github.com/itisem/pano-date-resolver), reimplemented from scratch here because the
 * original repo has no license:
 *
 *   1. Ask SingleImageSearch for the pano → it reports the capture year + month.
 *   2. Binary-search the timestamp range around that month: ask again (by location, without the
 *      pano ID) with a `photoAge` filter covering the lower half. If imagery comes back, the
 *      capture time is in that half; otherwise it's in the upper half.
 *   3. Stop when the window is ≤ 2 s (~21 requests).
 *
 * Limits: usually only works for the most recent imagery at a location (the location search
 * returns the closest pano, which may be a neighbour), and breaks if Google changes the RPC.
 *
 * No DOM and no network here: the caller injects `search`, so this is fully unit-testable.
 */
import type { SearchParams, SingleImageSearchResult } from './protobuf';

export type SearchFn = (p: SearchParams) => Promise<SingleImageSearchResult>;

export interface ResolveOptions {
  /** Stop when max - min ≤ accuracy seconds. Minimum 2. */
  accuracy?: number;
  /** Seconds of slack added on each side of the reported month (time zones, month edges). */
  slackSeconds?: number;
  onProgress?: (step: number, total: number) => void;
  signal?: AbortSignal;
}

export interface ResolveResult {
  /** Midpoint of the final window, Unix seconds. */
  timestamp: number;
  /** Half the final window, in seconds. */
  accuracy: number;
  year: number;
  month: number;
  steps: number;
}

export class PanoDateError extends Error {
  constructor(
    message: string,
    readonly code: 'unsupported' | 'not-found' | 'no-date' | 'aborted',
  ) {
    super(message);
    this.name = 'PanoDateError';
  }
}

const DAY = 86_400;

/** The search window for a capture month, in Unix seconds, with slack for time zones. */
export function monthWindow(year: number, month: number, slack = 2 * DAY): [number, number] {
  const start = Date.UTC(year, month - 1, 1) / 1000 - slack;
  const end = Date.UTC(year, month, 1) / 1000 + slack;
  return [start, end];
}

/** How many halvings until (max - min) ≤ accuracy. */
export function stepsNeeded(min: number, max: number, accuracy: number): number {
  let steps = 0;
  let span = max - min;
  while (span > accuracy) {
    span = Math.ceil(span / 2);
    steps++;
  }
  return steps;
}

export async function resolvePanoDate(
  loc: { lat: number; lng: number; panoId?: string },
  search: SearchFn,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const accuracy = Math.max(2, opts.accuracy ?? 2);
  const check = () => {
    if (opts.signal?.aborted) throw new PanoDateError('Cancelled', 'aborted');
  };

  check();
  const first = await search({ lat: loc.lat, lng: loc.lng, panoId: loc.panoId });
  if (!first.ok) {
    throw new PanoDateError('No official Street View imagery found here.', 'not-found');
  }
  if (!first.year || !first.month) {
    throw new PanoDateError('Google did not report a capture month for this pano.', 'no-date');
  }
  // Search around the pano's own coordinates when Google gives them back: they're more precise
  // than the URL's and keep the location query pinned to the same capture.
  const lat = first.lat ?? loc.lat;
  const lng = first.lng ?? loc.lng;

  let [min, max] = monthWindow(first.year, first.month, opts.slackSeconds);
  const total = stepsNeeded(min, max, accuracy);
  let step = 0;
  opts.onProgress?.(0, total);

  while (max - min > accuracy) {
    check();
    const mid = Math.floor((min + max) / 2);
    const r = await search({ lat, lng, photoAge: { startSeconds: min, endSeconds: mid } });
    // Imagery in [min, mid] → capture is in the lower half; otherwise the upper half.
    if (r.ok) max = mid;
    else min = mid;
    step++;
    opts.onProgress?.(Math.min(step, total), total);
  }

  return {
    timestamp: (min + max) / 2,
    accuracy: (max - min) / 2,
    year: first.year,
    month: first.month,
    steps: step + 1,
  };
}
