import { browser } from 'wxt/browser';
import type { SavedPlace } from './places';

/** User settings. Stored in chrome.storage.local; never synced, never sent anywhere. */
export interface Settings {
  features: Record<string, boolean>;
  /** Optional Google Places API (New) key, pasted by the user. Never logged. */
  placesApiKey: string;
  debug: boolean;
  export: {
    embedImages: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  features: {},
  placesApiKey: '',
  debug: false,
  export: { embedImages: true },
};

const SETTINGS_KEY = 'settings';
const PLACES_KEY = 'savedPlaces';
const CACHE_PREFIX = 'cache:';

export async function getSettings(): Promise<Settings> {
  const got = await browser.storage.local.get(SETTINGS_KEY);
  const s = (got[SETTINGS_KEY] ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    features: { ...DEFAULT_SETTINGS.features, ...(s.features ?? {}) },
    export: { ...DEFAULT_SETTINGS.export, ...(s.export ?? {}) },
  };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && SETTINGS_KEY in changes) void getSettings().then(cb);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** Saved places captured from the page or imported from Takeout, keyed by SavedPlace.key. */
export async function getSavedPlaces(): Promise<Record<string, SavedPlace>> {
  const got = await browser.storage.local.get(PLACES_KEY);
  return (got[PLACES_KEY] ?? {}) as Record<string, SavedPlace>;
}

export async function setSavedPlaces(places: Record<string, SavedPlace>): Promise<void> {
  await browser.storage.local.set({ [PLACES_KEY]: places });
}

export async function clearSavedPlaces(): Promise<void> {
  await browser.storage.local.remove(PLACES_KEY);
}

interface CacheEntry<T> {
  v: T;
  exp: number;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const k = CACHE_PREFIX + key;
  const got = await browser.storage.local.get(k);
  const e = got[k] as CacheEntry<T> | undefined;
  if (!e) return undefined;
  if (e.exp < Date.now()) {
    await browser.storage.local.remove(k);
    return undefined;
  }
  return e.v;
}

export async function cacheSet<T>(key: string, v: T, ttlMs = 30 * DAY_MS): Promise<void> {
  await browser.storage.local.set({ [CACHE_PREFIX + key]: { v, exp: Date.now() + ttlMs } });
}

export async function clearCache(): Promise<number> {
  const all = await browser.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length) await browser.storage.local.remove(keys);
  return keys.length;
}
