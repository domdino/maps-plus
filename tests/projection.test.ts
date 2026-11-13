import { describe, expect, it } from 'vitest';
import {
  fromScreen,
  metersPerPixel,
  project,
  toScreen,
  unproject,
  zoomFromMeters,
  type Viewport,
} from '@/features/saved-lasso/projection';

describe('project', () => {
  it('matches known Web Mercator world pixels', () => {
    expect(project(0, 0, 0)).toEqual({ x: 128, y: 128 });
    const p = project(85.05112878, 180, 0);
    expect(p.x).toBeCloseTo(256, 6);
    expect(p.y).toBeCloseTo(0, 3);
    // Google's canonical example: Chicago at zoom 3.
    const c = project(41.85, -87.65, 3);
    expect(c.x).toBeCloseTo(525.4, 1);
    expect(c.y).toBeCloseTo(761.4, 1);
  });
  it('round-trips', () => {
    for (const [lat, lng, z] of [
      [51.5, -0.12, 10],
      [-33.86, 151.2, 18],
      [64.1, -21.9, 3.5],
    ] as const) {
      const p = project(lat, lng, z);
      const back = unproject(p.x, p.y, z);
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lng).toBeCloseTo(lng, 9);
    }
  });
});

describe('toScreen / fromScreen', () => {
  const canvas = { left: 400, top: 0, width: 1000, height: 800 };
  it('puts the view centre at the canvas centre', () => {
    const v: Viewport = { lat: 48.8584, lng: 2.2945, zoom: 15, canvas };
    expect(toScreen(48.8584, 2.2945, v)).toEqual({ x: 900, y: 400 });
  });
  it('moves 256 px per world tile at zoom 0 → 1 px per 360/256° of longitude', () => {
    const v: Viewport = { lat: 0, lng: 0, zoom: 0, canvas };
    expect(toScreen(0, 360 / 256, v).x).toBeCloseTo(901, 9);
  });
  it('round-trips through the screen at zooms 3, 10, 18', () => {
    for (const zoom of [3, 10, 18]) {
      const v: Viewport = { lat: 37.7749, lng: -122.4194, zoom, canvas };
      const s = toScreen(37.775, -122.419, v);
      const back = fromScreen(s.x, s.y, v);
      expect(back.lat).toBeCloseTo(37.775, 8);
      expect(back.lng).toBeCloseTo(-122.419, 8);
    }
  });
  it('wraps across the antimeridian to the nearest copy', () => {
    const v: Viewport = { lat: -17, lng: 179.9, zoom: 8, canvas };
    const east = toScreen(-17, -179.9, v); // just across the line
    const west = toScreen(-17, 179.7, v);
    expect(east.x).toBeGreaterThan(900);
    expect(east.x - 900).toBeLessThan(200);
    expect(west.x).toBeLessThan(900);
  });
});

describe('scale helpers', () => {
  it('metres per pixel at the equator, zoom 0 ≈ 156 km', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
  });
  it('zoomFromMeters inverts metresPerPixel', () => {
    const z = zoomFromMeters(metersPerPixel(40, 14) * 800, 40, 800);
    expect(z).toBeCloseTo(14, 9);
  });
});
