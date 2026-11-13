import { describe, expect, it } from 'vitest';
import {
  exportFileName,
  safeDataUrl,
  type ExportPlace,
} from '@/features/saved-lasso/export/common';
import { toCsv } from '@/features/saved-lasso/export/csv';
import { toGeoJson } from '@/features/saved-lasso/export/geojson';
import { toKml } from '@/features/saved-lasso/export/kml';
import { toHtmlReport } from '@/features/saved-lasso/export/html-report';
import { sanitizePlace } from '@/shared/places';

const evil = sanitizePlace({
  name: '<img src=x onerror=alert(1)>',
  lat: 38.7071,
  lng: -9.1449,
  address: 'R. "Quoted", Lisboa',
  category: 'Food & drink',
  lists: ['Weekend in Lisbon', 'Food'],
  note: '=cmd|"/c calc"!A1\nline two',
  cid: '3826718436021358922',
})! as ExportPlace;

describe('CSV', () => {
  const csv = toCsv([evil]);
  it('starts with a BOM and the right header', () => {
    expect(
      csv.startsWith(
        '\uFEFFname,category,address,lat,lng,lists,note,google_maps_url,photo_url\r\n',
      ),
    ).toBe(true);
  });
  it('quotes and neutralises formula injection', () => {
    expect(csv).toContain(`"'=cmd|""/c calc""!A1\nline two"`);
    expect(csv).toContain('"R. ""Quoted"", Lisboa"');
    expect(csv).toContain('https://maps.google.com/?cid=3826718436021358922');
  });
});

describe('GeoJSON', () => {
  it('is a valid FeatureCollection with lng,lat order', () => {
    const gj = JSON.parse(toGeoJson([evil]));
    expect(gj.type).toBe('FeatureCollection');
    expect(gj.features[0].geometry.coordinates).toEqual([-9.1449, 38.7071]);
    expect(gj.features[0].properties.lists).toEqual(['Weekend in Lisbon', 'Food']);
  });
});

describe('KML', () => {
  it('escapes names and descriptions', () => {
    const kml = toKml([evil], 'A & B');
    expect(kml).toContain('<name>&lt;img src=x onerror=alert(1)&gt;</name>');
    expect(kml).toContain('<name>A &amp; B</name>');
    expect(kml).not.toContain('<img');
    expect(kml).toContain('<coordinates>-9.1449,38.7071,0</coordinates>');
  });
});

describe('HTML report', () => {
  it('escapes every field and only embeds data: images', () => {
    const withImg = { ...evil, imageDataUrl: 'data:image/jpeg;base64,AAAA' };
    const bad = { ...evil, key: 'k2', imageDataUrl: 'javascript:alert(1)' };
    const html = toHtmlReport(
      [withImg, bad],
      { kind: 'circle', center: { lat: 38.7, lng: -9.1 }, radiusKm: 1.234 },
      new Date(2026, 10, 13),
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('radius 1.23 km');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('@media print');
  });
  it('validates data URLs strictly', () => {
    expect(safeDataUrl('data:image/png;base64,iVBOR==')).toBeDefined();
    expect(safeDataUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeUndefined();
    expect(safeDataUrl('data:image/png;base64,AA"onload=x')).toBeUndefined();
  });
});

describe('file names', () => {
  it('uses list names or "selection" plus the date', () => {
    const d = new Date(2026, 10, 13);
    expect(exportFileName([evil], 'csv', d)).toBe(
      'maps-plus-weekend-in-lisbon-food-2026-11-13.csv',
    );
    const many = ['a', 'b', 'c', 'd'].map((l) => ({ ...evil, lists: [l] }));
    expect(exportFileName(many, 'kml', d)).toBe('maps-plus-selection-2026-11-13.kml');
  });
});

describe('sanitizePlace', () => {
  it('rejects bad coordinates and non-https URLs', () => {
    expect(sanitizePlace({ name: 'x', lat: 91, lng: 0 })).toBeNull();
    expect(sanitizePlace({ name: 'x', lat: 'a', lng: 0 })).toBeNull();
    const p = sanitizePlace({
      name: 'x',
      lat: 1,
      lng: 2,
      url: 'javascript:alert(1)',
      photoUrl: 'http://x',
      cid: 'abc',
    })!;
    expect(p.url).toBeUndefined();
    expect(p.photoUrl).toBeUndefined();
    expect(p.cid).toBeUndefined();
    expect(p.key).toBe('ll:1.000000,2.000000:x');
  });
});
