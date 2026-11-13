import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseCsv,
  parseGetlist,
  parseTakeoutCsv,
  parseTakeoutGeoJson,
  stripXssi,
} from '@/features/saved-lasso/data-source';

const synthetic = readFileSync(
  new URL('./fixtures/getlist.synthetic.json', import.meta.url),
  'utf8',
);

describe('stripXssi', () => {
  it('removes the anti-JSON prefix', () => {
    expect(JSON.parse(stripXssi(")]}'\n[1,2]"))).toEqual([1, 2]);
    expect(stripXssi('[1]')).toBe('[1]');
  });
});

describe('parseGetlist (structural, synthetic fixture)', () => {
  const places = parseGetlist(JSON.parse(stripXssi(")]}'\n" + synthetic)));
  it('finds every place with its list name', () => {
    expect(places.map((p) => p.name)).toEqual([
      'Time Out Market',
      'Museu do Fado',
      '=HYPERLINK("http://evil")',
    ]);
    expect(places.every((p) => p.lists[0] === 'Weekend in Lisbon')).toBe(true);
  });
  it('reads address, coordinates and note', () => {
    expect(places[0]).toMatchObject({
      lat: 38.7071,
      lng: -9.1449,
      address: 'R. de São Paulo 1, 1200-111 Lisboa, Portugal',
      note: 'Go hungry. <b>Bring</b> friends & cash',
    });
  });
  it('turns id pairs into feature ids and CIDs', () => {
    expect(places[0]!.cid).toBe('3826718436021358922');
    expect(places[0]!.featureId).toMatch(/^0x[0-9a-f]+:0x[0-9a-f]+$/);
    expect(places[1]!.featureId).toBe('0x0d19347f5e8b1a2b:0x6f4f8f5a2e3d4c5b');
    expect(places[1]!.key).toBe(`cid:${places[1]!.cid}`);
  });
  it('ignores junk without throwing', () => {
    for (const junk of [null, 0, 'x', [], [[[null, null, 1, 2]]], { a: 1 }])
      expect(parseGetlist(junk)).toEqual([]);
  });
});

describe('Takeout CSV', () => {
  it('parses quoted CSV with embedded newlines', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, ""y""","line1\nline2"\n')).toEqual([
      ['a', 'b'],
      ['x, "y"', 'line1\nline2'],
    ]);
  });
  it('imports rows that carry coordinates and reports the rest', () => {
    const csv = [
      'Title,Note,URL,Tags,Comment',
      'Eiffel Tower,Top floor,https://www.google.com/maps/place/Eiffel+Tower/data=!4m2!3m1!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!3d48.8584!4d2.2945,,',
      'Mystery,,https://www.google.com/maps/place/Mystery/data=!4m2!3m1!1s0x1:0x2,,',
    ].join('\n');
    const r = parseTakeoutCsv(csv, 'Paris trip.csv');
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({
      name: 'Eiffel Tower',
      lat: 48.8584,
      lng: 2.2945,
      lists: ['Paris trip'],
      note: 'Top floor',
      cid: '10222232094831998944',
      source: 'takeout',
    });
    expect(r.unresolved).toEqual([{ name: 'Mystery', url: expect.stringContaining('Mystery') }]);
  });
});

describe('Takeout GeoJSON', () => {
  it('reads both property layouts', () => {
    const gj = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-0.1246, 51.5007] },
          properties: {
            Title: 'Big Ben',
            'Google Maps URL': 'http://maps.google.com/?cid=123',
            Location: { Address: 'London SW1A 0AA', 'Business Name': 'Big Ben' },
          },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [139.7005, 35.6595] },
          properties: {
            date: '2024-01-01',
            google_maps_url: 'https://maps.google.com/?cid=456',
            location: { name: 'Shibuya Crossing', address: 'Tokyo' },
            Comment: 'busy',
          },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            google_maps_url: 'https://maps.google.com/?cid=789',
            location: { name: 'No coords' },
          },
        },
      ],
    });
    const r = parseTakeoutGeoJson(gj);
    expect(r.places.map((p) => [p.name, p.cid, p.address, p.lists[0]])).toEqual([
      ['Big Ben', '123', 'London SW1A 0AA', 'Starred'],
      ['Shibuya Crossing', '456', 'Tokyo', 'Starred'],
    ]);
    expect(r.places[1]!.note).toBe('busy');
    expect(r.unresolved).toHaveLength(1);
  });
  it('survives invalid JSON', () => {
    expect(parseTakeoutGeoJson('{nope')).toEqual({ places: [], unresolved: [] });
  });
});
