import { relativeJa } from '../../core/util';
import { TIER_LABEL } from '../../services/search/ranking';
import { primaryDetection, useFriday } from '../../store/useFriday';
import { useOrch } from '../hooks';
import { Icon } from '../icons';
import { MockBadge, Sheet } from './Sheet';

const CROWD = { low: '空いています', moderate: 'やや混雑', high: '混雑' } as const;

export function IntelSheet() {
  const orch = useOrch();
  const open = useFriday((s) => s.sheet === 'intel');
  const f = useFriday((s) => s.focus);
  const det = useFriday(primaryDetection);
  const related = useFriday((s) => s.related);
  const news = useFriday((s) => s.news);
  const locked = useFriday((s) => s.lockState === 'locked');
  const ask = (q: string) => {
    orch.openSheet(null);
    void orch.ask(q);
  };
  return (
    <Sheet open={open} title="INTEL" badge={<MockBadge service="llm" />}>
      {!f ? (
        <p className="dim">対象が認識されていません。カメラを対象に向けてください。</p>
      ) : (
        <>
          <div className="label">{f.subtitle}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '4px 0 8px' }}>
            <span style={{ fontSize: 22, fontWeight: 700 }}>{f.name}</span>
            {f.nameEn && f.nameEn !== f.name && <span className="dim">{f.nameEn}</span>}
            {det && (
              <span className="glow-o num" style={{ marginLeft: 'auto', fontSize: 20 }}>
                {Math.round(det.confidence * 100)}%
              </span>
            )}
          </div>
          <p>{f.summary}</p>
          <div className="row-actions">
            <button className="btn primary" onClick={() => ask('これについて調べて')}>
              <Icon.Search size={14} /> 調べる
            </button>
            {f.place && (
              <button className="btn" onClick={() => ask(`${f.place!.name}までナビして`)}>
                <Icon.Nav size={14} /> ナビ
              </button>
            )}
            <button className="btn" onClick={() => (locked ? orch.unlock() : orch.lock())}>
              <Icon.Lock size={14} /> {locked ? '解除' : 'ロック'}
            </button>
          </div>
          {f.facts.length > 0 && (
            <>
              <h3>Facts</h3>
              <dl className="kv">
                {f.facts.map((x) => (
                  <FragmentKV key={x.key} k={x.label} v={x.value} />
                ))}
              </dl>
            </>
          )}
          {f.place && (
            <>
              <h3>Place</h3>
              <dl className="kv">
                <FragmentKV k="住所" v={f.place.address} />
                {f.place.hours && <FragmentKV k="営業時間" v={`${f.place.hours}${f.place.openNow ? '（営業中）' : ''}`} />}
                {f.place.rating && <FragmentKV k="評価" v={`★${f.place.rating}（${f.place.reviewCount?.toLocaleString()}件）`} />}
                {f.place.crowd && <FragmentKV k="混雑" v={CROWD[f.place.crowd]} />}
              </dl>
            </>
          )}
          {f.product && (
            <>
              <h3>Price comparison</h3>
              <div className="offers">
                {[...f.product.offers]
                  .sort((a, b) => a.priceJPY - b.priceJPY)
                  .map((o, i, arr) => (
                    <div key={o.store} className={`offer ${i === 0 ? 'best' : ''}`}>
                      <span>{o.store}</span>
                      <span className="bar">
                        <i style={{ width: `${(arr[0].priceJPY / o.priceJPY) * 100}%` }} />
                      </span>
                      <span className="num">¥{o.priceJPY.toLocaleString()}</span>
                    </div>
                  ))}
              </div>
              <h3>Specs</h3>
              <dl className="kv">
                <FragmentKV k="メーカー" v={f.product.maker} />
                {f.product.specs.map((s) => (
                  <FragmentKV key={s.key} k={s.label} v={s.value} />
                ))}
              </dl>
              <h3>Reviews</h3>
              <p>
                <span className="glow-o num">★{f.product.rating}</span> <span className="dim">({f.product.reviewCount.toLocaleString()}件)</span> {f.product.reviewSummary}
              </p>
              <h3>Similar</h3>
              <div className="tags">
                {f.product.similar.map((s) => (
                  <span key={s.name} className="chip">
                    {s.name} · ¥{s.priceJPY.toLocaleString()}
                  </span>
                ))}
              </div>
              <div className="row-actions">
                <a className="btn" href={f.product.officialUrl} target="_blank" rel="noreferrer">
                  <Icon.External size={14} /> 公式サイト
                </a>
              </div>
            </>
          )}
          {related.length > 0 && (
            <>
              <h3>Related</h3>
              <ul className="related">
                {related.map((r) => (
                  <li key={r.id} onClick={() => ask(`${f.name} ${r.title}`)} role="button">
                    <span>
                      {r.title}
                      {r.detail && <span className="dim"> — {r.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {news.length > 0 && (
            <>
              <h3>Real-time news</h3>
              <div className="sources">
                {news.map((n) => (
                  <a key={n.id} className="source" href={n.url} target="_blank" rel="noreferrer">
                    <span className={`tier tier-${n.tier}`}>{TIER_LABEL[n.tier]}</span>
                    <span className="t">{n.title}</span>
                    <span className="p">
                      {n.source} · {relativeJa(n.publishedAt)}
                    </span>
                  </a>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

function FragmentKV({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
