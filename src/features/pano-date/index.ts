import type { Feature } from '../registry';
import { onDomChange, onUrlChange } from '@/shared/spa-watch';
import { startProgressListener, sync, teardown } from './ui';

let cleanups: Array<() => void> = [];

export const panoDateFeature: Feature = {
  id: 'pano-date',
  name: 'Pano Date Resolver',
  description:
    'Adds a “Resolve date” button next to Street View’s “Image capture” label that finds the capture time to within about 2 seconds.',
  defaultEnabled: true,
  mount() {
    if (cleanups.length) return;
    cleanups = [startProgressListener(), onUrlChange(sync), onDomChange(sync)];
    sync();
  },
  unmount() {
    for (const c of cleanups) c();
    cleanups = [];
    teardown();
  },
};
