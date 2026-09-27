// Vercel Edge Function served next to the app itself (same origin):
// POST /api/live/token → { token, wsUrl, model, expiresAt }
// Set GEMINI_API_KEY (and optionally FRIDAY_ACCESS_CODE) in the Vercel project settings.
import { handleLiveToken } from '../../gateway/live-token.mjs';

export const config = { runtime: 'edge' };

export default function handler(request) {
  return handleLiveToken(request, process.env);
}
