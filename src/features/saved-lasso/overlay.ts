/**
 * Map control button + the transparent selection canvas. Draws a circle (default) or a freehand
 * lasso (hold Shift, or use the mode toggle). Esc cancels.
 */
import { BASE_CSS, h, removeHost, shadowHost } from '@/shared/dom';
import { mapControlsRect, type Rect } from '@/shared/maps-dom';
import { simplify } from './geometry';
import type { Point } from './projection';

export type Shape =
  { kind: 'circle'; center: Point; radius: number } | { kind: 'lasso'; points: Point[] };

const CONTROL_ID = 'maps-plus-lasso-control';
const OVERLAY_ID = 'maps-plus-lasso-overlay';
const HIGHLIGHT_ID = 'maps-plus-lasso-highlight';

const CONTROL_CSS =
  BASE_CSS +
  `
:host { position: fixed; z-index: 2147482000; }
.ctl { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.btn {
  width: 40px; height: 40px; border-radius: 8px; border: none; display: grid; place-items: center;
  background: var(--mp-bg); color: var(--mp-fg); box-shadow: 0 1px 4px rgba(0,0,0,.3);
}
.btn:hover { background: var(--mp-hover); }
.btn[aria-pressed="true"] { background: var(--mp-accent); color: var(--mp-accent-fg); }
.toast {
  max-width: 280px; padding: 8px 12px; border-radius: 8px; background: var(--mp-fg); color: var(--mp-bg);
  box-shadow: 0 2px 8px rgba(0,0,0,.3); font-size: 12px;
}
.toast[hidden] { display: none; }
svg { width: 22px; height: 22px; }
`;

const OVERLAY_CSS =
  BASE_CSS +
  `
:host { position: fixed; z-index: 2147481000; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; touch-action: none; }
.bar {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; align-items: center;
  padding: 4px; border-radius: 999px; background: var(--mp-bg); box-shadow: 0 2px 8px rgba(0,0,0,.3);
}
.bar span { padding: 0 10px; color: var(--mp-muted); font-size: 12px; }
.bar button { border: none; border-radius: 999px; padding: 6px 12px; background: transparent; color: var(--mp-fg); }
.bar button[aria-pressed="true"] { background: var(--mp-accent); color: var(--mp-accent-fg); }
.bar button:hover:not([aria-pressed="true"]) { background: var(--mp-hover); }
`;

function svgIcon(): SVGSVGElement {
  // Dashed lasso loop with a pin: drawn here (no Google iconography).
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const ring = document.createElementNS(ns, 'ellipse');
  for (const [k, v] of Object.entries({
    cx: '12',
    cy: '11',
    rx: '9',
    ry: '7',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-dasharray': '3 2.5',
  }))
    ring.setAttribute(k, v);
  const pin = document.createElementNS(ns, 'path');
  pin.setAttribute(
    'd',
    'M12 7.5a2.6 2.6 0 0 0-2.6 2.6c0 2 2.6 4.4 2.6 4.4s2.6-2.4 2.6-4.4A2.6 2.6 0 0 0 12 7.5Z',
  );
  pin.setAttribute('fill', 'currentColor');
  const tail = document.createElementNS(ns, 'path');
  tail.setAttribute('d', 'M6 16.5 4 21');
  tail.setAttribute('stroke', 'currentColor');
  tail.setAttribute('stroke-width', '2');
  tail.setAttribute('stroke-linecap', 'round');
  svg.append(ring, pin, tail);
  return svg;
}

// ── Control button ──────────────────────────────────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function syncControl(opts: { active: boolean; title: string; onClick: () => void }): void {
  const root = shadowHost(CONTROL_ID, CONTROL_CSS);
  const host = root.host as HTMLElement;
  if (!root.querySelector('.ctl')) {
    const btn = h('button', { class: 'btn', type: 'button' });
    btn.append(svgIcon());
    root.append(
      h(
        'div',
        { class: 'mp ctl' },
        h('div', { class: 'toast', role: 'status', hidden: true }),
        btn,
      ),
    );
  }
  const btn = root.querySelector<HTMLButtonElement>('.btn')!;
  btn.title = opts.title;
  btn.setAttribute('aria-label', opts.title);
  btn.setAttribute('aria-pressed', String(opts.active));
  // Replace the click handler each sync so it always closes over current state.
  btn.onclick = (e) => {
    e.stopPropagation();
    opts.onClick();
  };

  // Stack on top of Google's control column (my-location + zoom); fall back to bottom-right.
  const col = mapControlsRect();
  const size = col ? Math.max(29, Math.min(40, col.width)) : 40;
  btn.style.width = btn.style.height = `${size}px`;
  const right = col ? Math.max(8, window.innerWidth - (col.left + col.width)) : 24;
  const bottom = col ? Math.max(8, window.innerHeight - col.top + 8) : 120;
  host.style.right = `${Math.round(right)}px`;
  host.style.bottom = `${Math.round(bottom)}px`;
}

export function toast(message: string, ms = 4000): void {
  const el = document.getElementById(CONTROL_ID)?.shadowRoot?.querySelector<HTMLElement>('.toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function removeControl(): void {
  clearTimeout(toastTimer);
  removeHost(CONTROL_ID);
}

// ── Selection overlay ───────────────────────────────────────────────────────────────────────

export interface SelectOptions {
  area: Rect;
  onDone: (shape: Shape) => void;
  onCancel: () => void;
}

let cleanupOverlay: (() => void) | null = null;

export function startSelection({ area, onDone, onCancel }: SelectOptions): void {
  stopSelection();
  const root = shadowHost(OVERLAY_ID, OVERLAY_CSS);
  const host = root.host as HTMLElement;
  Object.assign(host.style, {
    left: `${area.left}px`,
    top: `${area.top}px`,
    width: `${area.width}px`,
    height: `${area.height}px`,
  });

  let mode: 'circle' | 'lasso' = 'circle';
  const canvas = h('canvas');
  const circleBtn = h('button', { type: 'button', 'aria-pressed': 'true' }, 'Circle');
  const lassoBtn = h('button', { type: 'button', 'aria-pressed': 'false' }, 'Freehand');
  const setMode = (m: 'circle' | 'lasso') => {
    mode = m;
    circleBtn.setAttribute('aria-pressed', String(m === 'circle'));
    lassoBtn.setAttribute('aria-pressed', String(m === 'lasso'));
  };
  circleBtn.addEventListener('click', () => setMode('circle'));
  lassoBtn.addEventListener('click', () => setMode('lasso'));
  const cancelBtn = h('button', { type: 'button' }, 'Cancel');
  const bar = h(
    'div',
    { class: 'bar' },
    h('span', {}, 'Drag to select · Shift = freehand · Esc'),
    circleBtn,
    lassoBtn,
    cancelBtn,
  );
  root.append(h('div', { class: 'mp' }, canvas, bar));

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(area.width * dpr);
  canvas.height = Math.round(area.height * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const accent =
    getComputedStyle(root.querySelector('.mp')!).getPropertyValue('--mp-accent').trim() ||
    '#0b7a5a';

  let drawing = false;
  let shiftAtStart = false;
  let start: Point = { x: 0, y: 0 };
  let path: Point[] = [];
  let current: Point = { x: 0, y: 0 };

  const local = (e: PointerEvent): Point => ({ x: e.clientX - area.left, y: e.clientY - area.top });
  const effectiveMode = () => (shiftAtStart ? 'lasso' : mode);

  const paint = () => {
    ctx.clearRect(0, 0, area.width, area.height);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, 0, area.width, area.height);
    if (!drawing) return;
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.fillStyle = accent + '33';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    if (effectiveMode() === 'circle') {
      const r = Math.hypot(current.x - start.x, current.y - start.y);
      ctx.arc(start.x, start.y, r, 0, Math.PI * 2);
    } else {
      path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    shiftAtStart = e.shiftKey;
    start = current = local(e);
    path = [start];
    paint();
  };
  const onMove = (e: PointerEvent) => {
    if (!drawing) return;
    current = local(e);
    if (effectiveMode() === 'lasso') path.push(current);
    paint();
  };
  const onUp = () => {
    if (!drawing) return;
    drawing = false;
    const toClient = (p: Point): Point => ({ x: p.x + area.left, y: p.y + area.top });
    let shape: Shape | null = null;
    if (effectiveMode() === 'circle') {
      const radius = Math.hypot(current.x - start.x, current.y - start.y);
      if (radius >= 4) shape = { kind: 'circle', center: toClient(start), radius };
    } else {
      const pts = simplify(path, 2).map(toClient);
      if (pts.length >= 3) shape = { kind: 'lasso', points: pts };
    }
    stopSelection();
    if (shape) onDone(shape);
    else onCancel();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      stopSelection();
      onCancel();
    }
  };

  cancelBtn.addEventListener('click', () => {
    stopSelection();
    onCancel();
  });
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKey, true);
  paint();

  cleanupOverlay = () => {
    window.removeEventListener('keydown', onKey, true);
    removeHost(OVERLAY_ID);
  };
}

export function stopSelection(): void {
  cleanupOverlay?.();
  cleanupOverlay = null;
}

export function isSelecting(): boolean {
  return cleanupOverlay !== null;
}

// ── Highlights (non-interactive) ────────────────────────────────────────────────────────────

/** Draw rings around selected places. Pointer events pass through to the map. */
export function showHighlights(points: Point[], shape: Shape | null): void {
  const root = shadowHost(
    HIGHLIGHT_ID,
    BASE_CSS +
      ':host{position:fixed;inset:0;z-index:2147480000;pointer-events:none}canvas{width:100%;height:100%}',
  );
  let canvas = root.querySelector('canvas');
  if (!canvas) {
    canvas = h('canvas');
    root.append(h('div', { class: 'mp' }, canvas));
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const accent =
    getComputedStyle(root.querySelector('.mp')!).getPropertyValue('--mp-accent').trim() ||
    '#0b7a5a';
  if (shape) {
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.beginPath();
    if (shape.kind === 'circle')
      ctx.arc(shape.center.x, shape.center.y, shape.radius, 0, Math.PI * 2);
    else shape.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.stroke();
  }
}

export function clearHighlights(): void {
  removeHost(HIGHLIGHT_ID);
}
