import { describe, expect, it } from 'vitest';
import {
  centroid,
  haversine,
  pointInCircle,
  pointInPolygon,
  simplify,
} from '@/features/saved-lasso/geometry';

describe('geometry', () => {
  it('point in circle (inclusive edge)', () => {
    expect(pointInCircle({ x: 3, y: 4 }, { x: 0, y: 0 }, 5)).toBe(true);
    expect(pointInCircle({ x: 3.1, y: 4 }, { x: 0, y: 0 }, 5)).toBe(false);
  });
  it('point in polygon (concave)', () => {
    const c = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 5, y: 4 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 2, y: 2 }, c)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 8 }, c)).toBe(false); // in the notch
    expect(pointInPolygon({ x: 11, y: 5 }, c)).toBe(false);
  });
  it('simplify keeps corners and drops collinear points', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplify(line, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 49, y: 0 },
    ]);
    const l = [
      { x: 0, y: 0 },
      { x: 5, y: 0.1 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(simplify(l, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });
  it('simplify survives very long paths', () => {
    const pts = Array.from({ length: 100_000 }, (_, i) => ({ x: i, y: Math.sin(i / 10) * 50 }));
    expect(simplify(pts, 2).length).toBeLessThan(pts.length);
  });
  it('centroid', () => {
    expect(
      centroid([
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ]),
    ).toEqual({ x: 1, y: 1 });
  });
  it('haversine London → Paris ≈ 344 km', () => {
    expect(
      haversine({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 }) / 1000,
    ).toBeCloseTo(343.6, 0);
  });
});
