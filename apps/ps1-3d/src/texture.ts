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

export interface TextureOptions { size: number; backColor: string; paperEdges: boolean }

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

  const art = renderFace(doc, imageOf, { outline: o.paperEdges ? 4 : 0, outlineColor: '#f6f1e4', shadow: false }, { scale: o.size / doc.size });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(art, 0, 0);

  ctx.fillStyle = o.backColor;
  ctx.fillRect(0, 0, 4, 4);
  ctx.fillStyle = skin;
  ctx.fillRect(4, 0, 4, 4);
  return canvas;
}
