import { escapeXml, mapsUrl, type ExportPlace } from './common';

/** KML 2.2 — opens in Google Earth and imports into Google My Maps. */
export function toKml(places: ExportPlace[], title = 'Maps Plus export'): string {
  const marks = places.map((p) => {
    const desc = [
      p.category,
      p.address,
      p.lists.length ? `Lists: ${p.lists.join(', ')}` : '',
      p.note ? `Note: ${p.note}` : '',
      mapsUrl(p),
    ]
      .filter(Boolean)
      .join('\n');
    return [
      '    <Placemark>',
      `      <name>${escapeXml(p.name)}</name>`,
      `      <description>${escapeXml(desc)}</description>`,
      p.address ? `      <address>${escapeXml(p.address)}</address>` : '',
      `      <Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>`,
      '    </Placemark>',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${escapeXml(title)}</name>`,
    ...marks,
    '  </Document>',
    '</kml>',
    '',
  ].join('\n');
}
