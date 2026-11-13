/**
 * MAIN-world script (runs in the page's own JS context at document_start).
 *
 * It does exactly two things and nothing else:
 *  1. Watches responses the Maps app ALREADY requests from saved-list endpoints, parses them,
 *     and posts the place records to the isolated content script over BRIDGE_CHANNEL.
 *     It never issues requests of its own and never reads request bodies or headers.
 *  2. Fires a DOM event after history.pushState/replaceState so the isolated script notices
 *     SPA navigations immediately.
 *
 * Keep this file tiny: it runs on every Maps page load, before Google's own code.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { BRIDGE_CHANNEL, type BridgeMessage } from '@/shared/bridge';
import { LOCATION_EVENT } from '@/shared/spa-watch';
import { parseGetlist, stripXssi } from '@/features/saved-lasso/data-source';

/** Endpoints known (or suspected) to carry saved-list data. See data-source.ts. */
const WATCHED = [/\/maps\/preview\/entitylist\/getlist/];

function watched(url: string): string | null {
  try {
    const u = new URL(url, location.href);
    if (u.origin !== location.origin) return null;
    return WATCHED.some((re) => re.test(u.pathname)) ? u.pathname : null;
  } catch {
    return null;
  }
}

function handleBody(endpoint: string, text: string): void {
  try {
    const places = parseGetlist(JSON.parse(stripXssi(text)));
    if (!places.length) return;
    const msg: BridgeMessage = { channel: BRIDGE_CHANNEL, kind: 'saved-places', endpoint, places };
    window.postMessage(msg, location.origin);
  } catch {
    // Unknown shape: ignore silently. Never break the page.
  }
}

function patchFetch(): void {
  const orig = window.fetch;
  window.fetch = function (this: typeof window, input: RequestInfo | URL, init?: RequestInit) {
    const p = orig.call(this, input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const endpoint = watched(url);
    if (endpoint) {
      p.then((res) => res.clone().text())
        .then((t) => handleBody(endpoint, t))
        .catch(() => {});
    }
    return p;
  } as typeof window.fetch;
}

function patchXhr(): void {
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    const endpoint = watched(String(url));
    if (endpoint) {
      this.addEventListener('load', () => {
        if (this.responseType === '' || this.responseType === 'text')
          handleBody(endpoint, this.responseText);
      });
    }
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
}

function patchHistory(): void {
  for (const k of ['pushState', 'replaceState'] as const) {
    const orig = history[k];
    history[k] = function (this: History, ...args: Parameters<History['pushState']>) {
      const r = orig.apply(this, args);
      window.dispatchEvent(new Event(LOCATION_EVENT));
      return r;
    };
  }
}

export default defineContentScript({
  matches: ['https://www.google.com/maps/*', 'https://www.google.com/maps?*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    patchFetch();
    patchXhr();
    patchHistory();
  },
});
