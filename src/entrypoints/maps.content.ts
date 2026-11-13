/**
 * Isolated-world content script on google.com/maps. Mounts the enabled features and remounts
 * them when settings change, without a page reload.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { FEATURES, isEnabled } from '@/features/registry';
import { getSettings, onSettingsChanged, type Settings } from '@/shared/storage';
import { logger, setDebug } from '@/shared/log';

const log = logger('content');
const mounted = new Set<string>();

async function apply(settings: Settings): Promise<void> {
  setDebug(settings.debug);
  for (const f of FEATURES) {
    const want = isEnabled(f, settings);
    try {
      if (want) {
        // Re-mount on every settings change so features pick up new options.
        if (mounted.has(f.id)) f.unmount();
        await f.mount({ settings });
        mounted.add(f.id);
      } else if (mounted.has(f.id)) {
        f.unmount();
        mounted.delete(f.id);
      }
    } catch (e) {
      log.warn(`feature ${f.id} failed`, e);
    }
  }
}

export default defineContentScript({
  matches: ['https://www.google.com/maps/*', 'https://www.google.com/maps?*'],
  runAt: 'document_idle',
  async main(ctx) {
    await apply(await getSettings());
    const off = onSettingsChanged((s) => void apply(s));
    ctx.onInvalidated(() => {
      off();
      for (const f of FEATURES) if (mounted.has(f.id)) f.unmount();
      mounted.clear();
    });
  },
});
