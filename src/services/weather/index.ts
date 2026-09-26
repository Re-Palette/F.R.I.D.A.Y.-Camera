import type { GeoFix, WeatherCode, WeatherReport } from '../../core/types';
import type { WeatherService } from '../contracts';

const CONDITION_JA: Record<WeatherCode, string> = {
  clear: '晴れ',
  partly: '晴れ時々曇り',
  cloudy: '曇り',
  rain: '雨',
  snow: '雪',
  storm: '雷雨',
  fog: '霧',
};

/** WMO weather interpretation codes → HUD codes. */
export function wmo(code: number): WeatherCode {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

const hhmm = (iso: string) => iso.slice(11, 16);

export class MockWeatherService implements WeatherService {
  readonly mode = 'mock' as const;
  async report(_geo: GeoFix, label = '東京'): Promise<WeatherReport> {
    const now = new Date();
    const hourly = [17, 16, 15, 14, 14, 13].map((tempC, i) => {
      const d = new Date(now);
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() + i + 1);
      return { time: d.toISOString(), tempC, code: (i === 1 ? 'partly' : 'clear') as WeatherCode };
    });
    const tomorrow = new Date(now.getTime() + 864e5);
    return {
      locationLabel: label,
      now: { tempC: 18, condition: '晴れ', code: 'clear', humidity: 58, windMs: 3, uvIndex: 1, precipProb: 10, sunset: '17:32', airQuality: '良好' },
      hourly,
      tomorrow: { date: tomorrow.toISOString().slice(0, 10), maxC: 22, minC: 15, code: 'clear', condition: '晴れ', precipProb: 10 },
      fetchedAt: now.toISOString(),
    };
  }
}

/** Open-Meteo — free, key-less, CORS-enabled. Used directly from the browser. */
export class OpenMeteoWeatherService implements WeatherService {
  readonly mode = 'real' as const;
  async report(geo: GeoFix, label = '現在地'): Promise<WeatherReport> {
    const u = new URL('https://api.open-meteo.com/v1/forecast');
    u.searchParams.set('latitude', geo.lat.toFixed(4));
    u.searchParams.set('longitude', geo.lon.toFixed(4));
    u.searchParams.set('current', 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,uv_index,precipitation_probability');
    u.searchParams.set('hourly', 'temperature_2m,weather_code');
    u.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunset');
    u.searchParams.set('wind_speed_unit', 'ms');
    u.searchParams.set('timezone', 'auto');
    u.searchParams.set('forecast_days', '2');
    const aq = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    aq.searchParams.set('latitude', geo.lat.toFixed(4));
    aq.searchParams.set('longitude', geo.lon.toFixed(4));
    aq.searchParams.set('current', 'european_aqi');

    const [res, aqRes] = await Promise.all([fetch(u), fetch(aq).catch(() => null)]);
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const j = await res.json();
    let airQuality = '—';
    if (aqRes?.ok) {
      const a = (await aqRes.json())?.current?.european_aqi as number | undefined;
      if (a != null) airQuality = a <= 20 ? '良好' : a <= 40 ? '普通' : a <= 60 ? 'やや悪い' : '悪い';
    }
    const cur = j.current;
    const code = wmo(cur.weather_code);
    const nowIdx = (j.hourly.time as string[]).findIndex((t) => t >= cur.time);
    const hourly = (j.hourly.time as string[])
      .slice(nowIdx + 1, nowIdx + 7)
      .map((time, i) => ({ time, tempC: Math.round(j.hourly.temperature_2m[nowIdx + 1 + i]), code: wmo(j.hourly.weather_code[nowIdx + 1 + i]) }));
    const tCode = wmo(j.daily.weather_code[1]);
    return {
      locationLabel: label,
      now: {
        tempC: Math.round(cur.temperature_2m),
        condition: CONDITION_JA[code],
        code,
        humidity: Math.round(cur.relative_humidity_2m),
        windMs: Math.round(cur.wind_speed_10m * 10) / 10,
        uvIndex: Math.round(cur.uv_index ?? 0),
        precipProb: Math.round(cur.precipitation_probability ?? 0),
        sunset: hhmm(j.daily.sunset[0]),
        airQuality,
      },
      hourly,
      tomorrow: {
        date: j.daily.time[1],
        maxC: Math.round(j.daily.temperature_2m_max[1]),
        minC: Math.round(j.daily.temperature_2m_min[1]),
        code: tCode,
        condition: CONDITION_JA[tCode],
        precipProb: Math.round(j.daily.precipitation_probability_max[1] ?? 0),
      },
      fetchedAt: new Date().toISOString(),
    };
  }
}
