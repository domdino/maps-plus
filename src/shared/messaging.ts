import { browser } from 'wxt/browser';

/**
 * Typed messages from content scripts to the background worker. The background worker is the
 * only place that makes network requests (rate limiting + CORS live there).
 */
export interface PanoDateProgress {
  step: number;
  total: number;
}

export interface PanoDateResult {
  /** Unix seconds (midpoint of the final ≤2 s window). */
  timestamp: number;
  /** Half-width of the uncertainty window, in seconds. */
  accuracy: number;
  year: number;
  month: number;
  /** IANA time zone of the photo location, from the bundled offline lookup. */
  timeZone?: string;
}

export interface PlaceDetails {
  name?: string;
  address?: string;
  category?: string;
  photoUrl?: string;
}

export type Request =
  | { type: 'pano-date/resolve'; lat: number; lng: number; panoId?: string; requestId: string }
  | { type: 'places/details'; key: string; name: string; lat: number; lng: number }
  | { type: 'image/data-url'; url: string; maxWidth: number; quality: number };

export type Response<T extends Request['type']> = T extends 'pano-date/resolve'
  ? PanoDateResult
  : T extends 'places/details'
    ? PlaceDetails
    : T extends 'image/data-url'
      ? string | null
      : never;

export type Envelope<T> = { ok: true; value: T } | { ok: false; error: string };

/** Progress pushed from background to the tab that asked for a pano date. */
export interface PanoProgressMessage {
  type: 'pano-date/progress';
  requestId: string;
  progress: PanoDateProgress;
}

export async function send<R extends Request>(req: R): Promise<Response<R['type']>> {
  const env = (await browser.runtime.sendMessage(req)) as Envelope<Response<R['type']>> | undefined;
  if (!env) throw new Error('No response from background worker');
  if (!env.ok) throw new Error(env.error);
  return env.value;
}
