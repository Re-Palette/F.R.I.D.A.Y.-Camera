import type { GeoFix, NavTarget, PlaceInfo } from '../../core/types';
import { bearing, haversine } from '../../core/util';
import type { PlacesService } from '../contracts';
import { postJson } from '../http';
import { MOCK_GEO, MOCK_PLACES } from '../mock/knowledgeBase';

export function toNavTarget(p: PlaceInfo, geo: GeoFix): NavTarget {
  const d = haversine(geo.lat, geo.lon, p.lat, p.lon);
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    lat: p.lat,
    lon: p.lon,
    bearingDeg: bearing(geo.lat, geo.lon, p.lat, p.lon),
    distanceM: d,
    eta: { walkMin: Math.max(1, Math.round(d / 80)), bikeMin: Math.max(1, Math.round(d / 250)), carMin: Math.max(1, Math.round(d / 400)) },
  };
}

const KIND_WORDS: [RegExp, PlaceInfo['kind']][] = [
  [/駅|station/i, 'station'],
  [/カフェ|喫茶|cafe|coffee/i, 'cafe'],
  [/店|ショップ|モール|store|shop/i, 'store'],
  [/公園|park/i, 'park'],
  [/レストラン|ご飯|食事|restaurant/i, 'restaurant'],
];

export function matchPlace(query: string, places: PlaceInfo[], geo: GeoFix): PlaceInfo | null {
  const named = places.find((p) => query.includes(p.name) || p.name.includes(query.trim()));
  if (named) return named;
  const kind = KIND_WORDS.find(([re]) => re.test(query))?.[1];
  const pool = kind ? places.filter((p) => p.kind === kind) : [];
  return pool.sort((a, b) => haversine(geo.lat, geo.lon, a.lat, a.lon) - haversine(geo.lat, geo.lon, b.lat, b.lon))[0] ?? null;
}

export class MockPlacesService implements PlacesService {
  readonly mode = 'mock' as const;
  async nearby(geo: GeoFix, kinds?: PlaceInfo['kind'][]) {
    return MOCK_PLACES.filter((p) => !kinds || kinds.includes(p.kind)).sort(
      (a, b) => haversine(geo.lat, geo.lon, a.lat, a.lon) - haversine(geo.lat, geo.lon, b.lat, b.lon),
    );
  }
  async resolveDestination(query: string, geo: GeoFix) {
    const p = matchPlace(query, MOCK_PLACES, geo);
    return p ? toNavTarget(p, geo) : null;
  }
  async reverseGeocode() {
    return { placeName: MOCK_GEO.placeName, area: MOCK_GEO.area };
  }
}

/**
 * POST /places/nearby  { geo, kinds }  → PlaceInfo[]
 * POST /places/resolve { query, geo }  → PlaceInfo | null
 * POST /places/reverse { geo }         → { placeName, area }
 */
export class RemotePlacesService implements PlacesService {
  readonly mode = 'real' as const;
  nearby(geo: GeoFix, kinds?: PlaceInfo['kind'][]) {
    return postJson<PlaceInfo[]>('/places/nearby', { geo, kinds });
  }
  async resolveDestination(query: string, geo: GeoFix) {
    const p = await postJson<PlaceInfo | null>('/places/resolve', { query, geo });
    return p ? toNavTarget(p, geo) : null;
  }
  reverseGeocode(geo: GeoFix) {
    return postJson<{ placeName: string; area: string }>('/places/reverse', { geo }).catch(() => ({
      placeName: `${geo.lat.toFixed(3)}, ${geo.lon.toFixed(3)}`,
      area: '',
    }));
  }
}
