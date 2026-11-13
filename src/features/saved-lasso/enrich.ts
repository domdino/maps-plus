/**
 * Place details (photo, category, address) for the results panel and exports.
 *
 * Order: data already on the record (from intercepted responses) → the user's own Places API
 * (New) key, if they've set one → a neutral placeholder. The background worker rate-limits and
 * caches lookups by place key for 30 days.
 */
import { send, type PlaceDetails } from '@/shared/messaging';
import type { SavedPlace } from '@/shared/places';

const memo = new Map<string, Promise<PlaceDetails>>();

export function details(p: SavedPlace): Promise<PlaceDetails> {
  let d = memo.get(p.key);
  if (!d) {
    d = send({ type: 'places/details', key: p.key, name: p.name, lat: p.lat, lng: p.lng }).catch(
      () => ({}),
    );
    memo.set(p.key, d);
  }
  return d;
}

/** Merge looked-up details under the record's own values (the record wins). */
export function withDetails(p: SavedPlace, d: PlaceDetails): SavedPlace {
  return {
    ...p,
    address: p.address ?? d.address,
    category: p.category ?? d.category,
    photoUrl: p.photoUrl ?? d.photoUrl,
  };
}

/** Download + downscale an image to a data URL (max 400 px wide, JPEG q0.8) for reports. */
export function imageDataUrl(url: string): Promise<string | null> {
  return send({ type: 'image/data-url', url, maxWidth: 400, quality: 0.8 }).catch(() => null);
}

export function clearMemo(): void {
  memo.clear();
}
