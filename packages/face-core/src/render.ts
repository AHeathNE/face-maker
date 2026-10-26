import type { FaceDoc, Layer } from './doc.ts';

export interface RenderStyle {
  /** paper-cutout border width in document pixels (0 = none) */
  outline: number;
  outlineColor: string;
  /** hard offset shadow, like a cutout lying on a table */
  shadow: boolean;
}

export interface Drawable { canvas: HTMLCanvasElement; pad: number }

const cache = new WeakMap<object, Map<string, Drawable>>();

/** Part image with an optional silhouette border baked in, optionally mirrored. Cached per image. */
export function makeDrawable(img: HTMLImageElement, outlineSrcPx: number, color: string, flipX: boolean, flipY = false): Drawable {
  const r = Math.round(outlineSrcPx);
  const key = `${r}|${color}|${flipX}|${flipY}`;
  let per = cache.get(img);
  if (!per) cache.set(img, (per = new Map()));
  const hit = per.get(key);
  if (hit) return hit;

  const pad = r > 0 ? r + 1 : 0;
  const w = img.naturalWidth + pad * 2, h = img.naturalHeight + pad * 2;
  const base = document.createElement('canvas');
  base.width = w; base.height = h;
  const bctx = base.getContext('2d')!;
  if (r > 0) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      bctx.drawImage(img, pad + Math.cos(a) * r, pad + Math.sin(a) * r);
    }
    bctx.globalCompositeOperation = 'source-in';
    bctx.fillStyle = color;
    bctx.fillRect(0, 0, w, h);
    bctx.globalCompositeOperation = 'source-over';
  }
  bctx.drawImage(img, pad, pad);

  let canvas = base;
  if (flipX || flipY) {
    canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const c = canvas.getContext('2d')!;
    c.translate(flipX ? w : 0, flipY ? h : 0);
    c.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    c.drawImage(base, 0, 0);
  }
  const out = { canvas, pad };
  per.set(key, out);
  return out;
}

/** Everything needed to draw one layer, shared by the Konva editor and the exporter. */
export function layerDrawable(layer: Layer, img: HTMLImageElement, style: RenderStyle) {
  const k = layer.w / img.naturalWidth; // document px per source px
  const d = makeDrawable(img, style.outline > 0 ? Math.max(1, style.outline / k) : 0, style.outlineColor, layer.flipX, !!layer.flipY);
  return { ...d, k, width: d.canvas.width * k, height: d.canvas.height * k };
}

export const SHADOW = { dx: 4, dy: 6, color: 'rgba(0,0,0,0.38)' };

export function renderFace(
  doc: FaceDoc,
  imageOf: (partId: string) => HTMLImageElement | undefined,
  style: RenderStyle,
  opts: { scale?: number; trim?: boolean } = {},
): HTMLCanvasElement {
  const scale = opts.scale ?? 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(doc.size * scale); canvas.height = canvas.width;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  for (const layer of doc.layers) {
    const img = imageOf(layer.partId);
    if (!img) continue;
    const d = layerDrawable(layer, img, style);
    ctx.save();
    ctx.translate(layer.x * scale, layer.y * scale);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    if (style.shadow) {
      ctx.shadowColor = SHADOW.color;
      ctx.shadowOffsetX = SHADOW.dx * scale; ctx.shadowOffsetY = SHADOW.dy * scale;
    }
    ctx.drawImage(d.canvas, (-d.width / 2) * scale, (-d.height / 2) * scale, d.width * scale, d.height * scale);
    ctx.restore();
  }
  return opts.trim ? trimToContent(canvas, Math.round(10 * scale)) : canvas;
}

export function trimToContent(src: HTMLCanvasElement, margin = 8): HTMLCanvasElement {
  const { width, height } = src;
  const data = src.getContext('2d')!.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return src;
  minX = Math.max(0, minX - margin); minY = Math.max(0, minY - margin);
  maxX = Math.min(width - 1, maxX + margin); maxY = Math.min(height - 1, maxY + margin);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(src, -minX, -minY);
  return out;
}

export const canvasToBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
