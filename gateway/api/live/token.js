// Vercel Edge Function: POST /api/live/token → { token, wsUrl, model, expiresAt }
import { handleLiveToken } from '../../live-token.mjs';

export const config = { runtime: 'edge' };

export default function handler(request) {
  return handleLiveToken(request, process.env);
}
