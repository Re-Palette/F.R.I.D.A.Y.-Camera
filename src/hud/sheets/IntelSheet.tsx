import type { Detection, Identification, Verification } from '../../core/types';
import { relativeJa } from '../../core/util';
import { headline, shownConfidence } from '../../services/vision/perception';
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
          <div className="label">
            <span className={`obj-head st-${f.identity?.status ?? 'detected'}`}>{det ? headline(det) : f.subtitle}</span>
            <span className="sub">{f.subtitle}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '4px 0 8px' }}>
            <span style={{ fontSize: 22, fontWeight: 700 }}>{f.name}</span>
            {f.nameEn && f.nameEn !== f.name && <span className="dim">{f.nameEn}</span>}
            {det && (
              <span className="glow-o num" style={{ marginLeft: 'auto', fontSize: 20 }}>
                {Math.round(shownConfidence(det) * 100)}%
              </span>
            )}
          </div>
          {(det?.identity ?? f.identity)?.note && <p className="idt-note">{(det?.identity ?? f.identity)!.note}</p>}
          <p>{f.summary}</p>
          {det && (det.identity ?? f.identity) && <Provenance idt={(det.identity ?? f.identity)!} det={det} />}
          <div className="row-actions">
            <button className="btn primary" onClick={() => ask('これについて調べて')}>
              <Icon.Search size={14} /> {f.identity?.status === 'unknown' ? '画像で調べる' : '調べる'}
            </button>
            {f.officialUrl && (
              <a className="btn" href={f.officialUrl} target="_blank" rel="noopener noreferrer">
                <Icon.External size={14} /> 公式サイト
              </a>
            )}
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

const SRC_LABEL = { visual: '画像', ocr: 'OCR', web: 'WEB', context: '状況' } as const;
const WEB_STATUS: Record<Verification['status'], string> = {
  verified: '一致を確認',
  partial: '一部一致',
  unverified: '確認できず',
  contradicted: '不一致',
  skipped: '未実施',
};

/**
 * Where each piece of the answer came from — AI inference (VISUAL ANALYSIS,
 * OCR), web facts (WEB VERIFIED) and what the image cannot tell (UNKNOWN)
 * are never mixed.
 */
function Provenance({ idt, det }: { idt: Identification; det: Detection }) {
  const pct = (c: number) => `${Math.round(c * 100)}%`;
  const v = idt.verification;
  const mock = idt.source === 'mock';
  const visual = (idt.features ?? []).filter((x) => x.source !== 'ocr' && x.source !== 'web');
  const ocr = idt.ocrText?.length ? idt.ocrText : det.text ? [det.text] : [];
  const status =
    idt.status === 'identifying'
      ? '識別中…'
      : idt.status === 'unknown'
        ? `特定できません（${pct(idt.confidence)}）`
        : idt.status === 'detected'
          ? `カテゴリーのみ · ${pct(det.confidence)}${idt.note ? `（${idt.note}）` : ''}`
          : `${idt.status === 'possible' ? 'POSSIBLE' : 'IDENTIFIED'} · ${pct(idt.confidence)}`;
  return (
    <>
      <h3>Identified</h3>
      <dl className="kv">
        <FragmentKV k="検出" v={`${det.displayName} · ${pct(det.confidence)}`} />
        <FragmentKV k="識別" v={status} />
        {idt.status !== 'identifying' && idt.name && <FragmentKV k="名称" v={idt.note ? `${idt.name}（${idt.note}）` : idt.name} />}
        {Object.entries(idt.attributes ?? {}).map(([k, val]) => (
          <FragmentKV key={k} k={k} v={val} />
        ))}
        <FragmentKV k="エンジン" v={`${idt.source}${mock ? '（モック）' : ''}`} />
      </dl>
      {idt.candidates && idt.candidates.length > 1 && (
        <>
          <h3>Candidates</h3>
          <div className="offers cands">
            {idt.candidates.map((c, i) => (
              <div key={c.name} className={`offer ${i === 0 ? 'best' : ''}`} title={c.evidence?.join(' / ')}>
                <span>
                  {c.name}
                  {c.evidence?.length ? <span className="dim ev"> — {c.evidence.slice(0, 3).join('・')}</span> : null}
                </span>
                <span className="bar">
                  <i style={{ width: pct(c.confidence) }} />
                </span>
                <span className="num">{pct(c.confidence)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {visual.length > 0 && (
        <>
          <h3>Visual analysis <span className="dim">AI推定</span></h3>
          <dl className="kv">
            {visual.map((x, i) => (
              <FragmentKV key={`${x.key}-${i}`} k={x.label} v={`${x.value}${x.source !== 'visual' ? `（${SRC_LABEL[x.source]}）` : ''}`} />
            ))}
          </dl>
        </>
      )}
      {ocr.length > 0 && (
        <>
          <h3>OCR <span className="dim">読み取った文字</span></h3>
          <div className="tags">
            {ocr.map((t) => (
              <span key={t} className="chip mono">
                {t}
              </span>
            ))}
          </div>
        </>
      )}
      {v && v.status !== 'skipped' && (
        <>
          <h3>
            Web verified <span className="dim">{WEB_STATUS[v.status]}{mock ? ' · モック' : ''}</span>
          </h3>
          {v.matched.length > 0 && <p className="dim">一致：{v.matched.join(' / ')}</p>}
          {v.facts.length > 0 && (
            <dl className="kv">
              {v.facts.map((x) => (
                <FragmentKV key={x.key} k={x.label} v={x.value} />
              ))}
            </dl>
          )}
          {v.sources.length > 0 && (
            <div className="sources">
              {v.sources.map((src) => (
                <a key={src.url} className="source" href={src.url} target="_blank" rel="noopener noreferrer">
                  <span className={`tier tier-${src.tier}`}>{TIER_LABEL[src.tier]}</span>
                  <span className="t">{src.title}</span>
                  <span className="p">{src.publisher}</span>
                </a>
              ))}
            </div>
          )}
        </>
      )}
      {idt.unknown && idt.unknown.length > 0 && (
        <>
          <h3>Unknown <span className="dim">画像からは判別できません</span></h3>
          <div className="tags">
            {idt.unknown.map((u) => (
              <span key={u} className="chip unknown">
                {u}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  );
}
