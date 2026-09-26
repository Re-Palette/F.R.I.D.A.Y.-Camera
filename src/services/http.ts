import { apiBase, gatewayHeaders } from '../core/config';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** JSON POST to the F.R.I.D.A.Y. gateway (which holds provider API keys). */
export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...gatewayHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new ApiError(`${path} → HTTP ${res.status}`, res.status);
  return (await res.json()) as T;
}

/**
 * POST that streams newline-delimited JSON events ({"type":"token","text":…}).
 * Used by the LLM and search pipelines so the HUD can render progressively.
 */
export async function postStream(
  path: string,
  body: unknown,
  onEvent: (e: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', ...gatewayHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new ApiError(`${path} → HTTP ${res.status}`, res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as Record<string, unknown>);
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf) as Record<string, unknown>);
}
