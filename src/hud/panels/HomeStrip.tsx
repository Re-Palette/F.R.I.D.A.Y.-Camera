import { useEffect, useState } from 'react';
import { fmtTime } from '../../core/util';
import { useFriday } from '../../store/useFriday';
import { Icon, WeatherIcon } from '../icons';

/**
 * Phone HOME: the essentials on one line — where you are, the weather, the
 * time — in place of the scene / memory / weather / compass panels. Tap to
 * see the full weather for a few seconds.
 */
export function HomeStrip() {
  const place = useFriday((s) => s.geo?.placeName ?? s.geo?.area ?? s.location?.name ?? null);
  const temp = useFriday((s) => s.weather?.now.tempC ?? null);
  const cond = useFriday((s) => s.weather?.now.condition ?? null);
  const code = useFriday((s) => s.weather?.now.code ?? null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const pinWeather = () => useFriday.setState((s) => ({ pinned: { ...s.pinned, weather: Date.now() + 8000 } }));
  return (
    <div className="home-strip" onClick={pinWeather} role="button" aria-label="現在地と天気">
      <span className="hs-place">
        <Icon.Nav size={12} />
        <span className="hs-t">{place ?? '現在地を取得中…'}</span>
      </span>
      {temp != null && (
        <span className="hs-wx">
          {code != null && <WeatherIcon code={code} size={14} />}
          <span className="num">{temp}°</span>
          {cond && <span className="hs-c">{cond}</span>}
        </span>
      )}
      <span className="hs-time num">{fmtTime(new Date(now))}</span>
    </div>
  );
}
