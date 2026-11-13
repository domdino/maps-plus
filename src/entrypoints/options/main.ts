import { browser } from 'wxt/browser';
import { FEATURES, isEnabled } from '@/features/registry';
import { h } from '@/shared/dom';
import {
  clearCache,
  clearSavedPlaces,
  getSavedPlaces,
  getSettings,
  setSettings,
} from '@/shared/storage';

async function render(): Promise<void> {
  const app = document.getElementById('app')!;
  const s = await getSettings();
  const savedCount = Object.keys(await getSavedPlaces()).length;
  const status = h('p', { class: 'status', role: 'status' });
  const flash = (msg: string) => {
    status.textContent = msg;
    setTimeout(() => (status.textContent = ''), 2500);
  };

  // Features
  const features = h('section', {}, h('h2', {}, 'Features'));
  for (const f of FEATURES) {
    const id = `f-${f.id}`;
    const cb = h('input', { type: 'checkbox', id });
    cb.checked = isEnabled(f, s);
    cb.addEventListener('change', async () => {
      const cur = await getSettings();
      await setSettings({ features: { ...cur.features, [f.id]: cb.checked } });
      flash(`${f.name} ${cb.checked ? 'on' : 'off'}.`);
    });
    features.append(
      h(
        'div',
        { class: 'row' },
        cb,
        h('label', { for: id }, h('strong', {}, f.name), h('span', {}, f.description)),
      ),
    );
  }

  // Places API key
  const key = h('input', {
    type: 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'AIza…',
    'aria-label': 'Google Places API key',
  });
  key.value = s.placesApiKey;
  const saveKey = h('button', { class: 'primary', type: 'button' }, 'Save key');
  saveKey.addEventListener('click', async () => {
    await setSettings({ placesApiKey: key.value.trim() });
    flash(key.value.trim() ? 'Key saved locally.' : 'Key removed.');
  });
  const api = h(
    'section',
    {},
    h('h2', {}, 'Place details (optional)'),
    h(
      'p',
      { class: 'note' },
      'Paste your own Google Places API (New) key to get official photos, categories and addresses for selected places. This is the ToS-friendly route. Without a key, Maps Plus uses only what Google Maps has already loaded (often name, address and note, sometimes a photo). The key is stored only in this browser, sent only to places.googleapis.com, and never logged. ',
      h(
        'a',
        {
          href: 'https://developers.google.com/maps/documentation/places/web-service/get-api-key',
          target: '_blank',
          rel: 'noopener',
        },
        'How to get a key',
      ),
      '.',
    ),
    key,
    h('div', { class: 'actions' }, saveKey),
  );

  // Exports
  const embed = h('input', { type: 'checkbox', id: 'embed' });
  embed.checked = s.export.embedImages;
  embed.addEventListener('change', async () => {
    await setSettings({ export: { ...(await getSettings()).export, embedImages: embed.checked } });
    flash('Saved.');
  });
  const exports = h(
    'section',
    {},
    h('h2', {}, 'Exports'),
    h(
      'div',
      { class: 'row' },
      embed,
      h(
        'label',
        { for: 'embed' },
        h('strong', {}, 'Embed photos in HTML reports'),
        h(
          'span',
          {},
          'Downloads each photo (max 400 px wide) so the report works offline and prints cleanly.',
        ),
      ),
    ),
  );

  // Data
  const clearPlaces = h(
    'button',
    { class: 'danger', type: 'button' },
    `Forget ${savedCount} saved place${savedCount === 1 ? '' : 's'}`,
  );
  clearPlaces.addEventListener('click', async () => {
    if (
      !confirm(
        'Remove all saved places Maps Plus has picked up or imported? Your Google lists are not affected.',
      )
    )
      return;
    await clearSavedPlaces();
    flash('Saved places cleared.');
    void render();
  });
  const clearCacheBtn = h('button', { type: 'button' }, 'Clear lookup cache');
  clearCacheBtn.addEventListener('click', async () =>
    flash(`Cleared ${await clearCache()} cached entries.`),
  );
  const debug = h('input', { type: 'checkbox', id: 'debug' });
  debug.checked = s.debug;
  debug.addEventListener('change', async () => {
    await setSettings({ debug: debug.checked });
    flash(`Debug logging ${debug.checked ? 'on' : 'off'}.`);
  });
  const data = h(
    'section',
    {},
    h('h2', {}, 'Your data'),
    h(
      'p',
      { class: 'note' },
      'Everything Maps Plus knows lives in this browser (chrome.storage.local). No analytics, no telemetry, no servers of ours.',
    ),
    h('div', { class: 'actions' }, clearPlaces, clearCacheBtn),
    h(
      'div',
      { class: 'row', style: 'margin-top:12px;border-top:1px solid var(--line);padding-top:12px' },
      debug,
      h(
        'label',
        { for: 'debug' },
        h('strong', {}, 'Debug logging'),
        h('span', {}, 'Logs details to the console with a [maps-plus:…] prefix.'),
      ),
    ),
  );

  const version = browser.runtime.getManifest().version;
  app.replaceChildren(
    h('h1', {}, h('img', { src: '/icon/128.png', alt: '' }), 'Maps Plus'),
    h(
      'p',
      { class: 'lede' },
      `Version ${version} · Not affiliated with Google. Relies on undocumented Google Maps internals that may change.`,
    ),
    features,
    api,
    exports,
    data,
    status,
  );
}

void render();
