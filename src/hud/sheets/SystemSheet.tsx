import { apiBase, SERVICE_DESCRIPTIONS, SERVICE_MODES, SERVICE_NAMES } from '../../core/config';
import type { HudDensity } from '../../core/types';
import type { DemoScene } from '../../services/contracts';
import { promptInstall, usePwa } from '../../pwa';
import { useFriday } from '../../store/useFriday';
import { useOrch } from '../hooks';
import { Sheet } from './Sheet';

const SCENES: [DemoScene, string][] = [
  ['odaiba', 'ODAIBA'],
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
          <span className="d">ランドマーク / 商品 / 翻訳 / 危険検知</span>
          <span className="seg">
            {SCENES.map(([k, l]) => (
              <button key={k} className={scene === k ? 'on' : ''} onClick={() => orch.setDemoScene(k)}>
                {l}
              </button>
            ))}
          </span>
        </div>
      )}

      <h3>Services · Mock / Real</h3>
      {SERVICE_NAMES.map((n) => (
        <div key={n} className="sys-row">
          <span className="n">{n.toUpperCase()}</span>
          <span className="d">{SERVICE_DESCRIPTIONS[n]}</span>
          <span className="seg">
            {SERVICE_MODES[n].map((m) => (
              <button key={m} className={modes[n] === m ? 'on' : ''} onClick={() => void orch.setServiceMode(n, m)}>
                {m === 'ondevice' ? 'DEVICE' : m.toUpperCase()}
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
