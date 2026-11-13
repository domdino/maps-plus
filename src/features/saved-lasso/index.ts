import type { Feature, FeatureContext } from '../registry';
import { isBridgeMessage } from '@/shared/bridge';
import { findSavedNavButton, mapCanvasRect, sidePanelRect, type Rect } from '@/shared/maps-dom';
import { parseMapView, parseStreetView } from '@/shared/maps-url';
import { mergePlaces, sanitizePlace, type SavedPlace } from '@/shared/places';
import { onDomChange, onUrlChange, waitForStable } from '@/shared/spa-watch';
import { getSavedPlaces, setSavedPlaces } from '@/shared/storage';
import { logger } from '@/shared/log';
import { parseTakeoutFile } from './data-source';
import { centroid, pointInCircle, pointInPolygon } from './geometry';
import {
  clearHighlights,
  isSelecting,
  removeControl,
  showHighlights,
  startSelection,
  stopSelection,
  syncControl,
  toast,
  type Shape,
} from './overlay';
import { closePanel, isPanelOpen, openEmptyState, openResults } from './panel';
import { fromScreen, metersPerPixel, toScreen, zoomFromMeters, type Viewport } from './projection';
import type { SelectionSummary } from './export/common';

const log = logger('saved-lasso');

let places: Record<string, SavedPlace> = {};
let cleanups: Array<() => void> = [];
let ctx: FeatureContext | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let highlightUrl = '';

function count(): number {
  return Object.keys(places).length;
}

function ingest(incoming: SavedPlace[]): number {
  let added = 0;
  for (const p of incoming) {
    const prev = places[p.key];
    if (!prev) added++;
    places[p.key] = prev ? mergePlaces(prev, p) : p;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void setSavedPlaces(places), 500);
  sync();
  return added;
}

function onWindowMessage(ev: MessageEvent): void {
  if (!isBridgeMessage(ev)) return;
  const valid = ev.data.places.map(sanitizePlace).filter((p): p is SavedPlace => !!p);
  const added = ingest(valid);
  log.debug(`captured ${valid.length} places from ${ev.data.endpoint} (${added} new)`);
  if (added > 0) toast(`Maps Plus: picked up ${added} saved place${added === 1 ? '' : 's'}.`);
}

async function importFiles(files: FileList): Promise<void> {
  let added = 0;
  let unresolved = 0;
  for (const f of Array.from(files)) {
    if (f.size > 20 * 1024 * 1024) continue;
    const res = parseTakeoutFile(await f.text(), f.name);
    added += ingest(res.places);
    unresolved += res.unresolved.length;
  }
  closePanel();
  toast(
    `Imported ${added} place${added === 1 ? '' : 's'}` +
      (unresolved ? `; ${unresolved} had no coordinates in their URL and were skipped.` : '.'),
    7000,
  );
}

function selectableArea(): Rect {
  const canvas = mapCanvasRect();
  const panel = sidePanelRect();
  if (!panel) return canvas;
  const left = Math.max(canvas.left, panel.left + panel.width);
  return { ...canvas, left, width: Math.max(0, canvas.left + canvas.width - left) };
}

async function begin(): Promise<void> {
  if (isSelecting()) {
    stopSelection();
    sync();
    return;
  }
  closePanel();
  clearHighlights();
  const view = await waitForStable(() => parseMapView(location.href), 300);
  if (!view) {
    toast('Switch to the map (not Street View or a place photo) to select.');
    return;
  }
  if (view.tilt > 0) {
    toast('Please switch to a flat, untilted map to select (turn off 3D / Globe view).');
    return;
  }
  const canvas = mapCanvasRect();
  const zoom = view.zoom ?? zoomFromMeters(view.meters ?? 0, view.lat, canvas.height);
  if (!Number.isFinite(zoom) || zoom < 2) {
    toast('Zoom in a little — selection needs a flat map view.');
    return;
  }
  if (view.zoom === undefined) toast('Satellite view: selection is approximate.', 3000);
  const vp: Viewport = { lat: view.lat, lng: view.lng, zoom, canvas };
  startSelection({
    area: selectableArea(),
    onDone: (shape) => finish(shape, vp),
    onCancel: () => sync(),
  });
  sync();
}

function finish(shape: Shape, vp: Viewport): void {
  const all = Object.values(places);
  const hits: SavedPlace[] = [];
  const pts = [];
  for (const p of all) {
    const s = toScreen(p.lat, p.lng, vp);
    const inside =
      shape.kind === 'circle'
        ? pointInCircle(s, shape.center, shape.radius)
        : pointInPolygon(s, shape.points);
    if (inside) {
      hits.push(p);
      pts.push(s);
    }
  }
  const centerPx = shape.kind === 'circle' ? shape.center : centroid(shape.points);
  const center = fromScreen(centerPx.x, centerPx.y, vp);
  const selection: SelectionSummary =
    shape.kind === 'circle'
      ? {
          kind: 'circle',
          center,
          radiusKm: (shape.radius * metersPerPixel(vp.lat, vp.zoom)) / 1000,
        }
      : { kind: 'lasso', center };

  highlightUrl = location.href;
  showHighlights(pts, shape);
  const onClose = () => {
    clearHighlights();
    sync();
  };
  if (!hits.length) {
    openEmptyState(
      { onLoadLists: openSaved, onImport: (f) => void importFiles(f) },
      onClose,
      count(),
    );
  } else {
    openResults(
      { places: hits, selection, embedImages: ctx?.settings.export.embedImages ?? true },
      onClose,
    );
  }
  sync();
}

function openSaved(): void {
  const btn = findSavedNavButton();
  if (btn) btn.click();
  else toast('Open “Saved” from the Maps menu, then click into a list.');
}

function sync(): void {
  if (!ctx) return;
  // Highlights are in screen space: drop them once the map moves.
  if (highlightUrl && location.href !== highlightUrl) {
    clearHighlights();
    highlightUrl = '';
  }
  // No lasso in Street View: the flat-map maths doesn't apply there.
  if (parseStreetView(location.href)) {
    if (isSelecting()) stopSelection();
    removeControl();
    return;
  }
  const n = count();
  syncControl({
    active: isSelecting() || isPanelOpen(),
    title: isSelecting()
      ? 'Cancel selection (Esc)'
      : `Select saved places (${n} known). Drag a circle; hold Shift for freehand.`,
    onClick: () => void begin(),
  });
}

export const savedLassoFeature: Feature = {
  id: 'saved-lasso',
  name: 'Saved Places Lasso',
  description:
    'Adds a map control to circle or lasso an area and list every saved place inside it, with export to CSV, GeoJSON, KML and a printable HTML report.',
  defaultEnabled: true,
  async mount(c) {
    ctx = c;
    if (cleanups.length) return;
    window.addEventListener('message', onWindowMessage);
    cleanups = [
      () => window.removeEventListener('message', onWindowMessage),
      onDomChange(sync),
      onUrlChange(sync),
    ];
    // Merge rather than overwrite: the page may have posted places while storage was loading.
    const stored = await getSavedPlaces();
    for (const [k, v] of Object.entries(places)) {
      const prev = stored[k];
      stored[k] = prev ? mergePlaces(prev, v) : v;
    }
    places = stored;
    sync();
  },
  unmount() {
    for (const c of cleanups) c();
    cleanups = [];
    clearTimeout(saveTimer);
    stopSelection();
    closePanel();
    clearHighlights();
    removeControl();
    ctx = null;
  },
};
