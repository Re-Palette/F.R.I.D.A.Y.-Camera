import { apiBase, gatewaySettings, saveGatewaySettings, SERVICE_DESCRIPTIONS, SERVICE_MODES, SERVICE_NAMES } from '../../core/config';
import type { HudDensity } from '../../core/types';
import type { DemoScene } from '../../services/contracts';
import { perf, setQualityPref, type QualityPref } from '../../perf/metrics';
import { promptInstall, usePwa } from '../../pwa';
import { useState } from 'react';
import { useFriday } from '../../store/useFriday';
import { useOrch } from '../hooks';
import { Sheet } from './Sheet';

const WAKE_LABEL = { off: 'オフ', listening: '待機中（「フライデー」と呼んでください）', paused: '一時停止中（マイク使用中 / 画面非表示）', tap: '画面をどこかタップすると待ち受けを開始します', unsupported: 'このブラウザは音声認識に非対応です', denied: 'マイクが許可されていません（アドレスバー左のアイコン → 権限 → マイク を許可）' } as const;

/** 「フライデー」 wake word toggle. */
function WakeRow() {
  const orch = useOrch();
  const wake = useFriday((s) => s.wake);
  const on = wake !== 'off' && wake !== 'unsupported' && wake !== 'denied';
  return (
    <>
      <h3>Voice</h3>
      <div className="sys-row">
        <span className="n">WAKE WORD</span>
        <span className="d">「フライデー！」と呼ぶとマイクが起動 · {WAKE_LABEL[wake]}</span>
        <span className="seg">
          <button className={on ? 'on' : ''} disabled={wake === 'unsupported'} onClick={() => orch.setWakeEnabled(!on)}>
            {on ? 'ON' : 'OFF'}
          </button>
        </span>
      </div>
    </>
  );
}

const LIVE_LABEL: Record<string, string> = {
  idle: '未接続',
  connecting: '接続中…',
  open: '接続済み',
  reconnecting: '再接続中…',
  closed: '切断',
  error: 'エラー',
};

/** Gemini Live: gateway (token endpoint) + optional access code. No provider key ever lives in the app. */
function LiveSection() {
  const orch = useOrch();
  const live = useFriday((s) => s.live);
  const visionMode = useFriday((s) => s.serviceModes.vision);
  const [gw, setGw] = useState(gatewaySettings);
  const save = () => {
    saveGatewaySettings(gw);
    orch.toast('GATEWAY SAVED');
    if (visionMode === 'live') void orch.setServiceMode('vision', 'live');
  };
  return (
    <>
      <h3>Gemini Live</h3>
      <div className="sys-row">
        <span className="n">STATUS</span>
        <span className="d">
          {visionMode === 'live' ? `${LIVE_LABEL[live?.status ?? 'idle']}${live?.detail ? ` · ${live.detail}` : ''}` : 'VISION を LIVE にすると、識別と会話を Gemini Live が担当します'}
        </span>
        <span className="seg">
          <button className={visionMode === 'live' ? 'on' : ''} onClick={() => void orch.setServiceMode('vision', visionMode === 'live' ? 'ondevice' : 'live')}>
            {visionMode === 'live' ? 'LIVE ON' : 'LIVE OFF'}
          </button>
        </span>
      </div>
      <div className="sys-row sys-form">
        <span className="n">GATEWAY</span>
        <span className="d">トークン発行用ゲートウェイの URL（例: https://xxxx.vercel.app/api）。空欄 = {apiBase()}</span>
        <input className="sys-input" type="url" inputMode="url" placeholder="https://…/api" value={gw.url} onChange={(e) => setGw({ ...gw, url: e.target.value })} />
        <input className="sys-input" type="password" placeholder="アクセスコード（設定した場合）" value={gw.accessCode} onChange={(e) => setGw({ ...gw, accessCode: e.target.value })} />
        <button className="btn primary" onClick={save}>
          SAVE
        </button>
      </div>
    </>
  );
}

const SCENES: [DemoScene, string][] = [
  ['odaiba', 'ODAIBA'],
  ['city', 'CITY'],
  ['desk', 'PRODUCT'],
  ['menu', 'MENU'],
  ['street', 'STREET'],
];

export function SystemSheet() {
  const orch = useOrch();
  const open = useFriday((s) => s.sheet === 'system');
  const density = useFriday((s) => s.density);
  const feed = useFriday((s) => s.feed);
  const scene = useFriday((s) => s.demoScene);
  const modes = useFriday((s) => s.serviceModes);
  const cameraError = useFriday((s) => s.cameraError);
  const pwa = usePwa();
  const perfHud = useFriday((s) => s.perfHud);
  const [qPref, setQPref] = useState<QualityPref>(perf.qualityPref);

  return (
    <Sheet open={open} title="SYSTEM">
      <h3 style={{ marginTop: 0 }}>App</h3>
      <div className="sys-row">
        <span className="n">INSTALL</span>
        <span className="d">
          {pwa.installed
            ? 'インストール済み（アプリとして起動中）'
            : pwa.prompt
              ? 'ホーム画面にアプリとして追加できます'
              : 'Chrome のメニュー（⋮）→「アプリをインストール」/「ホーム画面に追加」'}
        </span>
        {pwa.prompt && !pwa.installed && (
          <button className="btn primary" style={{ gridRow: '1 / span 2', gridColumn: 2 }} onClick={() => void promptInstall()}>
            ⤓ INSTALL
          </button>
        )}
      </div>

      <h3>HUD</h3>
      <div className="sys-row">
        <span className="n">DENSITY</span>
        <span className="d">MIN: 最小限 / AUTO: 必要な時だけ / FULL: 全情報</span>
        <span className="seg">
          {(['minimal', 'auto', 'full'] as HudDensity[]).map((d) => (
            <button key={d} className={density === d ? 'on' : ''} onClick={() => orch.setDensity(d)}>
              {d === 'minimal' ? 'MIN' : d.toUpperCase()}
            </button>
          ))}
        </span>
      </div>

      <h3>Performance</h3>
      <div className="sys-row">
        <span className="n">QUALITY</span>
        <span className="d">AUTO: fps が落ちたらブラー・グローを自動で軽量化（カメラの滑らかさ優先）</span>
        <span className="seg">
          {(['auto', 'high', 'balanced', 'low'] as QualityPref[]).map((q) => (
            <button
              key={q}
              className={qPref === q ? 'on' : ''}
              onClick={() => {
                setQualityPref(q);
                setQPref(q);
              }}
            >
              {q === 'balanced' ? 'BAL' : q.toUpperCase()}
            </button>
          ))}
        </span>
      </div>
      <div className="sys-row">
        <span className="n">PERF HUD</span>
        <span className="d">FPS / フレーム時間 / カメラ遅延 / AI 推論時間（開発者向け・?perf=1）</span>
        <span className="seg">
          {[false, true].map((v) => (
            <button
              key={String(v)}
              className={perfHud === v ? 'on' : ''}
              onClick={() => {
                useFriday.setState({ perfHud: v });
                try {
                  localStorage.setItem('friday.perfHud', v ? '1' : '0');
                } catch {
                  /* ignore */
                }
              }}
            >
              {v ? 'ON' : 'OFF'}
            </button>
          ))}
        </span>
      </div>

      <h3>Feed</h3>
      <div className="sys-row">
        <span className="n">SOURCE</span>
        <span className="d">{cameraError ?? (feed === 'camera' ? `カメラ映像 · vision: ${orch.visionMode}` : '合成デモ映像（モックVisionと同期）')}</span>
        <span className="seg">
          <button className={feed === 'camera' ? 'on' : ''} onClick={() => void orch.setFeed('camera')}>
            CAMERA
          </button>
          <button className={feed === 'demo' ? 'on' : ''} onClick={() => void orch.setFeed('demo')}>
            DEMO
          </button>
        </span>
      </div>
      {feed === 'demo' && (
        <div className="sys-row">
          <span className="n">DEMO SCENE</span>
          <span className="d">ランドマーク / 都市（識別デモ） / 商品 / 翻訳 / 危険検知</span>
          <span className="seg">
            {SCENES.map(([k, l]) => (
              <button key={k} className={scene === k ? 'on' : ''} onClick={() => orch.setDemoScene(k)}>
                {l}
              </button>
            ))}
          </span>
        </div>
      )}

      <WakeRow />
      <LiveSection />

      <h3>Services · Mock / Real</h3>
      {SERVICE_NAMES.map((n) => (
        <div key={n} className="sys-row">
          <span className="n">{n.toUpperCase()}</span>
          <span className="d">{SERVICE_DESCRIPTIONS[n]}</span>
          <span className="seg">
            {SERVICE_MODES[n].map((m) => (
              <button key={m} className={modes[n] === m ? 'on' : ''} onClick={() => void orch.setServiceMode(n, m)}>
                {n === 'vision' ? { mock: 'MOCK', ondevice: 'LOCAL', real: 'CLOUD', live: 'LIVE' }[m] : m === 'ondevice' ? 'DEVICE' : m.toUpperCase()}
              </button>
            ))}
          </span>
        </div>
      ))}
      <p className="dim" style={{ fontSize: 11.5, marginTop: 12 }}>
        REAL の LLM / Search / Vision / News / Places / Translate は API ゲートウェイ <span className="mono">{apiBase()}</span> に接続します（docs/ARCHITECTURE.md 参照）。Weather は Open-Meteo、Voice は
        Web Speech API、Location は端末の GPS/コンパス、Memory は IndexedDB を直接使用します。
      </p>
      <p className="faint mono" style={{ fontSize: 10.5, marginTop: 10 }}>
        F.R.I.D.A.Y. v0.1.0 · CAMERA → VISION → ORCHESTRATOR → SERVICES → HUD
      </p>
    </Sheet>
  );
}
