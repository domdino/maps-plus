import type { Settings } from '@/shared/storage';
import { panoDateFeature } from './pano-date';
import { savedLassoFeature } from './saved-lasso';

export interface FeatureContext {
  settings: Settings;
}

export interface Feature {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  mount(ctx: FeatureContext): void | Promise<void>;
  unmount(): void;
}

/** Every feature, in options-page order. Features must not import from each other. */
export const FEATURES: Feature[] = [panoDateFeature, savedLassoFeature];

export function isEnabled(f: Pick<Feature, 'id' | 'defaultEnabled'>, s: Settings): boolean {
  return s.features[f.id] ?? f.defaultEnabled;
}
