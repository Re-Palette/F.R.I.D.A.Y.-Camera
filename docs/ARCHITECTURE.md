# F.R.I.D.A.Y. Architecture

## 1. Layers

```
┌──────────────┐   frames    ┌──────────────┐  detections/scene/ocr  ┌───────────────────┐
│ Camera Layer │ ──────────▶ │ Vision Layer │ ─────────────────────▶ │ AI Orchestration  │
│ camera/      │             │ services/    │                        │ orchestrator/     │
└──────────────┘             │   vision/    │                        └─────────┬─────────┘
                             └──────────────┘                                  │ tools
      ┌────────────┬────────────┬───────────┬──────────┬──────────┬────────────┼────────────┐
      ▼            ▼            ▼           ▼          ▼          ▼            ▼            ▼
   Search       Places/Nav    Memory      Voice       LLM       Weather      News     Translate / Social
      └────────────┴────────────┴───────────┴──────────┴──────────┴────────────┴────────────┘
                                             │  state (zustand)
                                             ▼
                                      HUD UI  (hud/)
```

| Layer | Path | Role |
|---|---|---|
| Camera | `src/camera/` | getUserMedia (4K/60fps を要求)、機能検出付きのズーム・ライト・露出・フォーカス、MediaRecorder、静止画取得。`DemoFeed` はプロシージャルなフォールバック映像 |
| Vision | `src/services/vision/` | `detect` (高速、5〜15 Hz、トラッキング済みで ID が安定) / `analyzeScene` (低速) / `ocr` |
| Orchestration | `src/orchestrator/` | 各ループ、主対象の選定（ヒステリシス付き）、ターゲットロック、危険検知、意図の振り分け → ツール実行 → LLM への grounding、割り込み発話、撮影 → 意味タグ付きメモリー |
| Services | `src/services/*` | 契約は `contracts.ts`。各サービスに `Mock*` と Real の実装がある。組み立ては `registry.ts` |
| HUD | `src/hud/` | サービスを直接呼ばず、ストアを読んでオーケストレーターのメソッドを呼ぶだけ |

### Dynamic HUD (the core UX rule)
- `Orchestrator.processDetections` は、中心寄り・信頼度・面積でスコアを付け、**450ms 安定したら主対象として採用**し、**1.3s 見えなくなったら解放**します（ヒステリシス）。
- 主対象が変わると、プロフィール → 関連情報・ニュース → メモリーの想起、の順に非同期で取得します。
- パネルは `usePresence`（enter → shown → exit）で、ホログラムが展開・収束するように出入りします。
- `Hud.tsx` の `usePolicy` と `PortraitLayout` が表示の可否を一元管理します。スマホでは「左上に1枚・下部に1枚」を上限にし、天気やメモリーの想起は一時的にその枠と入れ替えます。
- HUD の密度は `minimal / auto / full` の3段階です。

### AI state
`deriveAIState()` がフラグから**導出**します（直接はセットしません）。優先度は
`SPEAKING > SEARCHING > THINKING > LISTENING(発話中) > TARGET_LOCKED > ANALYZING > IDENTIFIED > LISTENING > SCANNING`。
状態に応じて、トップバー、中央リング（回転速度、音声波形、パルス）、応答パネルが変化します。

### Conversation
1. `classifyIntent`（ルールベース、日本語優先）または `LLMService.classify`（モデルによる分類）
2. 参照表現（これ / それ / いつできた？）は、現在の focus（ロック中 > 主対象）に解決します。
3. `execute(intent)` がツールを実行し、`Grounding` を返します（search / weather / nav / memory / translation / capture / …）。
4. `LLMService.respond` が grounding を言語化してストリーミングし、`VoiceService.speak` が読み上げます。
5. 割り込み: TTS 中に STT の途中結果が来たら、自分の読み上げ音声の回り込みでないことを確認した上で `interrupt()`（TTS 停止と応答生成の中断）します。応答パネルのタップでも割り込めます。

## 2. Mock / Real

解決順（上ほど優先）: SYSTEM シートでの上書き（localStorage） → `VITE_SERVICE_<NAME>` → `VITE_FRIDAY_MODE` → 既定値（voice だけ real、他は mock）。

| Service | mock | real |
|---|---|---|
| vision | デモ映像と同期したシナリオ | `ondevice`: MediaPipe EfficientDet-Lite0（端末内） / `real`: ゲートウェイ |
| llm (+knowledge, social) | テンプレートによる言語化 | ゲートウェイ（例: Claude） |
| search | 段階表示付きのパイプラインを模擬 | ゲートウェイ（NDJSON ストリーム） |
| weather | 固定値 | **Open-Meteo（キー不要）** |
| news / places / translate | 架空データ | ゲートウェイ |
| voice | テキスト入力と擬似的な発話時間 | **Web Speech API** |
| location | お台場の座標と擬似的な手ブレ | **Geolocation + DeviceOrientation** |
| memory | デモ写真入りのインメモリ | **IndexedDB** |

モックのデータは、ランドマークの事実のみ実データです。製品・店舗・報道機関名はすべて架空で、URL は `example.com` です。モックデータを使っている画面には `MOCK DATA` バッジを表示します。

## 3. Gateway HTTP contract (`VITE_FRIDAY_API_BASE`)

プロバイダの API キーはブラウザに置かず、ゲートウェイ（サーバー）側で保持してください。

| Endpoint | Request | Response |
|---|---|---|
| `POST /vision/detect` | `{ image: dataURL, geo, heading }` | `{ detections: { label, displayName, subtitle, category, confidence, bbox(0‥1), entityId? }[] }` |
| `POST /vision/scene` | `{ image, detections, geo, heading, now }` | `SceneAnalysis` |
| `POST /vision/ocr` | `{ image }` | `OcrResult` |
| `POST /knowledge/profile` | `{ detection, geo }` | `EntityProfile \| null` |
| `POST /knowledge/related` | `{ id, name }` | `RelatedInfo[]` |
| `POST /llm/respond` | `{ utterance, intent, history, context, grounding }` | NDJSON `{"type":"token","text":…}` |
| `POST /llm/classify` | `{ utterance, context }` | `Intent \| null` |
| `POST /search` | `{ query, focus, scene, geo, locale }` | NDJSON `{"type":"stage",…}` … `{"type":"answer","answer":SearchAnswer}` |
| `POST /news` | `{ keywords, geo }` | `NewsItem[]` |
| `POST /places/nearby` / `resolve` / `reverse` | `{ geo, kinds }` / `{ query, geo }` / `{ geo }` | `PlaceInfo[]` / `PlaceInfo\|null` / `{ placeName, area }` |
| `POST /translate` | `{ items:[{id,text,lang}], target }` | `Translation[]` |
| `POST /social/draft` | `{ item, platform }` | `SocialDraft` |

型はすべて `src/core/types.ts` にあります。検索結果の情報源は、クライアント側でも `rankSources`（公式 > 公的機関 > ニュース > 企業 > 参考資料 > コミュニティ、鮮度と信頼度で補正）により並べ直します。

## 4. Privacy & safety
- 人物は「人物」としてだけ扱い、顔による個人の特定はしません。
- 端末内で完結する検出（`ondevice`）では、フレームを外部に送りません。
- 危険検知（`orchestrator/hazards.ts`）は保守的なルールで、画面中央にある大きな車両などに限って `critical` とし、振動と警告バナーで知らせます。

## 5. Extension points / roadmap
- **AI 画像・動画編集**: `MemorySheet` の `EDIT_TOOLS` / `VIDEO_TOOLS`（`ready:false`）は UI 側を配線済みです。`MediaEditService` を追加して `ready` にしてください。
- **SNS**: `SocialService` が Instagram / LinkedIn / note の投稿案を生成します。投稿 API の連携を追加してください。
- **ARナビ**: `NavTarget.eta` は徒歩・自転車・車に対応済みです。経路のポリラインは `PlacesService` を拡張して追加してください。
- **メモリーの意味検索**: `MemoryService.search` を埋め込みインデックスに置き換えても、呼び出し側の変更は不要です。
- **タブレット / ARグラス**: `WideLayout` と HUD 密度 `full` を用意しています。表示レイアウトはストアから独立しています。
