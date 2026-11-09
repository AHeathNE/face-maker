import { renderFace, type FaceDoc } from '@face-maker/face-core';

type ImageOf = (id: string) => HTMLImageElement | undefined;

/** Alpha-weighted average colour of an image, used as the skin tone behind the collage. */
function averageColour(img: HTMLImageElement): string {
  const c = document.createElement('canvas');
  c.width = c.height = 12;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, 12, 12);
  const d = ctx.getImageData(0, 0, 12, 12).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; n += a; }
  return n ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : '#b08a6a';
}

/** The face's skin colour as #rrggbb, for painting a matching body. */
export function skinColourHex(doc: FaceDoc, imageOf: ImageOf): string {
  const base = doc.layers.find((l) => l.slot === 'face');
  const img = base && imageOf(base.partId);
  const css = img ? averageColour(img) : 'rgb(176,138,106)';
  const [r, g, b] = css.match(/\d+/g)!.map(Number);
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** The average colour of one slot's part (e.g. the collage's hair photo) as #rrggbb, or null if the face has no such part. */
export function partColourHex(doc: FaceDoc, imageOf: ImageOf, slot: string): string | null {
  const layer = doc.layers.find((l) => l.slot === slot);
  const img = layer && imageOf(layer.partId);
  if (!img) return null;
  const [r, g, b] = averageColour(img).match(/\d+/g)!.map(Number);
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

import { skinNoise, type SkinSurface } from './skinSurface.ts';

export interface TextureOptions {
  /** texture on the skin colour that fills the head texture */
  skinSurface?: { style: SkinSurface; amt: number };
  size: number; backColor: string; paperEdges: boolean;
  /** collage slots to leave out of the texture (the face layer still sets the skin tone) */
  exclude?: string[];
}

/**
 * The head texture: the 2D collage rendered small, over a skin-coloured fill.
 * The top-left corner reserves two 4×4 blocks: the solid "hair / back" colour, then plain skin (for ears and neck).
 */
export function buildHeadTexture(doc: FaceDoc, imageOf: ImageOf, o: TextureOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = o.size;
  const ctx = canvas.getContext('2d')!;

  const base = doc.layers.find((l) => l.slot === 'face');
  const baseImg = base && imageOf(base.partId);
  const skin = baseImg ? averageColour(baseImg) : '#b08a6a';
  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, o.size, o.size);
  if (o.skinSurface && o.skinSurface.style !== 'none') {
    const img = ctx.getImageData(0, 0, o.size, o.size);
    for (let y = 0; y < o.size; y++) for (let x = 0; x < o.size; x++) {
      const n = skinNoise(o.skinSurface.style, o.skinSurface.amt, x, y, doc.seed % 997);
      const i = (y * o.size + x) * 4;
      img.data[i] = Math.min(255, img.data[i] * n.f + n.warm * 14);
      img.data[i + 1] = Math.min(255, img.data[i + 1] * n.f);
      img.data[i + 2] = Math.min(255, img.data[i + 2] * n.f - n.warm * 8);
    }
    ctx.putImageData(img, 0, 0);
  }

  const shown = o.exclude?.length ? { ...doc, layers: doc.layers.filter((l) => !o.exclude!.includes(l.slot)) } : doc;
  const art = renderFace(shown, imageOf, { outline: o.paperEdges ? 4 : 0, outlineColor: '#f6f1e4', shadow: false }, { scale: o.size / doc.size });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(art, 0, 0);

  ctx.fillStyle = o.backColor;
  ctx.fillRect(0, 0, 4, 4);
  ctx.fillStyle = skin;
  ctx.fillRect(4, 0, 4, 4);
  return canvas;
}
