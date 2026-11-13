/**
 * Results panel: one row per selected place with thumbnail, name, category, address, lists and
 * note. Remove rows, sort, filter by list, export. All text goes in via textContent.
 */
import { BASE_CSS, downloadBlob, h, removeHost, shadowHost } from '@/shared/dom';
import type { SavedPlace } from '@/shared/places';
import { details, imageDataUrl, withDetails } from './enrich';
import { haversine } from './geometry';
import { exportFileName, mapsUrl, type ExportPlace, type SelectionSummary } from './export/common';
import { toCsv } from './export/csv';
import { toGeoJson } from './export/geojson';
import { toKml } from './export/kml';
import { toHtmlReport } from './export/html-report';

const PANEL_ID = 'maps-plus-lasso-panel';

const CSS =
  BASE_CSS +
  `
:host { position: fixed; top: 72px; right: 64px; bottom: 24px; width: min(400px, calc(100vw - 80px)); z-index: 2147482500; }
.panel {
  height: 100%; display: flex; flex-direction: column; background: var(--mp-bg); color: var(--mp-fg);
  border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.3); overflow: hidden;
}
header { padding: 12px 14px 10px; border-bottom: 1px solid var(--mp-line); display: grid; gap: 8px; }
.top { display: flex; align-items: center; gap: 8px; }
h2 { font-size: 15px; margin: 0; flex: 1; }
.sub { color: var(--mp-muted); font-size: 12px; margin: 0; }
.controls, .exports { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
select, .chipbtn, .x {
  font: inherit; color: var(--mp-fg); background: var(--mp-bg); border: 1px solid var(--mp-line);
  border-radius: 999px; padding: 3px 10px;
}
.chipbtn:hover, .x:hover { background: var(--mp-hover); }
.chipbtn[disabled] { opacity: .5; cursor: progress; }
.x { border: none; width: 28px; height: 28px; padding: 0; border-radius: 50%; font-size: 16px; line-height: 1; }
ul { list-style: none; margin: 0; padding: 0; overflow: auto; flex: 1; }
li { display: grid; grid-template-columns: 64px 1fr auto; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--mp-line); }
.thumb { width: 64px; height: 64px; border-radius: 8px; object-fit: cover; background: var(--mp-hover); }
.name { font-weight: 600; text-decoration: none; color: inherit; overflow-wrap: anywhere; }
.name:hover { text-decoration: underline; }
.cat { color: var(--mp-accent); font-size: 12px; }
.addr, .lists { color: var(--mp-muted); font-size: 12px; overflow-wrap: anywhere; }
.note { font-size: 12px; white-space: pre-wrap; border-left: 3px solid var(--mp-accent); padding-left: 6px; margin-top: 4px; overflow-wrap: anywhere; }
.empty { padding: 24px 16px; color: var(--mp-muted); display: grid; gap: 10px; }
.empty p { margin: 0; }
.status { font-size: 12px; color: var(--mp-muted); min-height: 16px; }
`;

type SortKey = 'distance' | 'name' | 'list';

export interface PanelData {
  places: SavedPlace[];
  selection: SelectionSummary;
  embedImages: boolean;
}

export interface EmptyStateActions {
  onLoadLists: () => void;
  onImport: (files: FileList) => void;
}

let observer: IntersectionObserver | null = null;

export function closePanel(): void {
  observer?.disconnect();
  observer = null;
  removeHost(PANEL_ID);
}

export function isPanelOpen(): boolean {
  return !!document.getElementById(PANEL_ID);
}

function frame(
  title: string,
  sub: string,
  onClose: () => void,
): { root: ShadowRoot; body: HTMLElement; header: HTMLElement } {
  closePanel();
  const root = shadowHost(PANEL_ID, CSS);
  const close = h(
    'button',
    { class: 'x', type: 'button', 'aria-label': 'Close', title: 'Close' },
    '×',
  );
  close.addEventListener('click', () => {
    closePanel();
    onClose();
  });
  const header = h(
    'header',
    {},
    h('div', { class: 'top' }, h('h2', {}, title), close),
    h('p', { class: 'sub' }, sub),
  );
  const body = h('div', { style: 'display:contents' });
  root.append(
    h(
      'section',
      { class: 'mp panel', role: 'dialog', 'aria-label': 'Maps Plus: selected places' },
      header,
      body,
    ),
  );
  return { root, body, header };
}

/** Shown when there's no saved-place data yet. */
export function openEmptyState(
  actions: EmptyStateActions,
  onClose: () => void,
  captured: number,
): void {
  const { body } = frame(
    captured ? 'No saved places in that area' : 'No saved places loaded yet',
    captured
      ? `${captured} saved places known — none inside your selection.`
      : 'Maps Plus reads the lists Google Maps has already loaded in this tab.',
    onClose,
  );
  const file = h('input', {
    type: 'file',
    accept: '.json,.csv,application/json,text/csv',
    multiple: true,
    style: 'display:none',
  });
  file.addEventListener('change', () => {
    if (file.files?.length) actions.onImport(file.files);
  });
  const load = h('button', { class: 'chipbtn', type: 'button' }, 'Open my Saved lists');
  load.addEventListener('click', actions.onLoadLists);
  const imp = h('button', { class: 'chipbtn', type: 'button' }, 'Import Google Takeout file…');
  imp.addEventListener('click', () => file.click());
  body.append(
    h(
      'div',
      { class: 'empty' },
      h(
        'p',
        {},
        'Open “Saved” in the Maps sidebar and click into each list you want to use. Maps Plus picks the places up as Google loads them — nothing is sent anywhere.',
      ),
      h('p', {}, 'Or import “Saved Places.json” / list CSVs from Google Takeout.'),
      h('div', { class: 'controls' }, load, imp, file),
    ),
  );
}

export function openResults(data: PanelData, onClose: () => void): void {
  let places = data.places.slice();
  let sort: SortKey = 'distance';
  let listFilter = '';
  const enriched = new Map<string, SavedPlace>();

  const selDesc =
    data.selection.kind === 'circle'
      ? `Circle · ${(data.selection.radiusKm ?? 0).toFixed(2)} km radius`
      : 'Freehand lasso';
  const { body, header } = frame(
    `${places.length} saved place${places.length === 1 ? '' : 's'}`,
    selDesc,
    onClose,
  );
  const titleEl = header.querySelector('h2')!;

  const allLists = [...new Set(places.flatMap((p) => p.lists))].sort((a, b) => a.localeCompare(b));
  const sortSel = h(
    'select',
    { 'aria-label': 'Sort by' },
    h('option', { value: 'distance' }, 'Distance'),
    h('option', { value: 'name' }, 'Name'),
    h('option', { value: 'list' }, 'List'),
  );
  const listSel = h(
    'select',
    { 'aria-label': 'Filter by list' },
    h('option', { value: '' }, 'All lists'),
    ...allLists.map((l) => h('option', { value: l }, l)),
  );
  sortSel.addEventListener('change', () => {
    sort = sortSel.value as SortKey;
    renderList();
  });
  listSel.addEventListener('change', () => {
    listFilter = listSel.value;
    renderList();
  });
  const status = h('div', { class: 'status', role: 'status' });
  const exportBtns = (['CSV', 'GeoJSON', 'KML', 'HTML report'] as const).map((label) => {
    const b = h('button', { class: 'chipbtn', type: 'button' }, label);
    b.addEventListener('click', () => void doExport(label, b));
    return b;
  });
  header.append(
    h('div', { class: 'controls' }, sortSel, listSel),
    h('div', { class: 'exports' }, ...exportBtns),
    status,
  );

  const ul = h('ul');
  body.append(ul);

  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer?.unobserve(e.target);
        const key = (e.target as HTMLElement).dataset.key!;
        const p = places.find((x) => x.key === key);
        if (p) void hydrate(p, e.target as HTMLElement);
      }
    },
    { root: ul, rootMargin: '200px' },
  );

  async function hydrate(p: SavedPlace, li: HTMLElement): Promise<void> {
    const d = await details(p);
    const full = withDetails(p, d);
    enriched.set(p.key, full);
    if (!li.isConnected) return;
    const img = li.querySelector<HTMLImageElement>('img.thumb');
    if (img && full.photoUrl && /^https:\/\//.test(full.photoUrl)) img.src = full.photoUrl;
    const cat = li.querySelector('.cat');
    if (cat && !cat.textContent && full.category) cat.textContent = full.category;
    const addr = li.querySelector('.addr');
    if (addr && !addr.textContent && full.address) addr.textContent = full.address;
  }

  function visible(): SavedPlace[] {
    const c = data.selection.center;
    const list = listFilter ? places.filter((p) => p.lists.includes(listFilter)) : places.slice();
    const by: Record<SortKey, (a: SavedPlace, b: SavedPlace) => number> = {
      distance: (a, b) => haversine(c, a) - haversine(c, b),
      name: (a, b) => a.name.localeCompare(b.name),
      list: (a, b) =>
        (a.lists[0] ?? '').localeCompare(b.lists[0] ?? '') || a.name.localeCompare(b.name),
    };
    return list.sort(by[sort]);
  }

  function renderList(): void {
    observer?.disconnect();
    const items = visible();
    titleEl.textContent = `${items.length} saved place${items.length === 1 ? '' : 's'}`;
    ul.replaceChildren(
      ...items.map((p) => {
        const e = enriched.get(p.key) ?? p;
        const remove = h(
          'button',
          {
            class: 'x',
            type: 'button',
            title: 'Remove from selection',
            'aria-label': `Remove ${p.name}`,
          },
          '×',
        );
        remove.addEventListener('click', () => {
          places = places.filter((x) => x.key !== p.key);
          renderList();
        });
        const km = haversine(data.selection.center, p) / 1000;
        const li = h(
          'li',
          { 'data-key': p.key },
          h('img', { class: 'thumb', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
          h(
            'div',
            {},
            h(
              'a',
              { class: 'name', href: mapsUrl(p), target: '_blank', rel: 'noopener noreferrer' },
              p.name,
            ),
            h('div', { class: 'cat' }, e.category ?? ''),
            h('div', { class: 'addr' }, e.address ?? ''),
            h(
              'div',
              { class: 'lists' },
              [p.lists.join(', '), km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`]
                .filter(Boolean)
                .join(' · '),
            ),
            p.note ? h('div', { class: 'note' }, p.note) : null,
          ),
          remove,
        );
        if (e.photoUrl) li.querySelector('img')!.src = e.photoUrl;
        observer?.observe(li);
        return li;
      }),
    );
    if (!items.length)
      ul.append(
        h(
          'li',
          {},
          h('span'),
          h('span', { class: 'addr' }, 'Nothing left in this view.'),
          h('span'),
        ),
      );
  }

  async function doExport(
    kind: 'CSV' | 'GeoJSON' | 'KML' | 'HTML report',
    btn: HTMLButtonElement,
  ): Promise<void> {
    const items = visible();
    if (!items.length) return;
    btn.disabled = true;
    try {
      const full: ExportPlace[] = [];
      for (let i = 0; i < items.length; i++) {
        const p = items[i]!;
        status.textContent = `Gathering details ${i + 1}/${items.length}…`;
        full.push(enriched.get(p.key) ?? withDetails(p, await details(p)));
      }
      let blob: Blob;
      let ext: string;
      switch (kind) {
        case 'CSV':
          blob = new Blob([toCsv(full)], { type: 'text/csv;charset=utf-8' });
          ext = 'csv';
          break;
        case 'GeoJSON':
          blob = new Blob([toGeoJson(full)], { type: 'application/geo+json' });
          ext = 'geojson';
          break;
        case 'KML':
          blob = new Blob([toKml(full)], { type: 'application/vnd.google-earth.kml+xml' });
          ext = 'kml';
          break;
        case 'HTML report': {
          if (data.embedImages) {
            for (let i = 0; i < full.length; i++) {
              const p = full[i]!;
              status.textContent = `Embedding images ${i + 1}/${full.length}…`;
              if (p.photoUrl) p.imageDataUrl = (await imageDataUrl(p.photoUrl)) ?? undefined;
            }
          }
          blob = new Blob([toHtmlReport(full, data.selection)], {
            type: 'text/html;charset=utf-8',
          });
          ext = 'html';
          break;
        }
      }
      downloadBlob(blob, exportFileName(full, ext));
      status.textContent = `Exported ${full.length} place${full.length === 1 ? '' : 's'}.`;
    } catch {
      status.textContent = 'Export failed. Try again, or turn on debug logging in options.';
    } finally {
      btn.disabled = false;
    }
  }

  renderList();
}
