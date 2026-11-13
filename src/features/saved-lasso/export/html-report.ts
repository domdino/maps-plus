import {
  escapeHtml,
  mapsUrl,
  safeDataUrl,
  type ExportPlace,
  type SelectionSummary,
} from './common';

/**
 * Self-contained, print-friendly HTML report. Every value is escaped; images are only ever
 * embedded as validated data: URLs, so the file makes no network requests when opened.
 */
export function toHtmlReport(
  places: ExportPlace[],
  selection: SelectionSummary | null,
  now = new Date(),
): string {
  const e = escapeHtml;
  const summary = selection
    ? selection.kind === 'circle'
      ? `Circle centred on ${selection.center.lat.toFixed(5)}, ${selection.center.lng.toFixed(5)}, radius ${(selection.radiusKm ?? 0).toFixed(2)} km`
      : `Custom lasso around ${selection.center.lat.toFixed(5)}, ${selection.center.lng.toFixed(5)}`
    : 'Selection';
  const cards = places
    .map((p) => {
      const img = safeDataUrl(p.imageDataUrl);
      return `<article class="card">
  ${img ? `<img src="${img}" alt="">` : '<div class="ph" aria-hidden="true"></div>'}
  <div class="body">
    <h2>${e(p.name)}</h2>
    ${p.category ? `<p class="cat">${e(p.category)}</p>` : ''}
    ${p.address ? `<p>${e(p.address)}</p>` : ''}
    <p class="meta">${e(p.lat.toFixed(6))}, ${e(p.lng.toFixed(6))}${p.lists.length ? ` · ${e(p.lists.join(', '))}` : ''}</p>
    ${p.note ? `<p class="note">${e(p.note)}</p>` : ''}
    <p class="link"><a href="${e(mapsUrl(p))}">${e(mapsUrl(p))}</a></p>
  </div>
</article>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>Maps Plus — ${e(String(places.length))} places</title>
<style>
  :root { color-scheme: light; --fg:#1f1f1f; --muted:#5f6368; --line:#dadce0; --accent:#0b7a5a; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 900px; padding: 32px 16px; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg); background: #fff; }
  header { border-bottom: 2px solid var(--accent); margin-bottom: 20px; padding-bottom: 12px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  header p { margin: 2px 0; color: var(--muted); }
  .card { display: flex; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--line); break-inside: avoid; page-break-inside: avoid; }
  .card img, .card .ph { width: 160px; height: 120px; object-fit: cover; border-radius: 6px; flex: none; background: #eef1f0; }
  .body { min-width: 0; }
  h2 { font-size: 16px; margin: 0 0 2px; }
  p { margin: 2px 0; overflow-wrap: anywhere; }
  .cat { color: var(--accent); font-weight: 600; }
  .meta, .link { color: var(--muted); font-size: 12px; }
  .note { white-space: pre-wrap; background: #f6f8f7; border-left: 3px solid var(--accent); padding: 4px 8px; }
  a { color: inherit; }
  footer { margin-top: 24px; color: var(--muted); font-size: 12px; }
  @media (max-width: 560px) { .card { flex-direction: column; } .card img, .card .ph { width: 100%; height: 180px; } }
  @media print { body { padding: 0; max-width: none; } a { text-decoration: none; } .link { display: none; } }
</style>
</head>
<body>
<header>
  <h1>${e(String(places.length))} saved place${places.length === 1 ? '' : 's'}</h1>
  <p>${e(summary)}</p>
  <p>Generated ${e(now.toLocaleString())} with Maps Plus</p>
</header>
<main>
${cards}
</main>
<footer>Maps Plus is not affiliated with Google. Map data and photos © their respective owners.</footer>
</body>
</html>
`;
}
