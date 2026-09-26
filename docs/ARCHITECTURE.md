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
| Camera | `src/camera/` | getUserMedia（プレビューは 720p60、撮影は ImageCapture で最大解像度）、機能検出付きのズーム・ライト・露出・フォーカス、MediaRecorder、静止画取得。`DemoFeed` はプロシージャルなフォールバック映像 |
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

## 1.5 Performance architecture (最重要要件)

優先順位: **① プレビューの低遅延 ② 高FPS ③ HUD の滑らかな追従 ④ AI のリアルタイム性** > AI の精度 > 画質。

```
PIPELINE 1 (見る / 60fps)                    PIPELINE 2 (理解する / 5–15fps, 非同期)
Camera sensor                                 requestVideoFrameCallback (per camera frame)
  → getUserMedia 720p60 (preview only)          → FrameSampler: due? engine idle? else DROP (latest-frame-wins)
  → <video> → GPU compositor → screen           → createImageBitmap(resize ≤384px, GPU)  ← transfer, no copy
  → HUD overlay (transform/opacity only)        → Web Worker: MediaPipe (GPU/XNNPACK) | JPEG+fetch (remote)
                                                → { id, label, confidence, bbox } only
                                                → TrackRenderer (60fps: predict + gyro + smooth → transform)
CAPTURE (撮る): ImageCapture.takePhoto() at full sensor resolution — only on shutter
RECORD: MediaRecorder on the camera MediaStream (hardware encoder) — HUD not composited in
```

| Rule | Where |
|---|---|
| JavaScript never reads preview pixels per frame; the video is composited by the browser | `CameraController`, `FeedLayer` |
| Preview 720p60 (`ideal` + `max`, never a hard `min`) / stills via ImageCapture at max res | `CameraController.startCamera / takePhoto` |
| AI sampling decoupled from display: rVFC-driven, rate-limited, **no queue** — a busy engine drops frames | `camera/FrameSampler.ts` |
| Inference + tracking + encoding in a module Web Worker; only small JSON results come back | `services/vision/worker/*` |
| Software-GL devices use the SIMD CPU delegate (XNNPACK) instead of an emulated GPU | `vision.worker.ts#softwareGl` |
| Boxes rendered at display rate: velocity extrapolation across AI latency + gyroscope motion compensation (world-space tracks) + critically-damped smoothing; writes `transform` only | `hud/tracking/trackRenderer.ts`, `core/live.ts` |
| One shared rAF loop for everything that moves | `perf/frameLoop.ts` |
| 60 Hz sensors (compass / gyro) bypass React (`live`), store receives ≤8 Hz | `Orchestrator.wire` |
| All CSS animations are transform/opacity on their own layers (reticle, radar, shutter, scan sweep) — no SVG repaint, no layout | `hud.css`, `Reticle`, `Radar` |
| Adaptive quality: phones start without backdrop blur over the live video; the governor drops glows/scanlines when FPS < 78% of refresh | `perf/metrics.ts` (`html[data-quality]`) |
| AI rate adapts: backs off when the display drops frames, capped at 8 fps while recording | `FrameSampler.adapt`, `Orchestrator.startRecording` |
| Engines that fail (e.g. model download) stop receiving frames and retry after 15 s | `WorkerVisionService` |

### Performance Debug Mode
`?perf=1`, `VITE_PERF_HUD=1`, or SYSTEM → PERF HUD. Off by default in production. Shows:
FPS / refresh, frame time (avg, p95), dropped display frames, long tasks, camera FPS / resolution,
**camera latency** (rVFC `expectedDisplayTime − captureTime`), dropped camera frames, AI engine + delegate,
AI FPS (actual → target), inference time, AI latency (capture → result), skipped (dropped) AI frames,
JS heap, quality tier, gyro compensation. GPU/CPU utilisation is not exposed to the web and is shown as `n/a`.

Measured in this repo's CI-like sandbox (headless Chromium, software GL, fake 20fps camera):
display **60.0 fps, p95 16.8 ms** while on-device inference ran at 944 ms (GPU emulated) — the preview/HUD
are unaffected by AI cost; with the CPU delegate inference dropped to ~100 ms (6.7 AI fps).
Real phones with a GPU delegate are expected to be faster; verify on-device with `?perf=1`.

## 1.6 Real-time recognition & scene understanding

```
Camera ─▶ Tier 1: DETECT + TRACK (on-device, 5–15 fps, every sampled frame)
            MediaPipe EfficientDet-Lite0 in the vision worker → { id, label, confidence, bbox }
       ─▶ AUGMENT (metadata only)
            + cloud scene regions (buildings / signs the detector can't see)
            + OCR text (signs, labels)  · + GPS/compass building estimates (source "geo", always 推定)
       ─▶ Tier 2: IDENTIFY (once per stable track, async, budgeted — see §1.7)
            GPU crop ≤512px of *that target only* → IdentificationPipeline
            OCR → VISION ANALYSIS (features) → IDENTIFICATION (candidates) → CONFIDENCE CHECK
            → WEB VERIFY (only when it can change the answer) → graded name → cached by tracking id
       ─▶ SCENE (every ~9 s) + LOCATION fusion (1 Hz, local) + OBJECT COUNTS
       ─▶ HUD (60 fps TrackRenderer) · Voice / Search use the same focus + identity
```

### VisionProvider (`src/services/contracts.ts`)

| Provider | detect | identify | scene | text | Where |
|---|---|---|---|---|---|
| `MockVisionProvider` | scripted demo objects | scripted pipeline (OCR / features / candidates / verification) with realistic stage latency, incl. POSSIBLE / UNKNOWN | scripted | scripted | `vision/MockVisionService.ts` |
| `LocalVisionProvider` (`vision=ondevice`) | MediaPipe (worker) | crop classified once by EfficientNet-Lite0 (ImageNet-1k, int8 5.4 MB, loaded on the first identification; `VITE_CLASSIFIER_MODEL_URL`) and refined only within the detector's class (`finelabels.ts`: dog/cat breeds, car/truck types, dishes, bottle/cup types…) + on-device OCR + colour/shape + brand/model patterns from label text (e.g. `SONY WH-1000XM5`); web check through the search service. Makers and exact models need text or the cloud tier | luminance / counts / GPS heuristics | `TextDetector` in the worker when the platform has it | `vision/WorkerVisionService.ts` |
| `CloudVisionProvider` (`vision=real`) | **still on-device** (latency, cost, privacy) | gateway `/vision/ocr` + `/vision/analyze` + `/vision/verify` on crops | gateway `/vision/scene` (+ `regions`) | gateway `/vision/ocr` (JP/EN/ZH/KO) | `vision/WorkerVisionService.ts` |

Record shape (`Detection`, `src/core/types.ts`): `id`(=trackingId) · `category`(=type) · `label` · `confidence` · `bbox` · `timestamp` · `attributes` · `source` (`mock|local|cloud|geo|ocr`) · `text` · `identity` (`Identification`: status, kind, name, confidence, candidates, officialUrl, attributes).

### Honesty rules (`services/vision/perception.ts`, unit-tested)
- **≥ 80 % IDENTIFIED · 40–80 % POSSIBLE MATCH · < 40 % UNKNOWN** — recomputed on the client (`gradeIdentity`) from the candidates even if a server says otherwise. The *name* is graded too (§1.7).
- Voice mirrors it: 「〜と推定されます」/「〜の可能性があります（62%）。モデルは〜の可能性があります」/「特定できませんでした」, and says separately what the web check confirmed and what the image cannot show (「CPU / SoCは画像からは判別できません」).
- Location is **推定** unless an image-based landmark agrees with GPS (`estimateLocation`). GPS/compass building projections are never more than POSSIBLE.
- **People**: `PERSON DETECTED` only. `sanitize()` strips any name / attributes; people are never sent for identification; no face recognition, no age / gender / emotion.

### Real-time budget
- Tier 2 never runs per frame: stable ≥ 500 ms, priority locked › primary › salience, `maxInflightIdentify` (cloud: 2), cached per track, carried across tracker id changes (`reassociate`), UNKNOWN retried after 12 s or when the user locks the target.
- Crops are made with `createImageBitmap(frame, sx, sy, sw, sh, resize)` (GPU) only when an identification starts.
- The HUD re-renders only when a track's *recognition state* changes; positions and the live % are written by the TrackRenderer. Only the top-N salient objects get labels (portrait 3 / wide 5); the rest are quiet corner markers.
- Measured (sandbox, see §1.5): CITY demo with 10 objects + identification — display **60.0 fps, p95 16.8 ms**; fake camera + on-device worker — 60.0 fps, camera latency 23.8 ms, AI 6.7 fps.

### Cloud gateway — model & contract
Recommended model behind the gateway: **Claude (`claude-opus-5`)** with image input, `output_config.format` JSON schema for the `{features, candidates}` shape, **low effort** for latency on `/vision/analyze`, and the server-side refusal `fallbacks` enabled. Keep API keys on the gateway.

| Endpoint | Request | Response |
|---|---|---|
| `POST /vision/analyze` | `{ image: jpeg dataURL (crop ≤512px), label, category, ocr: string[], geo, heading, nearby:[{id,name,kind}], scene }` | `{ features: VisualFeature[], candidates: IdentityCandidate[] }` (status and name are graded client-side) |
| `POST /vision/verify` | `{ candidate: IdentityCandidate, features }` | `Verification` `{ status, matched, sources:[{title,url,publisher,tier}], facts }` — gateway runs web search + fetches official pages |
| `POST /vision/scene` | `{ image (≤768px), detections, geo, heading, now }` | `SceneAnalysis` + optional `regions: Detection[]` (buildings / signs with bbox) |
| `POST /vision/ocr` | `{ image (≤1280px) }` | `OcrResult` (blocks with bbox + lang) |
| `POST /search` | `{ query, focus{…, identity}, image?, location?, … }` | NDJSON stages + `SearchAnswer` (image search for UNKNOWN objects) |

Gateway system prompt must require: answer only what is visible; list several candidates with evidence instead of one guess; never infer specs the image can't show; return low confidence rather than guess; for people return only `kind: "person"` with no name or attributes; never read or return license plates. `/vision/verify` fits Claude with the `web_search` / `web_fetch` server tools, restricted to official domains where possible.

## 1.7 Detailed identification (LEVEL 1 → 2 → 3)

```
CAMERA → DETECTION → TRACKING ─(stable ≥500ms, target changed, or LOCK)─▶
  OCR (crop)                        OCRProvider                 "reading"   → HUD: OCR
  VISION ANALYSIS (LEVEL 2)         ImageUnderstandingProvider  "analyzing" → VISION ANALYSIS
      brand · colour · material · logo · button/camera/port layout · display shape · text · model hints · package
  IDENTIFICATION (LEVEL 3)          IdentificationProvider      "matching"  → IDENTIFICATION
      ranked candidates {name, brand, family, model, variant, confidence, evidence}
      merged with brand/model patterns found in the OCR text (independent agreement boosts)
  CONFIDENCE CHECK                  needsVerification(): only products / vehicles / buildings / food,
                                    plausible (≥40 %) and not already certain (≥90 % with a clear gap)
  WEB VERIFY (optional)             WebVerificationProvider     "verifying" → WEB VERIFY
      official / corporate / government sources only; cached per candidate name; ±confidence
  FINAL → gradeIdentity() → Identification { name, note, confidence, hierarchy, candidates,
                                              features, ocrText, verification, unknown }
```

Code: `services/vision/identify/pipeline.ts` (orchestration, cache, finish), `identify/providers.ts` (Mock / Local / Search / Cloud implementations of the four provider interfaces in `contracts.ts`), `vision/perception.ts` (pure grading rules, unit-tested in `tests/identify.test.ts`). Any provider can be replaced independently (e.g. on-device OCR + cloud understanding + your own search).

**Graded naming** (`gradeIdentity`) — never asserts what the evidence doesn't support:

| confidence | shown | example |
|---|---|---|
| ≥ 80 % | full model | **Apple MacBook Air 13-inch** · 96 % (generation/trim only as 「〜の可能性」) |
| 60–80 % | brand + family, model as a possibility | **Apple MacBook Air** · モデル：M2 / M3系の可能性 · 72 % |
| 40–60 % | family-level class | **MacBook系ノートPC** · 正確なモデルは判別できません · 41 % |
| < 40 % | unknown | 詳細モデルを特定できません |

**Never “unknown” for a known class**: when no provider can go below LEVEL 1 (no candidates, only weak ones, or the gateway is unreachable), the result stays at the detector's class with its confidence — `ノートPC 97 % · メーカー・モデルは判別できません` / `…詳細識別サービスに接続できません` (status `detected`). UNKNOWN is reserved for things the detector itself can't classify.

Two candidates closer than 10 points cap the confidence at 75 % (the pipeline compares them rather than picking one). Plants use 科 → 属 → 種, animals 種 → 品種, cars メーカー → 車種 → 世代 → グレード/年式.

**Provenance** is kept apart end to end: `features` (AI inference from the image), `ocrText` (read), `verification` (web facts + sources), `unknown` (properties the image cannot reveal, e.g. CPU / memory / storage, grade / exact year). The INTEL sheet shows them as IDENTIFIED / CANDIDATES / VISUAL ANALYSIS / OCR / WEB VERIFIED / UNKNOWN; mock verification is labelled モック.

**HUD**: the current target gets a thin `[ TARGET LOCK ]` card beside its box (transform-only, follows the track at 60 fps): name + note + confidence. Tap (or lock) expands Brand / Category / Model / Color and `[ VIEW DETAILS ]`. The big object panel is shown only in FULL density. While the pipeline runs, the card and the top bar show the stage (OCR / VISION ANALYSIS / IDENTIFICATION / WEB VERIFY).

**Cost / latency**: nothing here runs per frame. One pipeline run per track (cached by tracking id, carried across id changes); re-run only when the box changes shape/size markedly (`targetChanged`) or the track goes stale; LOCK triggers a forced web check once. Verification results are cached per candidate name.

**Privacy**: people are never sent to the pipeline. License plates are neither read, stored nor displayed (the car feature list states it explicitly; the gateway prompt must require it).

## 2. Mock / Real

解決順（上ほど優先）: SYSTEM シートでの上書き（localStorage） → `VITE_SERVICE_<NAME>` → `VITE_FRIDAY_MODE` → 既定値（voice だけ real、他は mock）。

| Service | mock | real |
|---|---|---|
| vision | デモ映像と同期したシナリオ（識別の遅延・POSSIBLE / UNKNOWN も再現） | `ondevice`: MediaPipe EfficientDet-Lite0（Web Worker・端末内、WASM は `/mediapipe/` から自前配信、モデル URL は `VITE_VISION_MODEL_URL` で変更可） / `real`: ゲートウェイ（エンコードと送信も Worker 内） |
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
| `POST /vision/analyze` · `/vision/verify` | see §1.6 | `{features, candidates}` · `Verification` |
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
