/**
 * Where saved places come from, in order of preference:
 *
 * 1. INTERCEPTED (preferred). `maps-main-world.content.ts` watches the page's own responses
 *    from `/maps/preview/entitylist/getlist` (fetched when the user opens a saved list) and
 *    posts the parsed JSON here. We never make these requests ourselves.
 *
 * 2. TAKEOUT IMPORT (fallback). `Saved Places.json` (GeoJSON, starred places) and the
 *    per-list CSVs (Title, Note, URL, …) from Google Takeout → "Maps (your places)" / "Saved".
 *
 * ── getlist response layout ─────────────────────────────────────────────────────────────────
 * STATUS: UNVERIFIED. Google does not document this endpoint and it needs a signed-in session,
 * so the layout below has not yet been checked by a maintainer in DevTools. The parser is
 * therefore *structural*: it doesn't depend on exact indices, only on these shapes, which are
 * the ones Maps uses throughout its JSPB payloads:
 *
 *   coordinate    [null, null, <lat: number>, <lng: number>]
 *   location      [ …, "<address>", <coordinate>, [<feature-id parts>], … ]   (contains a coordinate)
 *   place record  [ …, <location>, "<name>", "<note>?", … ]                  (contains a location)
 *   list record   [ …, "<list name>", …, [<place record>, …], … ]
 *
 * Expected (to be confirmed) concrete paths, documented so a maintainer can verify quickly:
 *   list name   ≈ root[0][4]
 *   places      ≈ root[0][8][i]
 *   name        ≈ place[2]          note ≈ place[3]
 *   address     ≈ place[1][4]       lat/lng ≈ place[1][5][2..3]
 *   feature id  ≈ place[1][6]       (pair of ids → "0x…:0x…" or decimal CID)
 *
 * When you verify, add an anonymised capture to tests/fixtures/ and pin the paths here.
 */
import { cidFromFeatureId, latLngFromPlaceUrl } from '@/shared/maps-url';
import { sanitizePlace, type SavedPlace } from '@/shared/places';

/** Strip Google's anti-JSON-hijacking prefix `)]}'`. */
export function stripXssi(text: string): string {
  return text.replace(/^\s*\)\]\}'\s*,?\s*/, '');
}

type J = unknown;

function isCoord(a: J): a is [null, null, number, number] {
  return (
    Array.isArray(a) &&
    a.length >= 4 &&
    a.length <= 6 &&
    a[0] == null &&
    a[1] == null &&
    typeof a[2] === 'number' &&
    typeof a[3] === 'number' &&
    Math.abs(a[2]) <= 90 &&
    Math.abs(a[3]) <= 180 &&
    !(a[2] === 0 && a[3] === 0)
  );
}

const FID_RE = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;
const URLISH = /^(https?:)?\/\//;
const IDISH = /^[\w-]{16,}$/; // long tokens with no spaces: ids, not names

function isTextish(s: J): s is string {
  return (
    typeof s === 'string' &&
    s.trim().length > 0 &&
    s.length <= 500 &&
    !URLISH.test(s) &&
    !FID_RE.test(s) &&
    !IDISH.test(s) &&
    !s.startsWith('/g/') &&
    !s.startsWith('/m/')
  );
}

/** Depth-first search for the first value matching `pred`, up to `maxDepth`. */
function find(v: J, pred: (x: J) => boolean, maxDepth: number): J | undefined {
  if (pred(v)) return v;
  if (maxDepth <= 0 || !Array.isArray(v)) return undefined;
  for (const c of v) {
    const r = find(c, pred, maxDepth - 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

function toUnsigned64(dec: string): string {
  let n = BigInt(dec);
  if (n < 0n) n += 1n << 64n;
  return n.toString(10);
}

/** Pull a feature id / CID out of a location block. */
function ids(loc: J[]): { featureId?: string; cid?: string } {
  const fid = find(loc, (x) => typeof x === 'string' && FID_RE.test(x), 3) as string | undefined;
  if (fid) return { featureId: fid, cid: cidFromFeatureId(fid) };
  // A pair of ids: ["0x…","0x…"] or ["-123…","456…"] (signed int64 halves).
  const pair = find(
    loc,
    (x) =>
      Array.isArray(x) &&
      x.length === 2 &&
      x.every((s) => typeof s === 'string' && (/^0x[0-9a-f]+$/i.test(s) || /^-?\d{5,20}$/.test(s))),
    2,
  ) as [string, string] | undefined;
  if (!pair) return {};
  const [a, b] = pair;
  if (a.startsWith('0x')) {
    const featureId = `${a}:${b}`;
    return { featureId, cid: cidFromFeatureId(featureId) };
  }
  try {
    const hi = BigInt(toUnsigned64(a)).toString(16);
    const lo = BigInt(toUnsigned64(b)).toString(16);
    return { featureId: `0x${hi}:0x${lo}`, cid: toUnsigned64(b) };
  } catch {
    return {};
  }
}

interface RawPlace {
  name?: string;
  note?: string;
  address?: string;
  lat: number;
  lng: number;
  featureId?: string;
  cid?: string;
  photoUrl?: string;
}

/** Try to read one place record. `rec` must directly contain a location block. */
function readPlace(rec: J[]): RawPlace | null {
  const locIdx = rec.findIndex((x) => Array.isArray(x) && x.some(isCoord));
  if (locIdx === -1) return null;
  const loc = rec[locIdx] as J[];
  const coord = loc.find(isCoord) as [null, null, number, number];
  const strings = rec.filter((x, i) => i !== locIdx && isTextish(x)) as string[];
  const address = (loc.filter(isTextish) as string[]).sort((a, b) => b.length - a.length)[0];
  const name = strings.find((s) => s !== address);
  if (!name) return null;
  const note = strings.slice(strings.indexOf(name) + 1).find((s) => s !== address && s !== name);
  const photoUrl = find(
    rec,
    (x) => typeof x === 'string' && /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//.test(x),
    4,
  ) as string | undefined;
  return { name, note, address, lat: coord[2], lng: coord[3], ...ids(loc), photoUrl };
}

/** Find the list name: the first text-like string directly inside the list record. */
function readListName(listRec: J[]): string | undefined {
  return listRec.find(isTextish) as string | undefined;
}

/**
 * Structural parser for a getlist response (already parsed JSON). Returns places with the
 * list name attached. Never throws on unexpected input.
 */
export function parseGetlist(root: J, fallbackListName = 'Saved'): SavedPlace[] {
  const out = new Map<string, SavedPlace>();
  const visit = (node: J, depth: number, listName: string | undefined): void => {
    if (!Array.isArray(node) || depth > 12) return;
    // Is `node` an array of place records? Then its parent is the list record.
    const records = node.filter((x): x is J[] => Array.isArray(x));
    const places = records.map(readPlace).filter((p): p is RawPlace => !!p);
    if (places.length > 0 && places.length >= records.length / 2) {
      for (const raw of places) {
        const p = sanitizePlace({
          ...raw,
          lists: [listName ?? fallbackListName],
          source: 'intercepted',
        });
        if (p && !out.has(p.key)) out.set(p.key, p);
      }
      return;
    }
    const ownName = readListName(node) ?? listName;
    for (const c of node) visit(c, depth + 1, ownName);
  };
  visit(root, 0, undefined);
  return [...out.values()];
}

// ── Takeout import ────────────────────────────────────────────────────────────────────────

/** RFC 4180-ish CSV parser (quotes, escaped quotes, CRLF, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export interface ImportResult {
  places: SavedPlace[];
  /** Rows we couldn't place on the map (no coordinates in the URL). */
  unresolved: Array<{ name: string; url?: string }>;
}

/** Takeout per-list CSV: Title, Note, URL[, Tags, Comment]. List name comes from the file name. */
export function parseTakeoutCsv(text: string, fileName: string): ImportResult {
  const rows = parseCsv(text);
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iTitle = col('title');
  const iNote = col('note');
  const iUrl = col('url');
  const iComment = col('comment');
  const list = fileName.replace(/\.csv$/i, '').trim() || 'Imported';
  const places: SavedPlace[] = [];
  const unresolved: ImportResult['unresolved'] = [];
  for (const r of rows) {
    const name = (r[iTitle] ?? '').trim();
    const url = (r[iUrl] ?? '').trim();
    const note = [r[iNote], r[iComment]].filter((x) => x && x.trim()).join('\n');
    const ll = url ? latLngFromPlaceUrl(url) : null;
    if (!ll) {
      if (name || url) unresolved.push({ name: name || url, url: url || undefined });
      continue;
    }
    const fid = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(url)?.[1];
    const p = sanitizePlace({
      name,
      lat: ll.lat,
      lng: ll.lng,
      note,
      url,
      featureId: fid,
      cid: fid ? cidFromFeatureId(fid) : undefined,
      lists: [list],
      source: 'takeout',
    });
    if (p) places.push(p);
  }
  return { places, unresolved };
}

/**
 * Takeout `Saved Places.json` (GeoJSON). Two property layouts exist in the wild:
 *   old: { Title, "Google Maps URL", Location: { Address, "Business Name", "Geo Coordinates" } }
 *   new: { date, google_maps_url, location: { address, name, country_code }, Comment }
 */
export function parseTakeoutGeoJson(text: string, listName = 'Starred'): ImportResult {
  const places: SavedPlace[] = [];
  const unresolved: ImportResult['unresolved'] = [];
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { places, unresolved };
  }
  const features = (data as { features?: unknown })?.features;
  if (!Array.isArray(features)) return { places, unresolved };
  for (const f of features) {
    const props = (f?.properties ?? {}) as Record<string, unknown>;
    const loc = (props.location ?? props.Location ?? {}) as Record<string, unknown>;
    const url = (props.google_maps_url ?? props['Google Maps URL']) as string | undefined;
    const name = (loc.name ?? loc['Business Name'] ?? props.Title ?? props.name) as
      string | undefined;
    const coords = f?.geometry?.coordinates;
    let lat = Array.isArray(coords) ? Number(coords[1]) : NaN;
    let lng = Array.isArray(coords) ? Number(coords[0]) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      const ll = url ? latLngFromPlaceUrl(url) : null;
      if (!ll) {
        unresolved.push({ name: name ?? url ?? 'Unnamed place', url });
        continue;
      }
      ({ lat, lng } = ll);
    }
    const cidMatch = url ? /[?&]cid=(\d+)/.exec(url) : null;
    const p = sanitizePlace({
      name,
      lat,
      lng,
      address: loc.address ?? loc.Address,
      note: props.Comment ?? props.comment,
      url,
      cid: cidMatch?.[1],
      lists: [listName],
      source: 'takeout',
    });
    if (p) places.push(p);
  }
  return { places, unresolved };
}

export function parseTakeoutFile(text: string, fileName: string): ImportResult {
  if (/\.csv$/i.test(fileName)) return parseTakeoutCsv(text, fileName);
  return parseTakeoutGeoJson(text);
}
