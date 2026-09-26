import type { Detection, GeoFix } from '../../../core/types';

export type EngineKind = 'mediapipe' | 'remote';

export type ToWorker =
  | { type: 'init'; engine: EngineKind; apiBase: string }
  | { type: 'frame'; id: number; bitmap: ImageBitmap; capturedAt: number; geo?: GeoFix; heading?: number }
  | { type: 'reset' };

export type FromWorker =
  | { type: 'ready'; engine: EngineKind; delegate?: string }
  | { type: 'error'; id?: number; message: string }
  | { type: 'result'; id: number; detections: Detection[]; inferMs: number };
