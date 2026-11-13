/**
 * Pure parsers for Google Maps URLs. No DOM, no network: everything here is unit-tested.
 *
 * Supported shapes:
 *   Map view:     /maps/@LAT,LNG,ZOOMz[,TILTt]/...       (zoom may be fractional)
 *                 /maps/@LAT,LNG,METERSm/data=...         (satellite / 3D: altitude in metres)
 *   Street View:  /maps/@LAT,LNG,3a,FOVy,HEADINGh,PITCHt/data=...!1s<PANOID>!2e0...
 *                 /maps/@?api=1&map_action=pano&pano=<PANOID>&viewpoint=LAT,LNG
 *                 /maps?...&layer=c&cbll=LAT,LNG[&panoid=<PANOID>]
 */

export interface MapView {
  lat: number;
  lng: number;
  /** Web Mercator zoom level. Undefined when the URL uses metres (satellite / 3D). */
  zoom?: number;
  /** Viewport altitude in metres, when the URL uses the `m` form instead of `z`. */
  meters?: number;
  /** Camera tilt in degrees (0 = flat). */
  tilt: number;
}

export interface StreetViewLocation {
  lat: number;
  lng: number;
  /** Official Street View pano IDs are 22 characters. Others are user photospheres. */
  panoId?: string;
  heading?: number;
  pitch?: number;
  fov?: number;
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const AT_RE = new RegExp(String.raw`/@(${NUM}),(${NUM})((?:,[^/?#]*)?)`);

function toUrl(input: string | URL): URL | null {
  try {
    return input instanceof URL ? input : new URL(input, 'https://www.google.com');
  } catch {
    return null;
  }
}

function validLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

/** Splits the `,3a,75y,90h,...` tail after `@lat,lng` into {suffix: value}. */
function parseAtTail(tail: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const part of tail.split(',')) {
    const m = /^(-?\d+(?:\.\d+)?)([a-z])$/i.exec(part.trim());
    if (m && m[1] && m[2]) out.set(m[2].toLowerCase(), Number(m[1]));
  }
  return out;
}

/** Parse the map viewport from the URL. Returns null for Street View or unknown shapes. */
export function parseMapView(input: string | URL): MapView | null {
  const url = toUrl(input);
  if (!url) return null;
  const m = AT_RE.exec(decodeURIComponent(url.pathname));
  if (!m || !m[1] || !m[2]) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!validLatLng(lat, lng)) return null;
  const tail = parseAtTail(m[3] ?? '');
  if (tail.has('a')) return null; // `3a` marks Street View
  const tilt = tail.get('t') ?? 0;
  const zoom = tail.get('z');
  const meters = tail.get('m');
  if (zoom === undefined && meters === undefined) return null;
  return { lat, lng, zoom, meters, tilt };
}

/** Extract a pano ID from a `data=` blob: `...!1s<PANOID>!2e0...`. */
export function panoIdFromData(path: string): string | undefined {
  // The `!3m..!1e1!3m..!1s<id>!2e0` sequence: `!1s` followed by the id, then `!2e0` (official)
  // or `!2e10` (user-uploaded). We take the id that precedes `!2e`.
  const m = /!1s([^!]+)!2e(\d+)/.exec(path);
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

/** Parse any supported Street View URL. Returns null when the URL isn't Street View. */
export function parseStreetView(input: string | URL): StreetViewLocation | null {
  const url = toUrl(input);
  if (!url) return null;
  const path = decodeURIComponent(url.pathname);

  // 1) /maps/@LAT,LNG,3a,...
  const m = AT_RE.exec(path);
  if (m && m[1] && m[2]) {
    const tail = parseAtTail(m[3] ?? '');
    if (tail.has('a')) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (!validLatLng(lat, lng)) return null;
      return {
        lat,
        lng,
        panoId: panoIdFromData(path),
        fov: tail.get('y'),
        heading: tail.get('h'),
        // In Street View URLs `t` is pitch where 90 = horizon.
        pitch: tail.has('t') ? (tail.get('t') as number) - 90 : undefined,
      };
    }
  }

  const q = url.searchParams;
  // 2) /maps/@?api=1&map_action=pano&pano=...&viewpoint=LAT,LNG
  if (q.get('map_action') === 'pano') {
    const vp = (q.get('viewpoint') ?? '').split(',').map(Number);
    const panoId = q.get('pano') ?? undefined;
    const lat = vp[0];
    const lng = vp[1];
    if (lat !== undefined && lng !== undefined && validLatLng(lat, lng)) {
      return {
        lat,
        lng,
        panoId,
        heading: numOrUndef(q.get('heading')),
        pitch: numOrUndef(q.get('pitch')),
      };
    }
    if (panoId) return { lat: NaN, lng: NaN, panoId };
    return null;
  }

  // 3) /maps?layer=c&cbll=LAT,LNG
  if (q.get('layer') === 'c' && q.get('cbll')) {
    const [lat, lng] = (q.get('cbll') ?? '').split(',').map(Number);
    if (lat === undefined || lng === undefined || !validLatLng(lat, lng)) return null;
    return { lat, lng, panoId: q.get('panoid') ?? undefined };
  }
  return null;
}

function numOrUndef(v: string | null): number | undefined {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Official Google Street View panoramas have 22-character IDs. */
export function isOfficialPanoId(id: string | undefined): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(id);
}

/**
 * Pull coordinates out of a place URL when they're embedded, for Takeout CSV imports.
 * Handles `!3dLAT!4dLNG`, `@LAT,LNG` and `?q=LAT,LNG` / `?query=LAT,LNG`.
 */
export function latLngFromPlaceUrl(input: string): { lat: number; lng: number } | null {
  const d = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(input);
  if (d?.[1] && d[2]) {
    const lat = Number(d[1]);
    const lng = Number(d[2]);
    if (validLatLng(lat, lng)) return { lat, lng };
  }
  const url = toUrl(input);
  if (!url) return null;
  const at = AT_RE.exec(decodeURIComponent(url.pathname));
  if (at?.[1] && at[2]) {
    const lat = Number(at[1]);
    const lng = Number(at[2]);
    if (validLatLng(lat, lng)) return { lat, lng };
  }
  for (const key of ['q', 'query', 'll']) {
    const v = url.searchParams.get(key);
    const mm = v ? new RegExp(String.raw`^\s*(${NUM})\s*,\s*(${NUM})\s*$`).exec(v) : null;
    if (mm?.[1] && mm[2]) {
      const lat = Number(mm[1]);
      const lng = Number(mm[2]);
      if (validLatLng(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

/**
 * Build a stable public Google Maps link for a place. Preference order:
 * an explicit URL we already have, `?cid=` (decimal customer ID), a Places API place ID,
 * then plain coordinates.
 */
export function placeUrl(p: {
  lat: number;
  lng: number;
  name?: string;
  cid?: string;
  placeId?: string;
  url?: string;
}): string {
  if (
    p.url &&
    /^https:\/\/(www\.)?google\.[a-z.]+\/maps|^https:\/\/maps\.google\.[a-z.]+\//.test(p.url)
  ) {
    return p.url;
  }
  if (p.cid && /^\d+$/.test(p.cid)) return `https://maps.google.com/?cid=${p.cid}`;
  const u = new URL('https://www.google.com/maps/search/');
  u.searchParams.set('api', '1');
  if (p.placeId && p.placeId.startsWith('ChIJ') && p.name) {
    u.searchParams.set('query', p.name);
    u.searchParams.set('query_place_id', p.placeId);
  } else {
    u.searchParams.set('query', `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`);
  }
  return u.toString();
}

/** Convert a Maps feature ID's second half (`0x…:0xCID`) to a decimal CID string. */
export function cidFromFeatureId(featureId: string): string | undefined {
  const m = /^0x[0-9a-f]+:0x([0-9a-f]+)$/i.exec(featureId.trim());
  if (!m?.[1]) return undefined;
  return BigInt('0x' + m[1]).toString(10);
}
