export type SkinSurface = 'none' | 'soft' | 'grain' | 'freckled';

const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/**
 * A brightness multiplier (around 1) for one skin pixel, so a flat skin colour gets some life.
 *   soft:     slow mottling plus a very fine grain
 *   grain:    fine grain only
 *   freckled: grain plus small darker, warmer spots
 * `amt` scales the strength. The same pattern comes from the same (x, y, seed), so a face always looks the same.
 */
export function skinNoise(style: SkinSurface, amt: number, x: number, y: number, seed = 0): { f: number; warm: number } {
  if (style === 'none') return { f: 1, warm: 0 };
  const g = hash(x * 12.9898 + y * 78.233 + seed) - 0.5;
  let f = 1 + g * 0.1 * amt;
  let warm = 0;
  if (style === 'soft') {
    const lo = Math.sin(x * 0.21 + hash(seed) * 6) * Math.sin(y * 0.17 + hash(seed + 1) * 6) + 0.6 * Math.sin((x + y) * 0.09 + hash(seed + 2) * 6);
    f += lo * 0.035 * amt;
  } else if (style === 'freckled') {
    if (hash(x * 3.7 + y * 9.1 + seed * 1.3) > 0.985) { f -= 0.16 * amt; warm = 0.5; }
  }
  return { f, warm };
}
