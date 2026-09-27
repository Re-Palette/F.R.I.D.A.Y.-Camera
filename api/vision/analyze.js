// Vercel Edge Function: POST /api/vision/analyze — one target crop → gemini-3.8-flash identification.
import { handleVisionAnalyze } from '../../gateway/vision-analyze.mjs';

export const config = { runtime: 'edge' };

export default function handler(request) {
  return handleVisionAnalyze(request, process.env);
}
