# F.R.I.D.A.Y. Gateway (Gemini Live)

アプリ（GitHub Pages などの静的ホスティング）には API キーを置けないため、
**Gemini の API キーを預かり、使い捨ての一時トークンだけを発行する** 小さなサーバーです。
映像・音声はこのサーバーを経由せず、ブラウザから Google に直接 WebSocket で送られます（最小遅延）。

```
アプリ ──POST /api/live/token──▶ Gateway ──(GEMINI_API_KEY)──▶ Google: v1alpha/auth_tokens
アプリ ◀── { token, wsUrl, model } ──┘
アプリ ══ WebSocket (access_token=token) ══▶ Gemini Live
```

## Vercel にデプロイ

1. Vercel で「Add New → Project」→ このリポジトリを選び、**Root Directory を `gateway`** にする
2. Environment Variables:

| 変数 | 必須 | 内容 |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Google AI Studio で作成した API キー |
| `FRIDAY_ALLOWED_ORIGINS` | ✅ | アプリの配信元（例: `https://<user>.github.io`）。カンマ区切りで複数可 |
| `FRIDAY_ACCESS_CODE` | 推奨 | 任意の合言葉。アプリの SYSTEM に同じ値を入れた端末だけがトークンを取得できる |
| `GEMINI_LIVE_MODEL` | – | 既定 `gemini-3.8-live` |

3. デプロイ後の URL（例: `https://friday-gateway.vercel.app/api`）を、アプリの **SYSTEM → Gemini Live → GATEWAY** に入力して SAVE、**LIVE ON**。

## ローカル開発

リポジトリ直下に `.env.local`（git 管理外）を作り `GEMINI_API_KEY=...` を書いて `npm run dev`。
Vite の開発サーバーが同じ `/api/live/token` を提供します（`VITE_` ではないのでビルドには含まれません）。

## 他の環境

`live-token.mjs` の `handleLiveToken(request, env)` は Web 標準の Request → Response なので、
Cloudflare Workers / Deno Deploy などでもそのまま使えます。
