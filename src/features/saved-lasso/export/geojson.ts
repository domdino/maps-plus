import { COLUMNS, row, type ExportPlace } from './common';

export function toGeoJson(places: ExportPlace[]): string {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features: places.map((p) => {
        const r = row(p);
        const properties: Record<string, string | string[]> = {};
        for (const c of COLUMNS) if (c !== 'lat' && c !== 'lng') properties[c] = r[c];
        properties.lists = p.lists;
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties,
        };
      }),
    },
    null,
    2,
  );
}
