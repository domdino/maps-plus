/**
 * Hand-built request/response arrays for Google's internal
 * `google.internal.maps.mapsjs.v1.MapsJsInternalService/SingleImageSearch` RPC.
 *
 * The RPC speaks "protobuf as JSON" (Content-Type: application/json+protobuf): each message is
 * a positional array where protobuf field N lives at index N-1, unset fields are null, enums
 * are numbers, and repeated fields are arrays.
 *
 * Field numbers were worked out from the Maps JavaScript API's own network traffic, cross-
 * checked against the public schema notes in emily / itisem's pano-date-resolver
 * (https://github.com/itisem/pano-date-resolver). That project has no license, so this is an
 * independent implementation; full credit to the original author for the technique.
 *
 * THIS IS AN UNDOCUMENTED INTERFACE. If Google changes it, these indices are the place to fix.
 */

/** ImageFrontendType enum. */
export const FRONTEND_OFFICIAL = 2;
/** RenderStrategy.ImageFormat enum. */
export const IMAGE_FORMAT_OFFICIAL = 2;
/** RankingStrategy enum. */
export const RANKING_CLOSEST = 2;
/** ResponseComponent enum. */
export const COMPONENT_INCLUDE_DESCRIPTION = 2;
export const COMPONENT_INCLUDE_LINKED_PANORAMAS = 6;
/** ResponseStatus.StatusCode enum. */
export const STATUS_OK = 0;
export const STATUS_NO_RESULTS = 5;

export const SINGLE_IMAGE_SEARCH_URL =
  'https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/SingleImageSearch';

export interface SearchParams {
  lat: number;
  lng: number;
  /** Search radius in metres. */
  radius?: number;
  /** If set, ask for exactly this official pano (ImageKey). */
  panoId?: string;
  /** If set, only return imagery captured within [start, end] (Unix seconds). */
  photoAge?: { startSeconds: number; endSeconds: number };
}

type Json = null | boolean | number | string | Json[];

/** Pad an array with nulls so `arr[index]` exists. */
function at(arr: Json[], index: number, value: Json): Json[] {
  while (arr.length < index) arr.push(null);
  arr[index] = value;
  return arr;
}

/** Build a SingleImageSearchRequest as a positional JSON array. */
export function buildSingleImageSearchRequest(p: SearchParams): Json[] {
  const req: Json[] = [];

  // 1: context (RequestContext) → [productId]
  at(req, 0, ['apiv3']);

  // 2: location (PhotoByLatLngQuery) → [center: LatLng, radius]
  //    LatLng: 3=lat, 4=lng → [null, null, lat, lng]
  at(req, 1, [[null, null, p.lat, p.lng], p.radius ?? 30]);

  // 3: queryOptions (PhotoQueryOptions)
  const queryOptions: Json[] = [];
  if (p.photoAge) {
    // 3.1: filterOptions (PhotoFilterOptions) → 11: photoAge (TimestampRange: 1=start, 2=end)
    at(queryOptions, 0, at([], 10, [p.photoAge.startSeconds, p.photoAge.endSeconds]));
  }
  // 3.9: rankingOptions (RankingOptions) → 1: rankingStrategy = CLOSEST
  at(queryOptions, 8, [RANKING_CLOSEST]);
  // 3.11: clientCapabilities (ClientCapabilities) → 1: repeated renderStrategy
  //       RenderStrategy: 1=frontend OFFICIAL, 2=tiled true, 3=imageFormat OFFICIAL_FORMAT
  at(queryOptions, 10, [[[FRONTEND_OFFICIAL, true, IMAGE_FORMAT_OFFICIAL]]]);
  at(req, 2, queryOptions);

  // 4: responseSpecification (MetadataResponseSpecification) → 1: repeated component
  at(req, 3, [[COMPONENT_INCLUDE_DESCRIPTION, COMPONENT_INCLUDE_LINKED_PANORAMAS]]);

  // 5: imageKey (ImageKey) → [frontend, id]
  if (p.panoId) at(req, 4, [FRONTEND_OFFICIAL, p.panoId]);

  return req;
}

export interface SingleImageSearchResult {
  ok: boolean;
  statusCode: number | null;
  panoId?: string;
  year?: number;
  month?: number;
  lat?: number;
  lng?: number;
}

function get(v: unknown, ...path: number[]): unknown {
  let cur = v;
  for (const i of path) {
    if (!Array.isArray(cur)) return undefined;
    cur = cur[i];
  }
  return cur;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Parse a SingleImageSearchResponse array. Never throws on malformed input. */
export function parseSingleImageSearchResponse(res: unknown): SingleImageSearchResult {
  // 1: status (ResponseStatus) → 1: code. OK = 0, NO_RESULTS = 5.
  //    Verified 2026-11: success → [[0], [...metadata]]; empty → [[5, "generic", "..."]].
  const status = get(res, 0);
  const statusCode = Array.isArray(status) ? (num(get(status, 0)) ?? STATUS_OK) : null;
  // 2: metadata (ImageMetadata)
  const metadata = get(res, 1);
  const ok = statusCode === STATUS_OK && Array.isArray(metadata);
  const out: SingleImageSearchResult = { ok, statusCode };
  if (!Array.isArray(metadata)) return out;

  // 2.2: pano (ImageKey) → 2: id
  const id = get(metadata, 1, 1);
  if (typeof id === 'string') out.panoId = id;
  // 2.7: date (ImageDate) → 8: date (Date: 1=year, 2=month)
  out.year = num(get(metadata, 6, 7, 0));
  out.month = num(get(metadata, 6, 7, 1));
  // 2.6: repeated information (ImageInformation) → [0] → 2: location (PanoLocation)
  //      → 1: location (LatLng: 3=lat, 4=lng)
  out.lat = num(get(metadata, 5, 0, 1, 0, 2));
  out.lng = num(get(metadata, 5, 0, 1, 0, 3));
  return out;
}
