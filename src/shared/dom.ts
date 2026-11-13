/**
 * Tiny DOM builder. Text is always set via textContent, never innerHTML, so untrusted
 * place names and notes can't inject markup.
 */
type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | undefined | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Create (or reuse) a host element with an open shadow root, styles included. */
export function shadowHost(id: string, css: string, parent: Element = document.body): ShadowRoot {
  let host = document.getElementById(id);
  if (!host) {
    host = document.createElement('div');
    host.id = id;
    host.setAttribute('data-maps-plus', '');
    parent.append(host);
  }
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (!root.querySelector('style[data-mp]')) {
    const style = document.createElement('style');
    style.setAttribute('data-mp', '');
    style.textContent = css;
    root.prepend(style);
  }
  return root;
}

export function removeHost(id: string): void {
  document.getElementById(id)?.remove();
}

/** Trigger a download from a Blob without the `downloads` permission. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Shared design tokens for every Shadow DOM UI. Follows the page's colour scheme. */
export const BASE_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.mp {
  --mp-bg: #ffffff; --mp-fg: #1f1f1f; --mp-muted: #5f6368; --mp-line: #dadce0;
  --mp-accent: #0b7a5a; --mp-accent-fg: #ffffff; --mp-hover: #f1f3f4; --mp-danger: #b3261e;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--mp-fg);
}
@media (prefers-color-scheme: dark) {
  .mp { --mp-bg: #202124; --mp-fg: #e8eaed; --mp-muted: #9aa0a6; --mp-line: #3c4043;
        --mp-accent: #4fd1a5; --mp-accent-fg: #0b1f18; --mp-hover: #2d2e31; --mp-danger: #f2b8b5; }
}
button { font: inherit; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--mp-accent); outline-offset: 2px; }
`;
