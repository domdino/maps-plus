/**
 * ALL Google Maps DOM selectors and text matchers live here, nowhere else.
 *
 * Google's class names are obfuscated and change often, so we look for stable signals first:
 * aria-label, role, jsaction, data-* attributes, ids, then visible text. Every lookup has a
 * graceful fallback. Each selector notes when it was last checked against live Maps.
 */
import { isImageCaptureText, isSavedText } from './i18n';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The map container: the element whose centre corresponds to the `@lat,lng` in the URL.
 * Last checked: 2026-11-13 (en-US, 1400×900) — the vector map is an OVERSIZED <canvas>
 * (e.g. 1792×1280 at -246,-255) used as a pan buffer, inside a zero-size wrapper, inside a
 * full-window container. The URL centre lines up with that container's centre (verified with
 * the Eiffel Tower at window centre, left nav rail and floating panels overlaid on top), so we
 * take the largest canvas and walk up to the first ancestor with a real, on-screen size.
 * Fallback: the window.
 */
export function findMapCanvas(): Element | null {
  let best: Element | null = null;
  let bestArea = 0;
  for (const c of document.querySelectorAll('canvas')) {
    if (c.closest('[data-maps-plus]')) continue;
    const r = c.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) {
      best = c;
      bestArea = area;
    }
  }
  if (!best || bestArea < 200 * 200) return null;
  for (let el: Element | null = best; el && el !== document.body; el = el.parentElement) {
    const r = el.getBoundingClientRect();
    const onScreen =
      r.left >= -1 &&
      r.top >= -1 &&
      r.right <= window.innerWidth + 1 &&
      r.bottom <= window.innerHeight + 1;
    if (r.width >= 200 && r.height >= 200 && onScreen) return el;
  }
  return null;
}

export function mapCanvasRect(): Rect {
  const el = findMapCanvas();
  if (el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

/**
 * The left side panel (search results / place details). We cover only the map area outside it.
 * Last checked: 2026-11 — `div[role="main"]` hosts the panel content when a panel is open
 * (absent on a bare map view).
 */
export function sidePanelRect(): Rect | null {
  const main = document.querySelector('div[role="main"]');
  if (!main || !isVisible(main)) return null;
  const r = main.getBoundingClientRect();
  if (r.width < 50 || r.left > window.innerWidth / 2) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * Google's own map control column (my-location, zoom +/-), bottom-right. We stack our button
 * on top of it.
 * Last checked: 2026-11-13 — zoom buttons carry aria-label "Zoom in" / "Zoom out" (en) and
 * `jsaction` containing "zoom.onZoomInClick"; hidden minimap duplicates also exist, so we take
 * the visible one. "Show Your Location" sits directly above zoom-in, in the same column.
 * Returns the rect spanning the column's visible buttons, or null (caller falls back).
 */
export function mapControlsRect(): Rect | null {
  const zoomIn = [
    ...document.querySelectorAll<HTMLElement>(
      'button[jsaction*="onZoomInClick"], button[aria-label="Zoom in"]',
    ),
  ].find(isVisible);
  if (!zoomIn) return null;
  const z = zoomIn.getBoundingClientRect();
  const midX = z.left + z.width / 2;
  let top = z.top;
  for (const b of document.querySelectorAll('button')) {
    if (b.closest('[data-maps-plus]')) continue;
    const r = b.getBoundingClientRect();
    if (!r.width || Math.abs(r.left + r.width / 2 - midX) > 4) continue;
    if (r.bottom <= top + 1 && top - r.bottom < 24) top = r.top; // stacked directly above
  }
  return { left: z.left, top, width: z.width, height: z.bottom - top };
}

/**
 * The Street View "Image capture: Jun 2023" label.
 * Last checked: 2026-11 — no stable attributes; matched by visible text via i18n table.
 * Returns the smallest element whose own text matches, so we can insert right after it.
 */
export function findImageCaptureLabel(root: ParentNode = document): HTMLElement | null {
  const walker = document.createTreeWalker(
    root instanceof Document ? root.body : (root as Node),
    NodeFilter.SHOW_TEXT,
  );
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? '';
    if (text.length > 80 || !isImageCaptureText(text)) continue;
    const el = n.parentElement;
    if (!el || el.closest('[data-maps-plus]') || !isVisible(el)) continue;
    return el;
  }
  return null;
}

/**
 * Is Street View currently showing? Structural check used when the URL is ambiguous.
 * Last checked: 2026-11 — the pano renders into a canvas inside `.widget-scene` with
 * aria-label "Street View" (en). Callers should prefer URL parsing (`3a`).
 */
export function isStreetViewDom(): boolean {
  return !!document.querySelector('[aria-label="Street View"], canvas.widget-scene-canvas');
}

/**
 * The "Saved" entry in the left nav rail, used by the "Open my Saved lists" action.
 * Last checked: 2026-11-13 — a rail item with an icon and the visible text "Saved" (en);
 * no aria-label. Matched by text via the i18n table, then by aria-label/jsaction.
 */
export function findSavedNavButton(): HTMLElement | null {
  const byAttr =
    document.querySelector<HTMLElement>('button[aria-label="Saved"]') ??
    document.querySelector<HTMLElement>('[jsaction*="saved"]');
  if (byAttr && isVisible(byAttr)) return byAttr;
  for (const el of document.querySelectorAll<HTMLElement>(
    'button, a, [role="button"], [jsaction]',
  )) {
    if (el.closest('[data-maps-plus]') || !isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.left > 120) continue; // nav rail only
    if (isSavedText(el.textContent ?? '')) return el;
  }
  return null;
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
