/**
 * Web Mercator projection between lat/lng and screen pixels.
 *
 *   worldSize = 256 · 2^zoom
 *   x = (lng + 180) / 360 · worldSize
 *   y = (0.5 − ln((1 + sin φ) / (1 − sin φ)) / (4π)) · worldSize
 *
 * The URL's `@lat,lng` is the centre of the map canvas element (not the window), so screen
 * position = canvas centre + (projected point − projected centre).
 */
import type { Rect } from '@/shared/maps-dom';

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  lat: number;
  lng: number;
  zoom: number;
  /** Map canvas rect in client (viewport) pixels. */
  canvas: Rect;
}

const MAX_LAT = 85.05112878;

export function worldSize(zoom: number): number {
  return 256 * 2 ** zoom;
}

export function project(lat: number, lng: number, zoom: number): Point {
  const size = worldSize(zoom);
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export function unproject(x: number, y: number, zoom: number): { lat: number; lng: number } {
  const size = worldSize(zoom);
  const lng = (x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / size;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lng: ((((lng + 180) % 360) + 360) % 360) - 180 };
}

/** Lat/lng → client pixel. Picks the copy of the world nearest the centre (antimeridian). */
export function toScreen(lat: number, lng: number, v: Viewport): Point {
  const size = worldSize(v.zoom);
  const c = project(v.lat, v.lng, v.zoom);
  const p = project(lat, lng, v.zoom);
  let dx = p.x - c.x;
  if (dx > size / 2) dx -= size;
  else if (dx < -size / 2) dx += size;
  return {
    x: v.canvas.left + v.canvas.width / 2 + dx,
    y: v.canvas.top + v.canvas.height / 2 + (p.y - c.y),
  };
}

/** Client pixel → lat/lng. */
export function fromScreen(x: number, y: number, v: Viewport): { lat: number; lng: number } {
  const c = project(v.lat, v.lng, v.zoom);
  return unproject(
    c.x + (x - (v.canvas.left + v.canvas.width / 2)),
    c.y + (y - (v.canvas.top + v.canvas.height / 2)),
    v.zoom,
  );
}

/**
 * Approximate zoom when the URL gives the viewport in metres (`,1234m` — satellite/3D views).
 * We treat the value as the ground distance spanned by the canvas height at the centre latitude.
 * UNVERIFIED against live Maps: callers should label results from this path as approximate.
 */
export function zoomFromMeters(meters: number, lat: number, canvasHeightPx: number): number {
  const metresPerPixelAtZ0 = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 256;
  const mpp = meters / Math.max(1, canvasHeightPx);
  return Math.log2(metresPerPixelAtZ0 / mpp);
}

/** Metres per screen pixel at a latitude and zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / worldSize(zoom);
}
