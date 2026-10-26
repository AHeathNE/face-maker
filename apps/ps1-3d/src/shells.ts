import * as THREE from 'three';
import type { HeadBuild } from './head.ts';

/**
 * Hair and hats as separate low-poly shells that sit over the head, like the originals did.
 * Both are fitted to whichever head type is active by lofting over its rings.
 * UVs point into a tiny palette texture (see hairTexture / hatTexture), not the face texture.
 */

type Ring = { t: number; pts: THREE.Vector3[] };

// ---------- tiny mesh builder ----------
class Soup {
  pos: number[] = [];
  uv: number[] = [];
  constructor(private centre: THREE.Vector3) {}
  /** triangle with explicit UVs; flipped to face away from `centre` unless doubleSided, which emits both windings */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: number[], ub: number[], uc: number[], doubleSided = false, ref = this.centre) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const mid = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    const flip = n.dot(mid.sub(ref)) < 0;
    const emit = (v: THREE.Vector3[], u: number[][]) => v.forEach((p, i) => { this.pos.push(p.x, p.y, p.z); this.uv.push(u[i][0], u[i][1]); });
    emit(flip ? [a, c, b] : [a, b, c], flip ? [ua, uc, ub] : [ua, ub, uc]);
    if (doubleSided) emit(flip ? [a, b, c] : [a, c, b], flip ? [ua, ub, uc] : [ua, uc, ub]);
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ua: number[], ub: number[], uc: number[], ud: number[], doubleSided = false, ref?: THREE.Vector3) {
    this.tri(a, b, c, ua, ub, uc, doubleSided, ref);
    this.tri(b, d, c, ub, ud, uc, doubleSided, ref);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

const centreOf = (h: HeadBuild) => new THREE.Vector3(0, h.yOf(0.5), 0);

/** scale a ring away from the vertical axis, optionally moving it up/down */
function grow(r: Ring, sx: number, sz = sx, dy = 0): Ring {
  return { t: r.t, pts: r.pts.map((p) => new THREE.Vector3(p.x * sx, p.y + dy, p.z * sz)) };
}

/** insert a midway ring between every pair so edges can sit at half-steps */
function subdivide(rings: Ring[]): Ring[] {
  const out: Ring[] = [];
  for (let i = 0; i < rings.length; i++) {
    out.push(rings[i]);
    if (i < rings.length - 1) {
      const a = rings[i], b = rings[i + 1];
      out.push({ t: (a.t + b.t) / 2, pts: a.pts.map((p, j) => p.clone().lerp(b.pts[j], 0.5)) });
    }
  }
  return out;
}

const colCos = (h: HeadBuild, j: number) => Math.cos(h.phase + (2 * Math.PI * j) / h.sides);

// ---------- hair ----------
export interface HairStyle {
  id: string;
  label: string;
  /** lowest t the hair reaches at the front, front-side, back-side and back columns (negative = below the chin) */
  edge: { front: number; fs: number; bs: number; back: number };
  /** how far the shell stands off the skull, in head widths */
  thick: number;
  /** 0..1 how far the side and back hair swings out toward the widest part of the head as it falls */
  flare?: number;
  spikes?: boolean;
}

export const HAIR_STYLES: HairStyle[] = [
  { id: 'crop', label: 'Short crop', edge: { front: 0.8, fs: 0.62, bs: 0.52, back: 0.42 }, thick: 0.05 },
  { id: 'bob', label: 'Bob', edge: { front: 0.78, fs: 0.4, bs: 0.1, back: 0.06 }, thick: 0.08, flare: 0.6 },
  { id: 'long', label: 'Long', edge: { front: 0.78, fs: 0.3, bs: -0.1, back: -0.2 }, thick: 0.08, flare: 0.95 },
  { id: 'spiky', label: 'Spiky', edge: { front: 0.84, fs: 0.68, bs: 0.6, back: 0.5 }, thick: 0.06, spikes: true },
];
export const hairById = (id: string) => HAIR_STYLES.find((s) => s.id === id);

export function buildHair(head: HeadBuild, style: HairStyle): THREE.BufferGeometry {
  const N = head.sides;
  // two extra rings below the chin, used by long hair that falls past the jaw to the shoulders
  const base = head.rings;
  const low = base[1] ?? base[0];
  const tail = [-0.2, -0.08].map((t) => ({ t, pts: low.pts.map((p) => new THREE.Vector3(p.x * 1.15, head.yOf(t), p.z * 1.05)) }));
  const rings = subdivide([...tail, ...base]);
  const w = head.width;
  const widest = Math.max(...base.flatMap((r) => r.pts.map((q) => Math.abs(q.x))));
  const g = rings.map((r) => {
    const maxX = Math.max(0.08, ...r.pts.map((q) => Math.abs(q.x)));
    const f = (style.flare ?? 0) * (1 - Math.min(1, Math.max(0, r.t / 0.6)));
    return {
      t: r.t,
      pts: r.pts.map((q, j) => {
        const swing = colCos(head, j) < 0.3 ? 1 + f * ((widest * 0.95) / maxX - 1) : 1;
        return new THREE.Vector3(q.x * (1 + style.thick) * swing, q.y, q.z * (1 + style.thick));
      }),
    } as Ring;
  });
  // hair stands up a little at the crown
  const topIdx = g.length - 1;
  g[topIdx] = grow(rings[topIdx], 1 + style.thick, 1 + style.thick, w * 0.04);

  const bottomT = (j: number) => {
    const c = colCos(head, j);
    return c > 0.75 ? style.edge.front : c > 0 ? style.edge.fs : c > -0.75 ? style.edge.bs : style.edge.back;
  };
  const bottom = Array.from({ length: N }, (_, j) => {
    const t = bottomT(j);
    const idx = g.findIndex((r) => r.t >= t - 1e-6);
    return idx < 0 ? 0 : idx;
  });

  const soup = new Soup(centreOf(head));
  for (let i = 0; i < g.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      if (i < Math.max(bottom[j], bottom[j2])) continue;
      const v0 = (g[i].t - g[0].t) / (g[topIdx].t - g[0].t), v1 = (g[i + 1].t - g[0].t) / (g[topIdx].t - g[0].t);
      const u0 = j / N, u1 = (j + 1) / N;
      soup.quad(g[i].pts[j], g[i].pts[j2], g[i + 1].pts[j], g[i + 1].pts[j2], [u0, v0], [u1, v0], [u0, v1], [u1, v1]);
    }
  }
  // crown
  const top = g[topIdx];
  const topC = new THREE.Vector3(0, top.pts[0].y + w * 0.02, 0);
  for (let j = 0; j < N; j++) soup.tri(topC, top.pts[j], top.pts[(j + 1) % N], [j / N, 1], [j / N, 1], [(j + 1) / N, 1]);

  if (style.spikes) {
    const hi = g.length - 3; // a ring below the crown
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = g[hi].pts[j], b = g[hi].pts[j2];
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const out = new THREE.Vector3(mid.x, 0, mid.z).normalize();
      const apex = mid.clone().addScaledVector(out, w * 0.16).add(new THREE.Vector3(0, w * 0.32, 0));
      soup.tri(a, b, apex, [j / N, 0.7], [(j + 1) / N, 0.7], [(j + 0.5) / N, 1], true);
    }
  }
  return soup.geometry();
}

// ---------- hats ----------
export interface HatStyle { id: string; label: string }
export const HAT_STYLES: HatStyle[] = [
  { id: 'cap', label: 'Peaked cap' },
  { id: 'beanie', label: 'Beanie' },
  { id: 'brim', label: 'Brimmed hat' },
  { id: 'headband', label: 'Headband' },
];
export const hatById = (id: string) => HAT_STYLES.find((s) => s.id === id);

const MAIN_V = 0.8; // texel rows: top = hat colour, bottom = darker band
const BAND_V = 0.12;

export function buildHat(head: HeadBuild, id: string): THREE.BufferGeometry | null {
  const N = head.sides, w = head.width;
  const rings = subdivide(head.rings);
  const fromT = id === 'beanie' ? 0.68 : id === 'headband' ? 0.74 : 0.68;
  const toT = id === 'headband' ? 0.84 : 1;
  const sel = rings.filter((r) => r.t >= fromT - 1e-6 && r.t <= toT + 1e-6);
  if (sel.length < 2) return null;
  const soup = new Soup(centreOf(head));
  const s = id === 'beanie' ? 1.1 : id === 'headband' ? 1.04 : 1.08;
  const shell = sel.map((r, i) => grow(r, s, s, i === sel.length - 1 && id !== 'headband' ? w * 0.01 : 0));
  // flat-topped caps overhang a little at the crown
  if (id === 'cap') shell[shell.length - 1] = grow(sel[sel.length - 1], 1.16, 1.16, w * 0.01);
  if (id === 'brim') shell[shell.length - 1] = grow(sel[sel.length - 1], 0.88, 0.88, w * 0.02);

  for (let i = 0; i < shell.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const band = i === 0 && id !== 'headband'; // lowest strip uses the band colour
      const v0 = band ? BAND_V : MAIN_V, v1 = v0;
      soup.quad(shell[i].pts[j], shell[i].pts[j2], shell[i + 1].pts[j], shell[i + 1].pts[j2], [j / N, v0], [(j + 1) / N, v0], [j / N, v1], [(j + 1) / N, v1], id === 'headband');
    }
  }
  if (id !== 'headband') {
    const top = shell[shell.length - 1];
    const c = new THREE.Vector3(0, top.pts[0].y + (id === 'beanie' ? w * 0.05 : 0), 0);
    for (let j = 0; j < N; j++) soup.tri(c, top.pts[j], top.pts[(j + 1) % N], [0.5, MAIN_V], [0.5, MAIN_V], [0.5, MAIN_V]);
  }

  const bottom = shell[0];
  if (id === 'cap') {
    // visor: a slanted plate across the front, in the band colour
    for (let j = 0; j < N; j++) {
      if (colCos(head, j) < 0.75) continue;
      const j2 = (j + 1) % N;
      if (colCos(head, j2) < 0.75) continue;
      const a = bottom.pts[j], b = bottom.pts[j2];
      const fa = new THREE.Vector3(a.x * 1.2, a.y - w * 0.05, a.z + w * 0.34), fb = new THREE.Vector3(b.x * 1.2, b.y - w * 0.05, b.z + w * 0.34);
      soup.quad(a, b, fa, fb, [0.2, BAND_V], [0.8, BAND_V], [0.2, BAND_V], [0.8, BAND_V], true);
    }
  }
  if (id === 'brim') {
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = bottom.pts[j], b = bottom.pts[j2];
      const fa = new THREE.Vector3(a.x * 1.7, a.y - w * 0.02, a.z * 1.6), fb = new THREE.Vector3(b.x * 1.7, b.y - w * 0.02, b.z * 1.6);
      soup.quad(a, b, fa, fb, [j / N, BAND_V], [(j + 1) / N, BAND_V], [j / N, BAND_V], [(j + 1) / N, BAND_V], true);
    }
  }
  if (id === 'headband') {
    // two tails hanging off the back
    const mid = shell[Math.floor(shell.length / 2)];
    for (let j = 0; j < N; j++) {
      if (colCos(head, j) > -0.75) continue;
      const j2 = (j + 1) % N;
      const a = mid.pts[j], b = mid.pts[j2];
      const tip = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, -w * 0.9, -w * 0.18));
      soup.tri(a, b, tip, [0.3, MAIN_V], [0.7, MAIN_V], [0.5, MAIN_V], true);
    }
  }
  return soup.geometry();
}

// ---------- palette textures ----------
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function shade(hex: string, f: number) {
  const c = new THREE.Color(hex);
  return `rgb(${Math.round(Math.min(1, c.r * f) * 255)},${Math.round(Math.min(1, c.g * f) * 255)},${Math.round(Math.min(1, c.b * f) * 255)})`;
}

/** 32×32 hair: vertical strands in light and dark streaks, with a soft highlight band near the top. */
export function hairTexture(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  for (let x = 0; x < 32; x++) {
    const streak = 0.72 + hash(x) * 0.5 + (x % 6 === 0 ? 0.25 : 0);
    for (let y = 0; y < 32; y++) {
      const vFromTop = y / 31; // canvas top is v = 1, the crown
      const highlight = Math.exp(-Math.pow((vFromTop - 0.28) / 0.1, 2)) * 0.28;
      const grain = 0.92 + hash(x * 31 + y) * 0.16;
      ctx.fillStyle = shade(color, Math.max(0.25, streak * grain + highlight));
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/** 8×8 hat: the top rows are the hat colour, the bottom rows are a darker band. */
export function hatTexture(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const base = y >= 6 ? 0.5 : 1;
      ctx.fillStyle = shade(color, base * (0.95 + hash(x * 9 + y) * 0.1));
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}
