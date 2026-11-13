import { describe, expect, it } from 'vitest';
import {
  cidFromFeatureId,
  isOfficialPanoId,
  latLngFromPlaceUrl,
  panoIdFromData,
  parseMapView,
  parseStreetView,
  placeUrl,
} from '@/shared/maps-url';

const SV =
  'https://www.google.com/maps/@40.7580033,-73.9855681,3a,75y,210.41h,90.32t/data=!3m7!1e1!3m5!1sywskIOsAFskiKHt5fwIUWA!2e0!6shttps:%2F%2Fstreetviewpixels-pa.googleapis.com!7i16384!8i8192';

describe('parseMapView', () => {
  it('reads lat, lng and fractional zoom', () => {
    expect(parseMapView('https://www.google.com/maps/@51.5072,-0.1276,12.5z')).toEqual({
      lat: 51.5072,
      lng: -0.1276,
      zoom: 12.5,
      meters: undefined,
      tilt: 0,
    });
  });
  it('reads tilt', () => {
    expect(parseMapView('https://www.google.com/maps/@51.5,-0.12,17z,45t/data=x')?.tilt).toBe(45);
  });
  it('reads metres form (satellite)', () => {
    const v = parseMapView('https://www.google.com/maps/@48.85,2.29,1234m/data=!3m1!1e3');
    expect(v?.meters).toBe(1234);
    expect(v?.zoom).toBeUndefined();
  });
  it('works on /place/ URLs', () => {
    expect(
      parseMapView('https://www.google.com/maps/place/Foo/@10.5,20.25,15z/data=!4m2')?.zoom,
    ).toBe(15);
  });
  it('rejects Street View and garbage', () => {
    expect(parseMapView(SV)).toBeNull();
    expect(parseMapView('https://www.google.com/maps')).toBeNull();
    expect(parseMapView('https://www.google.com/maps/@91,0,3z')).toBeNull();
  });
});

describe('parseStreetView', () => {
  it('parses the @…3a form with pano id', () => {
    expect(parseStreetView(SV)).toEqual({
      lat: 40.7580033,
      lng: -73.9855681,
      panoId: 'ywskIOsAFskiKHt5fwIUWA',
      fov: 75,
      heading: 210.41,
      pitch: 0.3199999999999932,
    });
  });
  it('parses api=1 map_action=pano', () => {
    const r = parseStreetView(
      'https://www.google.com/maps/@?api=1&map_action=pano&pano=ywskIOsAFskiKHt5fwIUWA&viewpoint=40.758,-73.9855&heading=10',
    );
    expect(r).toMatchObject({
      lat: 40.758,
      lng: -73.9855,
      panoId: 'ywskIOsAFskiKHt5fwIUWA',
      heading: 10,
    });
  });
  it('parses layer=c&cbll=', () => {
    expect(parseStreetView('https://www.google.com/maps?layer=c&cbll=35.6595,139.7005')).toEqual({
      lat: 35.6595,
      lng: 139.7005,
      panoId: undefined,
    });
  });
  it('returns null for a normal map', () => {
    expect(parseStreetView('https://www.google.com/maps/@1,2,3z')).toBeNull();
  });
});

describe('pano ids', () => {
  it('extracts from data blobs', () => {
    expect(panoIdFromData('/data=!3m6!1e1!3m4!1sAF1QipN-abc!2e10!7i1!8i1')).toBe('AF1QipN-abc');
  });
  it('detects official ids', () => {
    expect(isOfficialPanoId('ywskIOsAFskiKHt5fwIUWA')).toBe(true);
    expect(isOfficialPanoId('AF1QipMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe(false);
    expect(isOfficialPanoId(undefined)).toBe(false);
  });
});

describe('place urls', () => {
  it('pulls coordinates out of place URLs', () => {
    expect(
      latLngFromPlaceUrl(
        'https://www.google.com/maps/place/X/data=!4m6!3m5!1s0x1:0x2!8m2!3d48.8584!4d2.2945',
      ),
    ).toEqual({ lat: 48.8584, lng: 2.2945 });
    expect(latLngFromPlaceUrl('https://www.google.com/maps/search/?api=1&query=1.5,-2.25')).toEqual(
      { lat: 1.5, lng: -2.25 },
    );
    expect(
      latLngFromPlaceUrl('https://www.google.com/maps/place/X/data=!4m2!3m1!1s0x1:0x2'),
    ).toBeNull();
  });
  it('converts feature ids to CIDs', () => {
    expect(cidFromFeatureId('0x47e66e2964e34e2d:0x8ddca9ee380ef7e0')).toBe('10222232094831998944');
    expect(cidFromFeatureId('nope')).toBeUndefined();
  });
  it('builds stable links', () => {
    expect(placeUrl({ lat: 1, lng: 2, cid: '123' })).toBe('https://maps.google.com/?cid=123');
    expect(placeUrl({ lat: 1, lng: 2 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=1.0000000%2C2.0000000',
    );
    expect(placeUrl({ lat: 1, lng: 2, url: 'javascript:alert(1)' })).not.toContain('javascript');
  });
});
