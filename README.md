# F.R.I.D.A.Y.

**現実世界を見るための AI インターフェース。**
カメラ映像の上に、認識・検索・分析・記憶・会話の結果を映画的な HUD として重ねる、AI ビジョンアシスタントです。

- **CAMERA FIRST**: 映像が主役です。HUD は「必要な瞬間だけ」現れて、対象を外すと自然に消えます。
- **Mock ↔ Real**: すべての AI / 外部 API はインターフェースで分離しています。サービスごとに `mock` と `real` を切り替えられます（`.env` またはアプリ内の SYSTEM シート）。

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173  （スマホ実機は同一LANから https 経由で）
npm test           # 意図分類 / メモリ検索 / トラッカー / 情報源ランキング
npm run build
```

- カメラが使えない環境（デスクトップ、権限拒否）では、自動的に **DEMO FEED**（プロシージャルに描画した映像）に切り替わります。
- `?demo=odaiba | desk | menu | street` を付けると、デモシーンを直接起動できます（ランドマーク / 商品 / 翻訳 / 危険検知）。
- 実機のカメラで `vision=mock` のときは、端末内の物体検出（MediaPipe、COCO 80クラス）に自動で切り替わります。
- iOS Safari で getUserMedia を使うには HTTPS が必要です。

## パフォーマンス方針

**「最高画質」より「遅延なく滑らかに動くこと」を優先します。**
- プレビューは 720p60 の低遅延ストリームを GPU で直接描画します。高解像度の写真は、シャッターを押した瞬間だけ `ImageCapture` で撮ります（「見る」と「撮る」の分離）。
- AI は別のパイプラインで動きます。Web Worker で推論し、5〜15fps で最新フレームだけを解析して、古いフレームは捨てます。
- HUD は AI の結果（ラベル・信頼度・枠）だけを受け取り、60fps で予測・補間して `transform` で追従します。ジャイロがあれば、スマホを振ったときも即座に追従します。
- `?perf=1`（または SYSTEM → PERF HUD）で、FPS・フレーム時間・カメラ遅延・AI の推論時間などを表示します。

詳しくは [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#15-performance-architecture-最重要要件) を参照してください。

## 使い方

| 操作 | 内容 |
|---|---|
| 対象をタップ | TARGET LOCK（追跡）。もう一度タップで解除 |
| 何もない場所をタップ | フォーカス |
| ピンチ / ホイール | ズーム |
| 🎤 | 音声会話（Web Speech API）。AI の発話中に話し始めると割り込み（Barge-in） |
| 下部の入力欄 | テキストで質問 |
| ブランドロゴ | SYSTEM（HUD 密度、Feed、Mock/Real 切替） |
| LIVE·720P·FPS チップ | カメラのクイック設定（フラッシュ / タイマー / NIGHT / 手ブレ補正 / プレビュー解像度 / 撮影解像度 / FPS / EV）。FPS は実測値 |

話しかける例: 「これ何？」→「いつできた？」→「夜に行くなら？」、「これについて調べて」、「明日の天気は？」、「写真撮って」、「10秒後に写真撮って」、「駅までナビして」、「これ翻訳して」、「去年撮った東京の夜景」、「インスタ用のキャプションを作って」

## スマホにアプリとしてインストール（Android Chrome）

PWA として、Chrome から「アプリをインストール」できます。フルスクリーンで起動し、オフラインでも立ち上がります。

1. **HTTPS で配信する**（カメラの利用とインストールの両方に HTTPS が必要です）
   - **GitHub Pages**: リポジトリの Settings → Pages → Source を **GitHub Actions** にすると、デフォルトブランチへの push のたびに `.github/workflows/deploy-pages.yml` がビルドして公開します（`https://<owner>.github.io/<repo>/`）。Actions タブから手動実行もできます。
   - そのほかの静的ホスティング（Vercel / Netlify / Cloudflare Pages など）でも、`npm run build` の `dist/` をそのまま配信できます。サブパスで配信する場合は `VITE_BASE=/path/` を指定してビルドしてください。
2. スマホの Chrome でその URL を開きます。
3. 画面上部の **⤓ INSTALL APP**、または SYSTEM シート（ロゴをタップ）の **INSTALL** を押します。表示されない場合は、Chrome のメニュー（⋮）→「アプリをインストール」を選んでください。
4. ホーム画面のアイコンから起動します。長押しすると「翻訳」「メモリー」のショートカットも使えます。

オフライン時の動作: アプリ本体は Service Worker で事前キャッシュします。端末内検出用の MediaPipe モデルは初回に使ったときにキャッシュし、天気は最後に取得した値を表示します。

設計の詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。
