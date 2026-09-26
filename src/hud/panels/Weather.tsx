import type { ReactNode } from 'react';
import { useFriday } from '../../store/useFriday';
import { usePresence, useSticky } from '../hooks';
import { Icon, WeatherIcon } from '../icons';

export function WeatherChip() {
  const w = useFriday((s) => s.weather);
  const geo = useFriday((s) => s.geo);
  const pin = () => useFriday.setState((s) => ({ pinned: { ...s.pinned, weather: Date.now() + 15000 } }));
  if (!w) return null;
  return (
    <div className="panel cyan wx" onClick={pin} role="button" aria-label="天気の詳細">
      <WeatherIcon code={w.now.code} size={26} />
      <div>
        <div className="t">{w.now.tempC}°C</div>
        <div className="c">{w.now.condition}</div>
      </div>
      <div className="l">
        {geo?.placeName ?? w.locationLabel} · 湿度 {w.now.humidity}% · 風 {w.now.windMs}m/s
      </div>
    </div>
  );
}

function Row({ icon, k, v }: { icon: ReactNode; k: string; v: string }) {
  return (
    <div className="env-row">
      {icon}
      <span>{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

export function EnvPanel({ show }: { show: boolean }) {
  const w = useSticky(useFriday((s) => s.weather));
  const phase = usePresence(show && !!w);
  if (!phase || !w) return null;
  return (
    <section className="panel env-panel" data-presence={phase}>
      <div className="label">
        <Icon.Target size={12} /> REAL-TIME DATA
      </div>
      <div style={{ marginTop: 4 }}>
        <Row icon={<Icon.Sun size={16} />} k="温度" v={`${w.now.tempC}°C`} />
        <Row icon={<Icon.Drop size={16} />} k="湿度" v={`${w.now.humidity}%`} />
        <Row icon={<Icon.Wind size={16} />} k="風速" v={`${w.now.windMs}m/s`} />
        <Row icon={<Icon.Leaf size={16} />} k="大気質" v={w.now.airQuality} />
        <Row icon={<Icon.Uv size={16} />} k="UV" v={String(w.now.uvIndex)} />
        <Row icon={<Icon.Rain size={16} />} k="降水確率" v={`${w.now.precipProb}%`} />
        <Row icon={<Icon.Sunset size={16} />} k="日没" v={w.now.sunset} />
      </div>
    </section>
  );
}

export function ForecastPanel({ show }: { show: boolean }) {
  const w = useSticky(useFriday((s) => s.weather));
  const phase = usePresence(show && !!w);
  if (!phase || !w) return null;
  return (
    <section className="panel fc-panel from-right" data-presence={phase}>
      <div className="fc-head">
        <WeatherIcon code={w.now.code} size={38} />
        <div>
          <div className="t">{w.now.tempC}°C</div>
          <div style={{ fontSize: 12 }}>{w.now.condition}</div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: 11 }}>
          <div className="label" style={{ justifyContent: 'flex-end' }}>
            TOMORROW
          </div>
          {w.tomorrow.condition} {w.tomorrow.maxC}° / {w.tomorrow.minC}°
        </div>
      </div>
      <div className="fc-hours">
        {w.hourly.slice(0, 4).map((h) => (
          <div key={h.time}>
            <span className="dim">{new Date(h.time).getHours()}時</span>
            <WeatherIcon code={h.code} size={18} />
            <b>{h.tempC}°</b>
          </div>
        ))}
      </div>
    </section>
  );
}
