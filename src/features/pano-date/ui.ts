import { browser } from 'wxt/browser';
import { BASE_CSS, h, removeHost, shadowHost } from '@/shared/dom';
import { findImageCaptureLabel } from '@/shared/maps-dom';
import { send, type PanoDateResult, type PanoProgressMessage } from '@/shared/messaging';
import { logger } from '@/shared/log';
import { isOfficialPanoId, parseStreetView, type StreetViewLocation } from './url';

const log = logger('pano-date');
const HOST_ID = 'maps-plus-pano-date';

const CSS =
  BASE_CSS +
  `
:host { display: inline-block; vertical-align: middle; margin-left: 6px; }
:host(.floating) { position: fixed; left: 12px; bottom: 28px; z-index: 2147483000; margin: 0; }
.pill {
  display: inline-flex; align-items: center; gap: 4px; max-width: 320px;
  padding: 2px 10px; border-radius: 999px; border: 1px solid var(--mp-line);
  background: var(--mp-bg); color: var(--mp-fg); font-size: 12px; line-height: 18px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 1px 2px rgba(0,0,0,.15);
}
.pill:hover { background: var(--mp-hover); }
.pill[data-state="running"] { cursor: progress; color: var(--mp-muted); }
.pill[data-state="done"] { border-color: var(--mp-accent); }
.pill[data-state="error"] { color: var(--mp-danger); }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--mp-accent); flex: none; }
`;

const LIMITS =
  'Works best on the most recent imagery at a location. Relies on an undocumented Google ' +
  'service and may stop working without notice. Technique by emily (itisem).';

type State =
  | { kind: 'idle' }
  | { kind: 'running'; step: number; total: number }
  | { kind: 'done'; result: PanoDateResult }
  | { kind: 'error'; message: string };

let state: State = { kind: 'idle' };
let current: StreetViewLocation | null = null;
let currentKey = '';
let requestId = '';
let copiedUntil = 0;

const keyOf = (l: StreetViewLocation) => l.panoId ?? `${l.lat.toFixed(6)},${l.lng.toFixed(6)}`;

export function formatLocal(ts: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone,
  }).format(new Date(ts * 1000));
}

function tooltip(r: PanoDateResult): string {
  const lines = [
    `Captured ${new Date(Math.round(r.timestamp) * 1000).toISOString().replace('.000', '')} (UTC)`,
    `Accuracy: ±${Math.max(1, Math.round(r.accuracy))} s`,
  ];
  if (r.timeZone)
    lines.push(`Local time at the photo: ${formatLocal(r.timestamp, r.timeZone)} (${r.timeZone})`);
  lines.push('Click to copy.', '', LIMITS);
  return lines.join('\n');
}

function label(): { text: string; title: string } {
  switch (state.kind) {
    case 'idle':
      return {
        text: 'Resolve date',
        title: 'Find the exact capture time (≈21 requests).\n\n' + LIMITS,
      };
    case 'running':
      return { text: `Resolving… ${state.step}/${state.total || '?'}`, title: LIMITS };
    case 'done':
      return {
        text: Date.now() < copiedUntil ? 'Copied ✓' : formatLocal(state.result.timestamp),
        title: tooltip(state.result),
      };
    case 'error':
      return { text: state.message, title: 'Click to try again.\n\n' + LIMITS };
  }
}

function render(): void {
  const root = document.getElementById(HOST_ID)?.shadowRoot;
  const btn = root?.querySelector<HTMLButtonElement>('button.pill');
  if (!btn) return;
  const { text, title } = label();
  btn.dataset.state = state.kind;
  btn.title = title;
  btn.setAttribute('aria-label', `Maps Plus: ${text}`);
  const span = btn.querySelector('span.t');
  if (span && span.textContent !== text) span.textContent = text;
}

async function onClick(): Promise<void> {
  if (state.kind === 'running') return;
  if (state.kind === 'done') {
    const r = state.result;
    const text = `${formatLocal(r.timestamp)} (${new Date(Math.round(r.timestamp) * 1000).toISOString()}, ±${Math.max(1, Math.round(r.accuracy))} s)`;
    try {
      await navigator.clipboard.writeText(text);
      copiedUntil = Date.now() + 1500;
      render();
      setTimeout(render, 1600);
    } catch {
      log.warn('clipboard write failed');
    }
    return;
  }
  const loc = current;
  if (!loc) return;
  if (loc.panoId && !isOfficialPanoId(loc.panoId)) {
    state = { kind: 'error', message: 'Photospheres aren’t supported' };
    render();
    return;
  }
  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
    state = { kind: 'error', message: 'Can’t read location from URL' };
    render();
    return;
  }
  const key = currentKey;
  requestId = crypto.randomUUID();
  state = { kind: 'running', step: 0, total: 0 };
  render();
  try {
    const result = await send({
      type: 'pano-date/resolve',
      lat: loc.lat,
      lng: loc.lng,
      panoId: loc.panoId,
      requestId,
    });
    if (key !== currentKey) return; // user moved on
    state = { kind: 'done', result };
  } catch (e) {
    if (key !== currentKey) return;
    log.debug(e);
    state = { kind: 'error', message: shortError(e) };
  }
  render();
}

function shortError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/no official/i.test(m)) return 'No official imagery here';
  if (/capture month/i.test(m)) return 'No date for this pano';
  if (/429|rate/i.test(m)) return 'Google is rate-limiting; try later';
  return 'Couldn’t resolve date';
}

function onProgress(msg: unknown): void {
  const m = msg as PanoProgressMessage;
  if (m?.type !== 'pano-date/progress' || m.requestId !== requestId || state.kind !== 'running')
    return;
  state = { kind: 'running', step: m.progress.step, total: m.progress.total };
  render();
}

/** Idempotent: put exactly one button in the right place, or remove it outside Street View. */
export function sync(): void {
  const loc = parseStreetView(location.href);
  if (!loc) {
    removeHost(HOST_ID);
    current = null;
    currentKey = '';
    return;
  }
  const key = keyOf(loc);
  if (key !== currentKey) {
    current = loc;
    currentKey = key;
    state = { kind: 'idle' };
    requestId = '';
  }

  const anchor = findImageCaptureLabel();
  let host = document.getElementById(HOST_ID);
  const wantFloating = !anchor;
  const inPlace =
    host &&
    (wantFloating ? host.parentElement === document.body : host.previousElementSibling === anchor);
  if (!host || !inPlace) {
    host?.remove();
    host = null;
  }
  if (!host) {
    const root = shadowHost(HOST_ID, CSS, anchor?.parentElement ?? document.body);
    const h0 = root.host as HTMLElement;
    if (anchor) anchor.after(h0);
    h0.classList.toggle('floating', wantFloating);
    root.append(
      h(
        'div',
        { class: 'mp' },
        h(
          'button',
          { class: 'pill', type: 'button', onclick: () => void onClick() },
          h('span', { class: 'dot' }),
          h('span', { class: 't' }),
        ),
      ),
    );
  }
  render();
}

export function startProgressListener(): () => void {
  browser.runtime.onMessage.addListener(onProgress);
  return () => browser.runtime.onMessage.removeListener(onProgress);
}

export function teardown(): void {
  removeHost(HOST_ID);
  state = { kind: 'idle' };
  current = null;
  currentKey = '';
  requestId = '';
}
