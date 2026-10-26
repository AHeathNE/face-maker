import { FaceLandmarker, FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { Gender, Slot } from '@face-maker/face-core';

type Pt = { x: number; y: number };
interface CachedLandmarks { w: number; h: number; none?: boolean; yaw?: number; how?: string; lm?: number[] }
interface SourceMeta {
  pack?: string; landmarks?: CachedLandmarks | null;
  provider: string; objectId: string; era: string; url: string; title: string; artist: string;
  date: string; credit: string; license: string; genderGuess: Gender | null; image: string;
}
interface CutPart { slot: Slot; id: string; canvas: HTMLCanvasElement; anchor: Pt; headRatio: number; offset: Pt; rejected: boolean; el?: HTMLElement }
type GenderSource = 'category' | 'guess' | 'default' | 'manual';
interface Entry { yaw?: number; faceAspect?: number; eyeSep?: number; genderSource: GenderSource; how?: string; meta: SourceMeta; gender: Gender | 'skip' | 'unset'; parts: CutPart[]; done: boolean; card?: HTMLElement }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const main = $('main'), statusEl = $('status'), eraSel = $<HTMLSelectElement>('era');
const PACK = new URLSearchParams(location.search).get('pack') ?? 'historic';
/** when set, only these slots are cut and saved, leaving the rest of each source's parts alone */
let onlySlots: Set<Slot> | null = null;
const MAX_SOURCE = 3200;
const MAX_PART = 640;

let landmarker: FaceLandmarker;
let segmenter: ImageSegmenter;
let entries: Entry[] = [];

// ---------- geometry ----------
const centroid = (pts: Pt[]): Pt => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function expand(poly: Pt[], sx: number, sy: number): Pt[] {
  const c = centroid(poly);
  return poly.map((p) => ({ x: c.x + (p.x - c.x) * sx, y: c.y + (p.y - c.y) * sy }));
}

function ellipse(c: Pt, rx: number, ry: number, n = 20): Pt[] {
  return Array.from({ length: n }, (_, i) => ({ x: c.x + Math.cos((i / n) * Math.PI * 2) * rx, y: c.y + Math.sin((i / n) * Math.PI * 2) * ry }));
}

/** Closed path through polygon midpoints – gives a slightly rounded "scissor cut" edge. */
function smoothPath(ctx: CanvasRenderingContext2D, poly: Pt[]) {
  const n = poly.length;
  const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  ctx.beginPath();
  const m0 = mid(poly[n - 1], poly[0]);
  ctx.moveTo(m0.x, m0.y);
  for (let i = 0; i < n; i++) {
    const m = mid(poly[i], poly[(i + 1) % n]);
    ctx.quadraticCurveTo(poly[i].x, poly[i].y, m.x, m.y);
  }
  ctx.closePath();
}

const indicesOf = (conns: { start: number; end: number }[]) => [...new Set(conns.flatMap((c) => [c.start, c.end]))];
const NOSE = [6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 97, 326, 327, 129, 358, 49, 279, 48, 278, 64, 294, 168, 122, 351];

// ---------- cutting ----------
/**
 * Heal-brush fill, in two layers.
 *  1. Low frequencies: a smooth (harmonic) fill grown inward from the clean skin around each region, so no shading from the
 *     removed eyes, nose or mouth can leak in.
 *  2. High frequencies: the fine texture (engraving hatching, paint cracks, grain) of a clean patch of the same face, added on top
 *     and faded out toward the edge so there is no seam.
 */
function healRegions(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, s: number, minX: number, minY: number, regions: Pt[][]) {
  const W = canvas.width, H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const px = img.data;

  // blurred copy, to split every pixel into low + high frequency
  const bc = document.createElement('canvas');
  bc.width = W; bc.height = H;
  const bctx = bc.getContext('2d', { willReadFrequently: true })!;
  bctx.filter = `blur(${Math.max(3, Math.round(W / 70))}px)`;
  bctx.drawImage(canvas, 0, 0);
  const blur = bctx.getImageData(0, 0, W, H).data;

  const rasterize = (polys: Pt[][], grow = 0): Uint8Array => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    g.setTransform(s, 0, 0, s, -minX * s, -minY * s);
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = grow / s; g.lineJoin = 'round';
    for (const p of polys) { smoothPath(g, p); g.fill(); if (grow) g.stroke(); }
    const d = g.getImageData(0, 0, W, H).data;
    const m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
    return m;
  };
  const inFace = new Uint8Array(W * H);
  for (let i = 0; i < inFace.length; i++) inFace[i] = px[i * 4 + 3] > 250 ? 1 : 0;
  const holeNear = rasterize(regions, Math.max(8, W / 45));
  const clean = new Uint8Array(W * H);
  for (let i = 0; i < clean.length; i++) clean[i] = inFace[i] && !holeNear[i] ? 1 : 0;
  // keep patches away from the cut edge too: a pixel is only clean if its neighbours are in the face
  for (let i = W + 1; i < clean.length - W - 1; i++) if (clean[i] && !(inFace[i - 1] && inFace[i + 1] && inFace[i - W] && inFace[i + W])) clean[i] = 0;

  const done = new Uint8Array(W * H);
  const dirs = Array.from({ length: 16 }, (_, k) => [Math.cos((k / 16) * Math.PI * 2), Math.sin((k / 16) * Math.PI * 2)]);
  for (const region of regions) {
    const m = rasterize([region]);
    const pts: number[] = [];
    for (let i = 0; i < m.length; i++) if (m[i] && inFace[i] && !done[i]) pts.push(i);
    if (pts.length < 30) continue;
    const N = pts.length;
    const idx = new Int32Array(W * H).fill(-1);
    pts.forEach((p, k) => { idx[p] = k; });

    // --- layer 1: smooth harmonic fill from the surrounding skin
    const nbrs = [-1, 1, -W, W];
    const links: Int32Array[] = pts.map((p) => {
      const out: number[] = [];
      for (const d of nbrs) {
        const q = p + d;
        if (q < 0 || q >= W * H) continue;
        if ((d === -1 && p % W === 0) || (d === 1 && p % W === W - 1)) continue;
        if (!inFace[q] && idx[q] < 0) continue;
        out.push(q);
      }
      return Int32Array.from(out);
    });
    const f = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
    for (let c = 0; c < 3; c++) {
      let avg = 0, cnt = 0;
      for (let k = 0; k < N; k += 5) for (const q of links[k]) if (idx[q] < 0) { avg += blur[q * 4 + c]; cnt++; }
      f[c].fill(cnt ? avg / cnt : 128);
      for (let iter = 0; iter < 450; iter++) {
        for (let k = 0; k < N; k++) {
          const L = links[k];
          if (!L.length) continue;
          let sum = 0;
          for (let t = 0; t < L.length; t++) { const q = L[t], qi = idx[q]; sum += qi >= 0 ? f[c][qi] : blur[q * 4 + c]; }
          f[c][k] += 1.8 * (sum / L.length - f[c][k]);
        }
      }
    }

    // --- layer 2: fine texture from the nearest clean patch, faded in from the edge
    // candidate patches to copy texture from, best coverage first; each pixel uses the first one that is valid for it
    const cands: { dx: number; dy: number; cover: number; r: number }[] = [];
    for (const r of [0.14, 0.2, 0.27, 0.35, 0.44, 0.54, 0.65]) {
      for (const [ux, uy] of dirs) {
        const dx = Math.round(ux * r * W), dy = Math.round(uy * r * H);
        let ok = 0, n = 0;
        for (let k = 0; k < N; k += 3) {
          const x = (pts[k] % W) + dx, y = Math.floor(pts[k] / W) + dy;
          n++;
          if (x >= 0 && y >= 0 && x < W && y < H && clean[y * W + x]) ok++;
        }
        if (ok / n >= 0.3) cands.push({ dx, dy, cover: ok / n, r });
      }
    }
    cands.sort((a, b) => (b.cover >= 0.95 ? 1 : b.cover) - (a.cover >= 0.95 ? 1 : a.cover) || a.r - b.r);
    const patches = cands.slice(0, 8);
    // distance (in pixels) from the region edge, so the texture fades in over ~8px
    const dist = new Float32Array(N).fill(99);
    for (let k = 0; k < N; k++) if (links[k].some((q) => idx[q] < 0) || links[k].length < 4) dist[k] = 1;
    for (let pass = 0; pass < 12; pass++) {
      for (let k = 0; k < N; k++) for (const q of links[k]) { const qi = idx[q]; if (qi >= 0 && dist[qi] + 1 < dist[k]) dist[k] = dist[qi] + 1; }
    }
    for (let k = 0; k < N; k++) {
      const p = pts[k];
      let hp = [0, 0, 0];
      for (const b of patches) {
        const x = (p % W) + b.dx, y = Math.floor(p / W) + b.dy;
        if (x >= 0 && y >= 0 && x < W && y < H && clean[y * W + x]) {
          const o = (y * W + x) * 4;
          hp = [px[o] - blur[o], px[o + 1] - blur[o + 1], px[o + 2] - blur[o + 2]];
          break;
        }
      }
      const w = Math.min(1, dist[k] / 8);
      const o = p * 4;
      for (let c = 0; c < 3; c++) px[o + c] = Math.max(0, Math.min(255, f[c][k] + hp[c] * w));
      done[p] = 1;
    }
  }
  ctx.putImageData(img, 0, 0);
}

interface CutOptions {
  blank?: { regions: Pt[][] };
  /** draw this instead of the whole source (used for the hair cut-out, which lives in a window of the source) */
  source?: { img: CanvasImageSource; x: number; y: number; w: number; h: number };
  /** clip with a plain rectangle instead of the rounded scissor-cut path */
  rect?: boolean;
}

function cutPolygon(img: CanvasImageSource, upPoly: Pt[], fc: Pt, angle: number, flip: boolean, o: CutOptions = {}) {
  const xs = upPoly.map((p) => p.x), ys = upPoly.map((p) => p.y);
  const pad = 3;
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) + pad - minX, h = Math.max(...ys) + pad - minY;
  if (w < 20 || h < 20) return null;
  const s = Math.min(1, MAX_PART / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * s); canvas.height = Math.ceil(h * s);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(s, s);
  if (flip) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.translate(-minX, -minY);
  if (o.rect) { ctx.beginPath(); ctx.rect(minX, minY, w, h); } else smoothPath(ctx, upPoly);
  ctx.clip();
  ctx.save();
  ctx.translate(fc.x, fc.y); ctx.rotate(-angle); ctx.translate(-fc.x, -fc.y);
  if (o.source) ctx.drawImage(o.source.img, o.source.x, o.source.y, o.source.w, o.source.h);
  else ctx.drawImage(img, 0, 0);
  ctx.restore();
  if (o.blank) healRegions(ctx, canvas, s, minX, minY, o.blank.regions);
  const c = o.rect ? { x: minX + w / 2, y: minY + h / 2 } : centroid(upPoly);
  const ax = (c.x - minX) * s, ay = (c.y - minY) * s;
  return { canvas, anchor: { x: flip ? canvas.width - ax : ax, y: ay }, srcW: w, center: c };
}

function toPart(entry: Entry, slot: Slot, n: number, cut: NonNullable<ReturnType<typeof cutPolygon>>, fc: Pt, faceW: number): CutPart {
  return {
    slot, id: `${entry.meta.era}-${entry.meta.objectId}-${slot}${n}`, rejected: false, canvas: cut.canvas, anchor: cut.anchor,
    headRatio: cut.srcW / faceW, offset: { x: (cut.center.x - fc.x) / faceW, y: (cut.center.y - fc.y) / faceW },
  };
}

const HAIR_SIZE = 768;
const HAIR_CONFIDENCE = 0.5;

/**
 * Segments hair in a window around the head and cuts it as its own part.
 * The window is generous (3.6 face-widths, shifted up) so tall hair and wigs fit.
 */
function cutHair(img: CanvasImageSource, lm: Pt[], up: (p: Pt) => Pt, fc: Pt, angle: number, faceW: number) {
  const S = faceW * 3.6;
  const wx = fc.x - S / 2, wy = fc.y - S / 2 - faceW * 0.4;
  const win = document.createElement('canvas');
  win.width = win.height = HAIR_SIZE;
  const wctx = win.getContext('2d', { willReadFrequently: true })!;
  wctx.fillStyle = '#808080';
  wctx.fillRect(0, 0, HAIR_SIZE, HAIR_SIZE);
  wctx.drawImage(img, wx, wy, S, S, 0, 0, HAIR_SIZE, HAIR_SIZE);

  const result = segmenter.segment(win);
  const mask = result.confidenceMasks?.[1];
  if (!mask) { result.close(); return null; }
  const conf = mask.getAsFloat32Array();
  const mw = mask.width, mh = mask.height;

  const px = wctx.getImageData(0, 0, HAIR_SIZE, HAIR_SIZE);
  const k = S / mw; // window px per mask px
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const c = conf[y * mw + x];
      const i = (y * HAIR_SIZE + x) * 4; // window canvas and mask are the same size
      px.data[i + 3] = c <= 0.3 ? 0 : c >= HAIR_CONFIDENCE + 0.15 ? 255 : Math.round(((c - 0.3) / (HAIR_CONFIDENCE + 0.15 - 0.3)) * 255);
      if (c > HAIR_CONFIDENCE) {
        count++;
        const u = up({ x: wx + (x + 0.5) * k, y: wy + (y + 0.5) * k });
        if (u.x < minX) minX = u.x; if (u.x > maxX) maxX = u.x;
        if (u.y < minY) minY = u.y; if (u.y > maxY) maxY = u.y;
      }
    }
  }
  mask.close(); result.close();

  // Quality gate: enough hair, wide enough to be a head of hair rather than a stray patch.
  const area = count * k * k;
  if (area < faceW * faceW * 0.25 || maxX - minX < faceW * 0.7) return null;

  wctx.putImageData(px, 0, 0);
  const pad = faceW * 0.03;
  const poly = [{ x: minX - pad, y: minY - pad }, { x: maxX + pad, y: minY - pad }, { x: maxX + pad, y: maxY + pad }, { x: minX - pad, y: maxY + pad }];
  return cutPolygon(img, poly, fc, angle, false, { rect: true, source: { img: win, x: wx, y: wy, w: S, h: S } });
}

function cutFace(img: CanvasImageSource, lm: Pt[], entry: Entry) {
  const L = FaceLandmarker;
  const eyeL = indicesOf(L.FACE_LANDMARKS_LEFT_EYE), eyeR = indicesOf(L.FACE_LANDMARKS_RIGHT_EYE);
  const browL = indicesOf(L.FACE_LANDMARKS_LEFT_EYEBROW), browR = indicesOf(L.FACE_LANDMARKS_RIGHT_EYEBROW);
  const lips = indicesOf(L.FACE_LANDMARKS_LIPS), oval = indicesOf(L.FACE_LANDMARKS_FACE_OVAL);

  // Remove head roll so every part is stored upright.
  const a = lm[33], b = lm[263];
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const fc = centroid(oval.map((i) => lm[i]));
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  const up = (p: Pt): Pt => ({ x: fc.x + (p.x - fc.x) * cos - (p.y - fc.y) * sin, y: fc.y + (p.x - fc.x) * sin + (p.y - fc.y) * cos });
  const U = lm.map(up);
  const pts = (idx: number[]) => idx.map((i) => U[i]);

  const faceW = Math.abs(U[454].x - U[234].x);
  // Head turn: where the nose tip sits between the two face edges (0.5 = facing the camera, 0 / 1 = side profile).
  // Shape cues that squash in profile: face width vs height, and eye separation vs face width.
  entry.faceAspect = faceW / Math.max(1, Math.abs(U[152].y - U[10].y));
  entry.eyeSep = Math.abs(U[263].x - U[33].x) / faceW;
  // Prefer the model's pose estimate; fall back to where the nose tip sits between the face edges.
  entry.yaw = (lm as Landmarks).yaw ?? Math.min(1, Math.abs((U[1].x - U[234].x) / (U[454].x - U[234].x) - 0.5) * 2);
  const eyeY = (U[33].y + U[263].y) / 2;
  const noseBaseY = U[2].y;
  const earRy = Math.max((noseBaseY - eyeY) * 0.65, faceW * 0.12);
  const earRx = faceW * 0.075;
  const earCY = (eyeY + noseBaseY) / 2;
  const leftIsMinX = (idx: number[]) => centroid(pts(idx)).x < U[1].x;

  type Job = { slot: Slot; poly: Pt[]; flip: boolean; blank?: { regions: Pt[][] } };
  // The base face is cut with eyes, brows, nose and mouth painted out; those come back as separate parts.
  const blankFeatures = {
    regions: [
      expand(hull(pts(eyeL)), 2.2, 3.6), expand(hull(pts(eyeR)), 2.2, 3.6),
      expand(hull(pts(browL)), 1.8, 3.1), expand(hull(pts(browR)), 1.8, 3.1),
      expand(hull(pts(NOSE)), 1.8, 1.55), expand(hull(pts(lips)), 1.9, 2.7),
    ],
  };
  const jobs: Job[] = [
    { slot: 'eye', poly: expand(hull(pts(eyeL)), 1.45, 2.3), flip: !leftIsMinX(eyeL) },
    { slot: 'eye', poly: expand(hull(pts(eyeR)), 1.45, 2.3), flip: !leftIsMinX(eyeR) },
    { slot: 'brow', poly: expand(hull(pts(browL)), 1.2, 1.9), flip: !leftIsMinX(browL) },
    { slot: 'brow', poly: expand(hull(pts(browR)), 1.2, 1.9), flip: !leftIsMinX(browR) },
    { slot: 'nose', poly: expand(hull(pts(NOSE)), 1.3, 1.12), flip: false },
    { slot: 'mouth', poly: expand(hull(pts(lips)), 1.3, 1.7), flip: false },
    { slot: 'ear', poly: ellipse({ x: U[234].x - faceW * 0.02, y: earCY }, earRx, earRy), flip: false },
    { slot: 'ear', poly: ellipse({ x: U[454].x + faceW * 0.02, y: earCY }, earRx, earRy), flip: true },
    { slot: 'face', poly: expand(hull(pts(oval)), 1.03, 1.03), flip: false, blank: blankFeatures },
  ];

  const counts: Record<string, number> = {};
  for (const j of jobs.filter((j) => !onlySlots || onlySlots.has(j.slot))) {
    const cut = cutPolygon(img, j.poly, fc, angle, j.flip, { blank: j.blank });
    if (!cut) continue;
    const n = (counts[j.slot] = (counts[j.slot] ?? 0) + 1);
    entry.parts.push(toPart(entry, j.slot, n, cut, fc, faceW));
  }
  const hair = !onlySlots || onlySlots.has('hair') ? cutHair(img, lm, up, fc, angle, faceW) : null;
  if (hair) entry.parts.push(toPart(entry, 'hair', 1, hair, fc, faceW));
  return { fc, angle };
}

// ---------- UI ----------
function drawOverlay(canvas: HTMLCanvasElement, img: CanvasImageSource, iw: number, ih: number, lm?: Pt[]) {
  const s = 200 / iw;
  canvas.width = 200; canvas.height = Math.round(ih * s);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (!lm) return;
  ctx.fillStyle = '#6fcf97';
  for (const p of lm) ctx.fillRect(p.x * s - 0.5, p.y * s - 0.5, 1.5, 1.5);
}

function renderCard(entry: Entry, thumb: HTMLCanvasElement | null, note = '') {
  const m = entry.meta;
  const card = entry.card ?? (entry.card = document.createElement('div'));
  card.className = 'card' + (entry.parts.length ? '' : ' noface');
  card.innerHTML = '';
  const src = document.createElement('div'); src.className = 'src';
  if (thumb) src.appendChild(thumb);
  const meta = document.createElement('div'); meta.className = 'meta';
  meta.innerHTML = `<b>${m.title}</b><br>${m.artist}, ${m.date}<br><a style="color:#8ab4f8" href="${m.url}" target="_blank">${m.provider} #${m.objectId}</a> · ${m.license}`;
  src.appendChild(meta);
  const body = document.createElement('div');
  const row = document.createElement('div'); row.className = 'row';
  const sel = document.createElement('select');
  for (const v of ['unset', 'masc', 'femme', 'andro', 'skip']) sel.add(new Option(v === 'unset' ? 'gender?' : v, v));
  sel.value = entry.gender;
  sel.onchange = () => { entry.gender = sel.value as Entry['gender']; entry.genderSource = 'manual'; sel.classList.toggle('unset', sel.value === 'unset'); };
  sel.classList.toggle('unset', entry.gender === 'unset');
  row.append(sel);
  const tag = document.createElement('span'); tag.className = 'tag';
  tag.textContent = entry.parts.length ? `${entry.parts.length} parts · ${entry.how} · turn ${(entry.yaw ?? 0).toFixed(2)}` : (note || 'no face found');
  row.append(tag);
  body.append(row);
  const parts = document.createElement('div'); parts.className = 'parts';
  for (const p of entry.parts) {
    const el = document.createElement('div'); el.className = 'part';
    const view = document.createElement('canvas'); view.width = p.canvas.width; view.height = p.canvas.height;
    view.getContext('2d')!.drawImage(p.canvas, 0, 0);
    const label = document.createElement('span'); label.textContent = p.slot;
    el.append(view, label);
    el.onclick = () => { p.rejected = !p.rejected; el.classList.toggle('rejected', p.rejected); };
    p.el = el;
    parts.append(el);
  }
  body.append(parts);
  card.append(src, body);
  if (!card.parentElement) main.append(card);
}

async function loadImage(url: string): Promise<{ img: CanvasImageSource; w: number; h: number }> {
  const el = new Image();
  el.src = url;
  await el.decode();
  const k = Math.min(1, MAX_SOURCE / Math.max(el.naturalWidth, el.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(el.naturalWidth * k); c.height = Math.round(el.naturalHeight * k);
  c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height);
  return { img: c, w: c.width, h: c.height };
}

const MIN_FACE_PX = 110;
const DETECT_SIZE = 768;

/** Rejects detections that are too small to give crisp parts, or whose landmarks are not arranged like a face. */
function qualityProblem(lm: Pt[]): string | null {
  const faceW = Math.hypot(lm[454].x - lm[234].x, lm[454].y - lm[234].y);
  if (faceW < MIN_FACE_PX) return `face too small (${Math.round(faceW)}px)`;
  const eyeY = (lm[33].y + lm[263].y) / 2;
  const ordered = eyeY < lm[1].y && lm[1].y < lm[13].y && lm[13].y < lm[152].y;
  const centred = lm[1].x > Math.min(lm[33].x, lm[263].x) && lm[1].x < Math.max(lm[33].x, lm[263].x);
  if (!ordered || !centred) return 'landmarks not face-shaped';
  return null;
}

const faceWidth = (lm: Pt[]) => Math.hypot(lm[454].x - lm[234].x, lm[454].y - lm[234].y);

type Landmarks = Pt[] & { yaw?: number };

/** Head turn from the model's 3D pose matrix: 0 = facing the camera, 1 = 90° (full profile). */
function yawFrom(res: { facialTransformationMatrixes?: { data: number[] | Float32Array }[] }): number | undefined {
  const d = res.facialTransformationMatrixes?.[0]?.data;
  if (!d || d.length < 11) return undefined;
  return Math.min(1, Math.abs(Math.atan2(d[8], d[10])) / (Math.PI / 2));
}

/** Runs the detector on a square window of the source, scaled to DETECT_SIZE; returns landmarks in source pixels. */
function detectWindow(img: CanvasImageSource, x: number, y: number, size: number): Landmarks | null {
  const c = document.createElement('canvas');
  c.width = c.height = DETECT_SIZE;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, DETECT_SIZE, DETECT_SIZE);
  ctx.drawImage(img, x, y, size, size, 0, 0, DETECT_SIZE, DETECT_SIZE);
  const res = landmarker.detect(c);
  const face = res.faceLandmarks[0];
  if (!face) return null;
  return Object.assign(face.map((p) => ({ x: x + p.x * size, y: y + p.y * size })), { yaw: yawFrom(res) });
}

/** Second pass: crop tightly around a detection and re-run, which gives much better landmarks on small faces. */
function refine(img: CanvasImageSource, lm: Pt[]): Landmarks | null {
  const xs = lm.map((p) => p.x), ys = lm.map((p) => p.y);
  const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
  const size = Math.max(bw, bh) * 2.4;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const out = detectWindow(img, cx - size / 2, cy - size / 2, size);
  if (!out || qualityProblem(out)) return null;
  const ratio = faceWidth(out) / faceWidth(lm);
  return ratio > 0.6 && ratio < 1.7 ? out : null;
}

type Located = { lm: Landmarks; how: string };

async function locateFace(img: CanvasImageSource, w: number, h: number): Promise<Located | null> {
  const fullRes = landmarker.detect(img as HTMLCanvasElement);
  const full = fullRes.faceLandmarks[0];
  if (full) {
    const lm: Landmarks = Object.assign(full.map((p) => ({ x: p.x * w, y: p.y * h })), { yaw: yawFrom(fullRes) });
    const refined = refine(img, lm);
    if (refined) return { lm: refined, how: 'refined' };
    if (!qualityProblem(lm)) return { lm, how: 'direct' };
  }
  // Nothing usable: slide square windows over the print at shrinking sizes so a small oval portrait fills the detector's view.
  const longest = Math.max(w, h), shortest = Math.min(w, h);
  for (const frac of [0.5, 0.33, 0.22]) {
    const size = Math.min(longest * frac, shortest);
    const step = size / 2;
    let best: Landmarks | null = null;
    for (let y = 0; ; y += step) {
      const yy = Math.min(y, Math.max(0, h - size));
      for (let x = 0; ; x += step) {
        const xx = Math.min(x, Math.max(0, w - size));
        let lm = detectWindow(img, xx, yy, size);
        if (lm) {
          lm = refine(img, lm) ?? lm;
          if (!qualityProblem(lm) && (!best || faceWidth(lm) > faceWidth(best))) best = lm;
        }
        if (xx >= w - size) break;
      }
      if (yy >= h - size) break;
      await new Promise((r) => setTimeout(r));
    }
    if (best) return { lm: best, how: 'tiled' };
  }
  return null;
}

/** Face landmarks are the slow part, so they are remembered per source (including "no face here") and reused on re-cuts. */
async function locateOrRecall(entry: Entry, img: CanvasImageSource, w: number, h: number): Promise<Located | null> {
  const c = entry.meta.landmarks;
  if (c && c.w === w && c.h === h) {
    if (c.none || !c.lm) return null;
    const pts: Pt[] = [];
    for (let i = 0; i < c.lm.length; i += 2) pts.push({ x: c.lm[i], y: c.lm[i + 1] });
    return { lm: Object.assign(pts, { yaw: c.yaw }), how: `${c.how ?? 'found'} (cached)` };
  }
  const found = await locateFace(img, w, h);
  const data: CachedLandmarks = found
    ? { w, h, yaw: found.lm.yaw, how: found.how, lm: found.lm.flatMap((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]) }
    : { w, h, none: true };
  entry.meta.landmarks = data;
  fetch('/api/landmarks', { method: 'POST', body: JSON.stringify({ pack: PACK, era: entry.meta.era, objectId: entry.meta.objectId, data }) }).catch(() => {});
  return found;
}

async function process(entry: Entry) {
  const { img, w, h } = await loadImage(entry.meta.image);
  const thumb = document.createElement('canvas');
  const found = await locateOrRecall(entry, img, w, h);
  if (!found) { drawOverlay(thumb, img, w, h); entry.done = true; renderCard(entry, thumb); return; }
  drawOverlay(thumb, img, w, h, found.lm);
  entry.how = found.how;
  cutFace(img, found.lm, entry);
  entry.done = true;
  renderCard(entry, thumb);
}

async function run() {
  const era = eraSel.value;
  const todo = entries.filter((e) => !e.done && (era === 'all' || e.meta.era === era));
  let i = 0;
  for (const e of todo) {
    statusEl.textContent = `cutting ${++i}/${todo.length}…`;
    try { await process(e); } catch (err) { console.error(err); renderCard(e, null, 'error: ' + err); }
    await new Promise((r) => setTimeout(r));
  }
  const total = entries.reduce((s, e) => s + e.parts.length, 0);
  statusEl.textContent = `done · ${total} parts from ${entries.filter((e) => e.parts.length).length} faces`;
}

async function save() {
  const chosen = entries.filter((e) => e.parts.length && e.gender !== 'skip');
  const unset = chosen.filter((e) => e.gender === 'unset');
  if (unset.length) { statusEl.textContent = `${unset.length} faces still need a gender (or skip)`; unset[0].card?.scrollIntoView({ block: 'center' }); return; }
  const parts = chosen.flatMap((e) => e.parts.filter((p) => !p.rejected).map((p) => ({
    id: p.id, slot: p.slot, era: e.meta.era, gender: e.gender, genderSource: e.genderSource, yaw: e.yaw, faceAspect: e.faceAspect, eyeSep: e.eyeSep, file: `${e.meta.era}/${p.slot}/${p.id}.png`,
    width: p.canvas.width, height: p.canvas.height, anchor: p.anchor, headRatio: p.headRatio, offset: p.offset, license: e.meta.license,
    source: { provider: e.meta.provider, objectId: e.meta.objectId, url: e.meta.url, title: e.meta.title, artist: e.meta.artist, date: e.meta.date, credit: e.meta.credit },
    png: p.canvas.toDataURL('image/png').split(',')[1],
  })));
  const sources = chosen.map((e) => ({ era: e.meta.era, objectId: e.meta.objectId }));
  const res = await fetch('/api/save', { method: 'POST', body: JSON.stringify({ pack: PACK, sources, parts, slots: onlySlots ? [...onlySlots] : undefined }) });
  const out = await res.json();
  statusEl.textContent = `saved ${out.saved} parts (manifest now has ${out.total})`;
}

async function init() {
  const fileset = await FilesetResolver.forVisionTasks('/wasm');
  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'CPU' },
    runningMode: 'IMAGE', numFaces: 1, minFaceDetectionConfidence: 0.2, minFacePresenceConfidence: 0.2,
    outputFacialTransformationMatrixes: true,
  });
  segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/hair_segmenter.tflite', delegate: 'CPU' },
    runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true,
  });
  const metas: SourceMeta[] = await (await fetch(`/api/sources?pack=${PACK}`)).json();
  entries = metas.map((meta) => ({ meta, gender: meta.genderGuess ?? 'unset', genderSource: meta.genderGuess ? (meta.provider === 'wikimedia' ? 'category' : 'guess') : 'default', parts: [], done: false }));
  const eras = [...new Set(metas.map((m) => m.era))];
  for (const v of ['all', ...eras]) eraSel.add(new Option(v, v));
  statusEl.textContent = `${metas.length} source portraits ready`;
  $('run').onclick = run;
  $('save').onclick = save;
  $('allm').onclick = () => {
    const v = prompt('Set every unset face to (masc / femme / andro / skip):');
    if (!v || !['masc', 'femme', 'andro', 'skip'].includes(v)) return;
    for (const e of entries) if (e.gender === 'unset') { e.gender = v as Entry['gender']; if (e.done) renderCard(e, e.card!.querySelector('canvas')); }
  };
  (window as any).__cutter = {
    run, save, entries: () => entries,
    setOnly: (slots: string[] | null) => { onlySlots = slots?.length ? new Set(slots as Slot[]) : null; },
    /** free memory between chunks: forget saved parts and their cards, but keep the "done" flags */
    reset: () => { main.innerHTML = ''; for (const e of entries) { e.parts = []; e.card = undefined; } },
  };
}
init().catch((e) => { statusEl.textContent = 'init failed: ' + e; console.error(e); });
