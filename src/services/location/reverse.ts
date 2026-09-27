/**
 * Keyless reverse geocoding (coordinates → 「東京都渋谷区 神南」) for the real
 * location service, so the HUD names where you actually are without a gateway.
 *
 *   1. OpenStreetMap Nominatim (Japanese names, address breakdown)
 *   2. BigDataCloud client-side endpoint (fallback)
 *
 * Called only on the first fix and after moving ~500 m, at most once a minute
 * (Nominatim's usage policy asks for ≤ 1 request/s and caching).
 */
import type { GeoFix } from '../../core/types';

export interface ReverseResult {
  /** Short, speakable name of the immediate place (町名 / 地区). */
  placeName: string;
  /** Administrative area, e.g. 東京都渋谷区. */
  area: string;
}

type Addr = Record<string, string | undefined>;

const uniq = (parts: (string | undefined)[]) =>
  parts.filter((p, i, a): p is string => !!p && a.findIndex((q) => q && (q === p || q.includes(p))) === i);

/** Nominatim jsonv2 `address` → { placeName, area } (exported for tests). */
export function fromNominatim(a: Addr): ReverseResult | null {
  const pref = a.province ?? a.state;
  const city = a.city ?? a.town ?? a.village ?? a.county;
  const ward = a.city_district;
  const locality = a.quarter ?? a.suburb ?? a.neighbourhood ?? a.hamlet;
  const area = uniq([pref, city, ward]).join('');
  const placeName = locality ?? ward ?? city ?? pref;
  if (!placeName && !area) return null;
  return { placeName: placeName ?? area, area: area || placeName! };
}

/** BigDataCloud reverse-geocode-client response → { placeName, area }. */
export function fromBigDataCloud(j: { principalSubdivision?: string; city?: string; locality?: string }): ReverseResult | null {
  const area = uniq([j.principalSubdivision, j.city]).join('');
  const placeName = j.locality || j.city || j.principalSubdivision;
  if (!placeName) return null;
  return { placeName, area: area || placeName };
}

async function getJson(url: string, ms = 6000): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function reverseGeocode(geo: Pick<GeoFix, 'lat' | 'lon'>): Promise<ReverseResult | null> {
  const lat = geo.lat.toFixed(5);
  const lon = geo.lon.toFixed(5);
  try {
    const j = (await getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1&accept-language=ja`)) as { address?: Addr };
    const r = j.address ? fromNominatim(j.address) : null;
    if (r) return r;
  } catch {
    /* fall through */
  }
  try {
    return fromBigDataCloud((await getJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ja`)) as never);
  } catch {
    return null;
  }
}

/** Distance in metres (equirectangular — fine for "have I moved ~500 m?"). */
export function metersBetween(a: Pick<GeoFix, 'lat' | 'lon'>, b: Pick<GeoFix, 'lat' | 'lon'>): number {
  const k = Math.PI / 180;
  const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.hypot(x, y) * 6_371_000;
}
