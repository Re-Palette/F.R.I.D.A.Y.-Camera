/** Encodes a (small) crop for a gateway request. Only runs when an identification starts. */
export async function bitmapToDataUrl(b: ImageBitmap, quality = 0.82): Promise<string> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(b.width, b.height);
    c.getContext('2d')!.drawImage(b, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality });
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(blob);
    });
  }
  const c = document.createElement('canvas');
  c.width = b.width;
  c.height = b.height;
  c.getContext('2d')!.drawImage(b, 0, 0);
  return c.toDataURL('image/jpeg', quality);
}

/** Mean colour of the central 60 % of a crop (avoids background at the edges). */
export function centralColor(b: ImageBitmap): [number, number, number] | null {
  try {
    const size = 24;
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    ctx.drawImage(b, b.width * 0.2, b.height * 0.2, b.width * 0.6, b.height * 0.6, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size).data;
    let r = 0;
    let g = 0;
    let bl = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      bl += d[i + 2];
    }
    const n = d.length / 4;
    return [r / n, g / n, bl / n];
  } catch {
    return null;
  }
}
