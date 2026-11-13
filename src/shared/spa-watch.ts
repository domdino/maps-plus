/**
 * Google Maps is a single-page app: the URL changes without reloads and the DOM is re-rendered
 * constantly. This module provides ONE throttled MutationObserver and ONE URL-change hook that
 * every feature subscribes to.
 */
type Listener = () => void;

/** Fired on window by maps-main-world.content.ts after history.pushState/replaceState. */
export const LOCATION_EVENT = 'maps-plus:locationchange';

const domListeners = new Set<Listener>();
const urlListeners = new Set<(url: string) => void>();
let observer: MutationObserver | null = null;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
let lastRun = 0;
let lastUrl = '';
let urlPoll: ReturnType<typeof setInterval> | null = null;
const THROTTLE_MS = 400;

function runDomListeners(): void {
  throttleTimer = null;
  lastRun = Date.now();
  for (const l of domListeners) {
    try {
      l();
    } catch (e) {
      console.debug('[maps-plus:spa-watch]', e);
    }
  }
}

function onMutations(records: MutationRecord[]): void {
  // Ignore mutations caused by our own Shadow DOM hosts to avoid feedback loops.
  if (records.every((r) => isOurs(r.target))) return;
  if (throttleTimer) return;
  const wait = Math.max(0, THROTTLE_MS - (Date.now() - lastRun));
  throttleTimer = setTimeout(runDomListeners, wait);
}

function isOurs(n: Node): boolean {
  const el = n instanceof Element ? n : n.parentElement;
  return !!el?.closest('[data-maps-plus]');
}

function checkUrl(): void {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  for (const l of urlListeners) l(lastUrl);
}

function ensureStarted(): void {
  if (observer) return;
  observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  lastUrl = location.href;
  // Content scripts run in an isolated world, so patching history.pushState here wouldn't see
  // the page's own calls. The MAIN-world script patches pushState/replaceState and fires
  // LOCATION_EVENT on window (DOM events cross worlds). popstate and a slow poll are fallbacks.
  window.addEventListener('popstate', checkUrl);
  window.addEventListener(LOCATION_EVENT, checkUrl);
  urlPoll = setInterval(checkUrl, 1000);
}

function maybeStop(): void {
  if (domListeners.size || urlListeners.size || !observer) return;
  observer.disconnect();
  observer = null;
  window.removeEventListener('popstate', checkUrl);
  window.removeEventListener(LOCATION_EVENT, checkUrl);
  if (urlPoll) clearInterval(urlPoll);
  urlPoll = null;
}

export function onDomChange(l: Listener): () => void {
  domListeners.add(l);
  ensureStarted();
  return () => {
    domListeners.delete(l);
    maybeStop();
  };
}

export function onUrlChange(l: (url: string) => void): () => void {
  urlListeners.add(l);
  ensureStarted();
  return () => {
    urlListeners.delete(l);
    maybeStop();
  };
}

/** Resolve once `read()` has returned the same value for `quietMs` (URL settles after pans). */
export function waitForStable<T>(read: () => T, quietMs = 300, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve) => {
    let last = read();
    let since = Date.now();
    const started = Date.now();
    const tick = setInterval(() => {
      const cur = read();
      if (JSON.stringify(cur) !== JSON.stringify(last)) {
        last = cur;
        since = Date.now();
      }
      if (Date.now() - since >= quietMs || Date.now() - started >= timeoutMs) {
        clearInterval(tick);
        resolve(cur);
      }
    }, 50);
  });
}
