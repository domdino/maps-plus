import { placeUrl } from '@/shared/maps-url';
import type { SavedPlace } from '@/shared/places';

/** What every export receives. */
export interface ExportPlace extends SavedPlace {
  /** Embedded image (data:image/jpeg;base64,…) for HTML/DOCX reports. */
  imageDataUrl?: string;
}

export interface SelectionSummary {
  kind: 'circle' | 'lasso';
  /** Circle centre (or lasso centroid). */
  center: { lat: number; lng: number };
  radiusKm?: number;
}

export function mapsUrl(p: SavedPlace): string {
  return placeUrl(p);
}

export const COLUMNS = [
  'name',
  'category',
  'address',
  'lat',
  'lng',
  'lists',
  'note',
  'google_maps_url',
  'photo_url',
] as const;

export function row(p: SavedPlace): Record<(typeof COLUMNS)[number], string> {
  return {
    name: p.name,
    category: p.category ?? '',
    address: p.address ?? '',
    lat: p.lat.toFixed(7),
    lng: p.lng.toFixed(7),
    lists: p.lists.join('; '),
    note: p.note ?? '',
    google_maps_url: mapsUrl(p),
    photo_url: p.photoUrl ?? '',
  };
}

export function slug(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'selection'
  );
}

/** maps-plus-<listnames-or-selection>-<YYYY-MM-DD>.<ext> */
export function exportFileName(places: SavedPlace[], ext: string, now = new Date()): string {
  const lists = [...new Set(places.flatMap((p) => p.lists))];
  const base = lists.length > 0 && lists.length <= 3 ? lists.join('-') : 'selection';
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `maps-plus-${slug(base)}-${d}.${ext}`;
}

export function escapeXml(s: string): string {
  return (
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      // Strip characters that are illegal in XML 1.0.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  );
}

export const escapeHtml = escapeXml;

const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
export function safeDataUrl(s: string | undefined): string | undefined {
  return s && DATA_URL_RE.test(s) ? s : undefined;
}
