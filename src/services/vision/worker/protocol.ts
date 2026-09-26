import type { Detection, GeoFix } from '../../../core/types';

export type EngineKind = 'mediapipe' | 'remote';

export type ToWorker =
  | { type: 'init'; engine: EngineKind; apiBase: string }
  | { type: 'frame'; id: number; bitmap: ImageBitmap; capturedAt: number; geo?: GeoFix; heading?: number }
  | { type: 'text'; id: number; bitmap: ImageBitmap }
  | { type: 'classify'; id: number; bitmap: ImageBitmap }
  | { type: 'reset' };

export type FromWorker =
  | { type: 'ready'; engine: EngineKind; delegate?: string; textSupported: boolean }
  | { type: 'text'; id: number; blocks: { text: string; bbox: { x: number; y: number; w: number; h: number } }[] }
  | { type: 'classes'; id: number; classes: { label: string; score: number }[]; inferMs: number }
  | { type: 'error'; id?: number; message: string }
  | { type: 'result'; id: number; detections: Detection[]; inferMs: number };
