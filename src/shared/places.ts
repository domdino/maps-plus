/** A saved place as Maps Plus understands it. Every string field is untrusted Google/user data. */
export interface SavedPlace {
  /** Stable key: `cid:<decimal>`, `fid:<0x..:0x..>`, `pid:<ChIJ..>`, or `ll:<lat>,<lng>:<name>`. */
  key: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  category?: string;
  /** Names of the saved lists this place belongs to. */
  lists: string[];
  note?: string;
  cid?: string;
  featureId?: string;
  placeId?: string;
  url?: string;
  photoUrl?: string;
  /** Where the record came from. */
  source: 'intercepted' | 'takeout';
}

const MAX_STR = 2000;

function str(v: unknown, max = MAX_STR): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;
}

/** Make a key for a place from whatever identifiers it has. */
export function placeKey(p: {
  cid?: string;
  featureId?: string;
  placeId?: string;
  lat: number;
  lng: number;
  name: string;
}): string {
  if (p.cid) return `cid:${p.cid}`;
  if (p.featureId) return `fid:${p.featureId}`;
  if (p.placeId) return `pid:${p.placeId}`;
  return `ll:${p.lat.toFixed(6)},${p.lng.toFixed(6)}:${p.name.toLowerCase()}`;
}

/**
 * Validate and normalise an untrusted object into a SavedPlace. Used on every message that
 * crosses a trust boundary (MAIN world → isolated world, storage → UI, file import → UI).
 */
export function sanitizePlace(raw: unknown): SavedPlace | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lat = typeof r.lat === 'number' ? r.lat : NaN;
  const lng = typeof r.lng === 'number' ? r.lng : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  const name = str(r.name, 500) ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const lists = Array.isArray(r.lists)
    ? [...new Set(r.lists.map((l) => str(l, 200)).filter((l): l is string => !!l))].slice(0, 50)
    : [];
  const cid = str(r.cid, 30);
  const featureId = str(r.featureId, 60);
  const placeId = str(r.placeId, 300);
  const url = str(r.url);
  const photoUrl = str(r.photoUrl);
  const p: SavedPlace = {
    key: '',
    name,
    lat,
    lng,
    address: str(r.address, 500),
    category: str(r.category, 200),
    lists,
    note: str(r.note, 5000),
    cid: cid && /^\d+$/.test(cid) ? cid : undefined,
    featureId: featureId && /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(featureId) ? featureId : undefined,
    placeId,
    url: url && /^https:\/\//.test(url) ? url : undefined,
    photoUrl: photoUrl && /^https:\/\//.test(photoUrl) ? photoUrl : undefined,
    source: r.source === 'takeout' ? 'takeout' : 'intercepted',
  };
  p.key = placeKey(p);
  return p;
}

/** Merge two records for the same place, unioning list membership. */
export function mergePlaces(a: SavedPlace, b: SavedPlace): SavedPlace {
  return {
    ...a,
    ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined && v !== '')),
    lists: [...new Set([...a.lists, ...b.lists])],
    key: a.key,
  } as SavedPlace;
}
