/**
 * Service worker: the ONLY place Maps Plus makes network requests.
 * - One shared RateLimiter (max 4 in flight, ≥150 ms apart, backoff on 429/5xx).
 * - Results cached in chrome.storage.local.
 * - Only talks to Google hosts listed in the manifest, and only in response to a user action.
 */
import { defineBackground } from 'wxt/utils/define-background';
import { browser, type Browser } from 'wxt/browser';
import tzlookup from 'tz-lookup';
import {
  buildSingleImageSearchRequest,
  parseSingleImageSearchResponse,
  SINGLE_IMAGE_SEARCH_URL,
  type SearchParams,
  type SingleImageSearchResult,
} from '@/features/pano-date/protobuf';
import { resolvePanoDate } from '@/features/pano-date/resolver';
import type {
  Envelope,
  PanoDateResult,
  PanoProgressMessage,
  PlaceDetails,
  Request,
} from '@/shared/messaging';
import { isRetryableStatus, RateLimiter, RetryableError } from '@/shared/rate-limit';
import { cacheGet, cacheSet, DAY_MS, getSettings } from '@/shared/storage';
import { logger, setDebug } from '@/shared/log';

const limiter = new RateLimiter({ concurrency: 4, minSpacingMs: 150 });
const log = logger('background');

const ALLOWED_IMAGE_HOST = /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//;

async function politeFetch(url: string, init?: RequestInit): Promise<Response> {
  return limiter.schedule(async () => {
    const res = await fetch(url, { credentials: 'omit', ...init });
    if (isRetryableStatus(res.status)) throw new RetryableError(`HTTP ${res.status}`, res.status);
    return res;
  });
}

async function singleImageSearch(p: SearchParams): Promise<SingleImageSearchResult> {
  const res = await politeFetch(SINGLE_IMAGE_SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json+protobuf' },
    body: JSON.stringify(buildSingleImageSearchRequest(p)),
  });
  if (!res.ok) throw new Error(`SingleImageSearch HTTP ${res.status}`);
  return parseSingleImageSearchResponse(await res.json());
}

async function resolvePano(
  req: Extract<Request, { type: 'pano-date/resolve' }>,
  tabId: number | undefined,
): Promise<PanoDateResult> {
  const cacheKey = `pano:${req.panoId ?? `${req.lat.toFixed(6)},${req.lng.toFixed(6)}`}`;
  const cached = await cacheGet<PanoDateResult>(cacheKey);
  if (cached) return cached;
  const r = await resolvePanoDate(
    { lat: req.lat, lng: req.lng, panoId: req.panoId },
    singleImageSearch,
    {
      onProgress: (step, total) => {
        if (tabId === undefined) return;
        const msg: PanoProgressMessage = {
          type: 'pano-date/progress',
          requestId: req.requestId,
          progress: { step, total },
        };
        browser.tabs.sendMessage(tabId, msg).catch(() => {});
      },
    },
  );
  let timeZone: string | undefined;
  try {
    timeZone = tzlookup(req.lat, req.lng);
  } catch {
    timeZone = undefined;
  }
  const out: PanoDateResult = {
    timestamp: r.timestamp,
    accuracy: r.accuracy,
    year: r.year,
    month: r.month,
    timeZone,
  };
  // Only cache when we resolved a specific pano: a bare location may get newer imagery.
  if (req.panoId) await cacheSet(cacheKey, out, 30 * DAY_MS);
  return out;
}

// ── Place details ───────────────────────────────────────────────────────────────────────────

interface PlacesSearchResponse {
  places?: Array<{
    displayName?: { text?: string };
    formattedAddress?: string;
    primaryTypeDisplayName?: { text?: string };
    photos?: Array<{ name?: string }>;
  }>;
}

/** Official route: Google Places API (New) with the user's own key. */
async function placesApiDetails(
  key: string,
  name: string,
  lat: number,
  lng: number,
): Promise<PlaceDetails> {
  const res = await politeFetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'places.displayName,places.formattedAddress,places.primaryTypeDisplayName,places.photos',
    },
    body: JSON.stringify({
      textQuery: name,
      maxResultCount: 1,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 150 } },
    }),
  });
  if (!res.ok) throw new Error(`Places API HTTP ${res.status}`);
  const place = ((await res.json()) as PlacesSearchResponse).places?.[0];
  if (!place) return {};
  let photoUrl: string | undefined;
  const photoName = place.photos?.[0]?.name;
  if (photoName && /^places\/[^/]+\/photos\/[^/]+$/.test(photoName)) {
    const pr = await politeFetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=400&skipHttpRedirect=true`,
      { headers: { 'X-Goog-Api-Key': key } },
    );
    if (pr.ok) photoUrl = ((await pr.json()) as { photoUri?: string }).photoUri;
  }
  return {
    name: place.displayName?.text,
    address: place.formattedAddress,
    category: place.primaryTypeDisplayName?.text,
    photoUrl,
  };
}

async function placeDetails(
  req: Extract<Request, { type: 'places/details' }>,
): Promise<PlaceDetails> {
  const key = (await getSettings()).placesApiKey.trim();
  // No key → nothing to look up. (Street View thumbnail endpoints now require a signed-in
  // session, verified 2026-11, so there is no keyless photo fallback; the UI shows a placeholder.)
  if (!key) return {};
  const cacheKey = `place:api:${req.key}`;
  const cached = await cacheGet<PlaceDetails>(cacheKey);
  if (cached) return cached;
  let d: PlaceDetails;
  try {
    d = await placesApiDetails(key, req.name, req.lat, req.lng);
  } catch (e) {
    log.warn('Places API lookup failed', e instanceof Error ? e.message : e);
    return {}; // don't cache failures
  }
  await cacheSet(cacheKey, d, 30 * DAY_MS);
  return d;
}

// ── Images for exports ──────────────────────────────────────────────────────────────────────

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function imageDataUrl(
  req: Extract<Request, { type: 'image/data-url' }>,
): Promise<string | null> {
  if (!ALLOWED_IMAGE_HOST.test(req.url)) return null;
  const res = await politeFetch(req.url);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.type.startsWith('image/') || blob.size > 15 * 1024 * 1024) return null;
  const bmp = await createImageBitmap(blob);
  const maxW = Math.max(16, Math.min(1600, req.maxWidth));
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const hgt = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, hgt);
  const c2d = canvas.getContext('2d');
  if (!c2d) return null;
  c2d.drawImage(bmp, 0, 0, w, hgt);
  bmp.close();
  const out = await canvas.convertToBlob({
    type: 'image/jpeg',
    quality: Math.min(1, Math.max(0.3, req.quality)),
  });
  return `data:image/jpeg;base64,${toBase64(await out.arrayBuffer())}`;
}

// ── Router ──────────────────────────────────────────────────────────────────────────────────

function isRequest(m: unknown): m is Request {
  const r = m as Request | null;
  if (!r || typeof r !== 'object' || typeof r.type !== 'string') return false;
  switch (r.type) {
    case 'pano-date/resolve':
      return Number.isFinite(r.lat) && Number.isFinite(r.lng) && typeof r.requestId === 'string';
    case 'places/details':
      return (
        typeof r.key === 'string' &&
        typeof r.name === 'string' &&
        Number.isFinite(r.lat) &&
        Number.isFinite(r.lng)
      );
    case 'image/data-url':
      return (
        typeof r.url === 'string' && typeof r.maxWidth === 'number' && typeof r.quality === 'number'
      );
    default:
      return false;
  }
}

async function handle(req: Request, sender: Browser.runtime.MessageSender): Promise<unknown> {
  switch (req.type) {
    case 'pano-date/resolve':
      return resolvePano(req, sender.tab?.id);
    case 'places/details':
      return placeDetails(req);
    case 'image/data-url':
      return imageDataUrl(req);
  }
}

export default defineBackground(() => {
  void getSettings().then((s) => setDebug(s.debug));
  browser.storage.onChanged.addListener(() => void getSettings().then((s) => setDebug(s.debug)));

  browser.runtime.onMessage.addListener(
    (
      msg: unknown,
      sender: Browser.runtime.MessageSender,
      sendResponse: (r: Envelope<unknown>) => void,
    ) => {
      // Only accept messages from our own extension pages / content scripts.
      if (sender.id !== browser.runtime.id || !isRequest(msg)) return false;
      handle(msg, sender)
        .then((value) => sendResponse({ ok: true, value }))
        .catch((e: unknown) => {
          log.debug(msg.type, e);
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
        });
      return true; // async response
    },
  );
});
