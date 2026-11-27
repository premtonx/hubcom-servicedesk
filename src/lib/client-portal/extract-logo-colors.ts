/**
 * Browser-only: extract dominant non-white / non-transparent colors from a logo data URL.
 */

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function isNearWhite(r: number, g: number, b: number): boolean {
  return r > 245 && g > 245 && b > 245;
}

function isNearBlack(r: number, g: number, b: number): boolean {
  return r < 18 && g < 18 && b < 18;
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Returns up to `maxColors` distinct brand-like hex colors from a logo image.
 */
export async function extractDominantLogoColors(
  dataUrl: string,
  maxColors = 3,
): Promise<string[]> {
  if (typeof document === 'undefined' || !dataUrl) return [];

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Logo konnte nicht geladen werden.'));
    el.src = dataUrl;
  });

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (isNearWhite(r, g, b) || isNearBlack(r, g, b)) continue;
    // Quantize to reduce noise
    const qr = Math.round(r / 16) * 16;
    const qg = Math.round(g / 16) * 16;
    const qb = Math.round(b / 16) * 16;
    const key = `${qr},${qg},${qb}`;
    const prev = buckets.get(key);
    if (prev) {
      prev.count += 1;
      prev.r += r;
      prev.g += g;
      prev.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  const ranked = [...buckets.values()]
    .map((b) => ({
      count: b.count,
      rgb: [
        Math.round(b.r / b.count),
        Math.round(b.g / b.count),
        Math.round(b.b / b.count),
      ] as [number, number, number],
    }))
    .sort((a, b) => b.count - a.count);

  const picked: [number, number, number][] = [];
  for (const entry of ranked) {
    if (picked.some((p) => colorDistance(p, entry.rgb) < 48)) continue;
    picked.push(entry.rgb);
    if (picked.length >= maxColors) break;
  }

  return picked.map(([r, g, b]) => rgbToHex(r, g, b));
}
