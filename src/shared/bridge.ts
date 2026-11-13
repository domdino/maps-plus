/**
 * MAIN world → isolated world channel. The MAIN-world script posts ONLY this message shape;
 * the isolated script checks `event.source === window`, the channel name and the shape before
 * using anything, and re-validates every place with sanitizePlace().
 */
export const BRIDGE_CHANNEL = 'maps-plus:bridge:v1:7c1e2b';

export interface BridgeMessage {
  channel: typeof BRIDGE_CHANNEL;
  kind: 'saved-places';
  /** Endpoint path the payload came from, for debug logs only. */
  endpoint: string;
  /** Untrusted: re-validate before use. */
  places: unknown[];
}

export function isBridgeMessage(ev: MessageEvent): ev is MessageEvent<BridgeMessage> {
  const d = ev.data as Partial<BridgeMessage> | null;
  return (
    ev.source === window &&
    ev.origin === window.location.origin &&
    !!d &&
    typeof d === 'object' &&
    d.channel === BRIDGE_CHANNEL &&
    d.kind === 'saved-places' &&
    typeof d.endpoint === 'string' &&
    Array.isArray(d.places) &&
    d.places.length <= 5000
  );
}
