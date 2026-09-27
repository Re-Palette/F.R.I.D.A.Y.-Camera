import { describe, expect, it } from 'vitest';
import { fromBigDataCloud, fromNominatim, metersBetween } from '../services/location/reverse';

describe('reverse geocoding (keyless)', () => {
  it('turns a Nominatim address into 都道府県+市区町村 and a local place name', () => {
    expect(fromNominatim({ neighbourhood: '芝公園四丁目', quarter: '芝公園', city: '港区', province: '東京都', country: '日本' })).toEqual({ placeName: '芝公園', area: '東京都港区' });
    expect(fromNominatim({ quarter: '梅田', city_district: '北区', city: '大阪市', province: '大阪府' })).toEqual({ placeName: '梅田', area: '大阪府大阪市北区' });
    expect(fromNominatim({ town: '箱根町', county: '足柄下郡', state: '神奈川県' })).toEqual({ placeName: '箱根町', area: '神奈川県箱根町' });
    expect(fromNominatim({})).toBeNull();
  });

  it('falls back to BigDataCloud fields', () => {
    expect(fromBigDataCloud({ principalSubdivision: '東京都', city: '渋谷区', locality: '神南' })).toEqual({ placeName: '神南', area: '東京都渋谷区' });
  });

  it('measures movement for re-lookup', () => {
    expect(metersBetween({ lat: 35.0, lon: 135.0 }, { lat: 35.0045, lon: 135.0 })).toBeGreaterThan(490);
    expect(metersBetween({ lat: 35.0, lon: 135.0 }, { lat: 35.0, lon: 135.0 })).toBe(0);
  });
});
