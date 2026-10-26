import * as THREE from 'three';
import { HEAD_FRACTION } from '@face-maker/face-core';

/**
 * Faceted PS1-style heads. A head is a stack of low-sided rings (a "loft") from chin to crown,
 * plus a wedge nose, flap ears and a neck, about 150-200 triangles in all.
 * The proportions are original, but the silhouettes follow what makes period game heads read as PS1:
 * hexagonal front view, flat painted face plane, jutting brow and nose, boxy skull, flat back.
 */

export interface Ring {
  /** 0 = chin, 1 = crown */
  t: number;
  /** half width */
  hw: number;
  /** how far the front surface is in front of the head's centre line */
  zf: number;
  /** how far the back surface is behind it */
  zb: number;
}

export interface HeadPreset {
  id: string;
  label: string;
  /** sides per ring; 8 reads as chunky, 10 as rounder */
  sides: number;
  height: number;
  rings: Ring[];
  /** rings at or above this t are "hair" (flat back-colour), below it the face texture is used */
  hairlineT: number;
  nose: { size: number; y: number; width: number };
  ear: { size: number; t: number };
  neck: { rx: number; rz: number };
}

export const PRESETS: HeadPreset[] = [
  {
    id: 'fighter', label: 'Square jaw', sides: 8, height: 1.3, hairlineT: 0.93,
    rings: [
      { t: 0, hw: 0.2, zf: 0.16, zb: 0.22 }, { t: 0.12, hw: 0.33, zf: 0.27, zb: 0.3 }, { t: 0.3, hw: 0.45, zf: 0.36, zb: 0.4 },
      { t: 0.5, hw: 0.5, zf: 0.4, zb: 0.46 }, { t: 0.66, hw: 0.5, zf: 0.44, zb: 0.48 }, { t: 0.82, hw: 0.48, zf: 0.38, zb: 0.48 },
      { t: 0.94, hw: 0.4, zf: 0.3, zb: 0.42 }, { t: 1, hw: 0.28, zf: 0.2, zb: 0.3 },
    ],
    nose: { size: 1, y: 0.42, width: 0.075 }, ear: { size: 1, t: 0.56 }, neck: { rx: 0.25, rz: 0.22 },
  },
  {
    id: 'heroine', label: 'Pointed chin', sides: 8, height: 1.25, hairlineT: 0.9,
    rings: [
      { t: 0, hw: 0.07, zf: 0.1, zb: 0.16 }, { t: 0.12, hw: 0.2, zf: 0.22, zb: 0.26 }, { t: 0.3, hw: 0.38, zf: 0.32, zb: 0.38 },
      { t: 0.5, hw: 0.46, zf: 0.37, zb: 0.44 }, { t: 0.66, hw: 0.48, zf: 0.38, zb: 0.46 }, { t: 0.82, hw: 0.46, zf: 0.34, zb: 0.46 },
      { t: 0.94, hw: 0.38, zf: 0.26, zb: 0.4 }, { t: 1, hw: 0.26, zf: 0.18, zb: 0.28 },
    ],
    nose: { size: 0.6, y: 0.43, width: 0.05 }, ear: { size: 0.8, t: 0.54 }, neck: { rx: 0.17, rz: 0.15 },
  },
  {
    id: 'captain', label: 'Tall boxy', sides: 8, height: 1.4, hairlineT: 0.9,
    rings: [
      { t: 0, hw: 0.12, zf: 0.14, zb: 0.2 }, { t: 0.14, hw: 0.28, zf: 0.26, zb: 0.34 }, { t: 0.32, hw: 0.4, zf: 0.32, zb: 0.42 },
      { t: 0.5, hw: 0.46, zf: 0.34, zb: 0.46 }, { t: 0.66, hw: 0.47, zf: 0.37, zb: 0.47 }, { t: 0.82, hw: 0.47, zf: 0.34, zb: 0.47 },
      { t: 0.94, hw: 0.45, zf: 0.3, zb: 0.46 }, { t: 1, hw: 0.36, zf: 0.24, zb: 0.4 },
    ],
    nose: { size: 0.85, y: 0.43, width: 0.065 }, ear: { size: 1.1, t: 0.55 }, neck: { rx: 0.2, rz: 0.18 },
  },
  {
    id: 'blocky', label: 'Chunky', sides: 6, height: 1.1, hairlineT: 0.88,
    rings: [
      { t: 0, hw: 0.26, zf: 0.22, zb: 0.24 }, { t: 0.35, hw: 0.46, zf: 0.38, zb: 0.4 }, { t: 0.65, hw: 0.5, zf: 0.42, zb: 0.44 },
      { t: 0.88, hw: 0.46, zf: 0.36, zb: 0.42 }, { t: 1, hw: 0.34, zf: 0.26, zb: 0.32 },
    ],
    nose: { size: 0.8, y: 0.42, width: 0.08 }, ear: { size: 0.9, t: 0.55 }, neck: { rx: 0.24, rz: 0.22 },
  },
  {
    id: 'round', label: 'Rounder', sides: 10, height: 1.2, hairlineT: 0.9,
    rings: [
      { t: 0, hw: 0.14, zf: 0.14, zb: 0.18 }, { t: 0.14, hw: 0.3, zf: 0.28, zb: 0.3 }, { t: 0.34, hw: 0.44, zf: 0.38, zb: 0.4 },
      { t: 0.56, hw: 0.5, zf: 0.42, zb: 0.46 }, { t: 0.76, hw: 0.49, zf: 0.4, zb: 0.47 }, { t: 0.92, hw: 0.4, zf: 0.3, zb: 0.4 },
      { t: 1, hw: 0.2, zf: 0.14, zb: 0.2 },
    ],
    nose: { size: 0.9, y: 0.44, width: 0.07 }, ear: { size: 1, t: 0.56 }, neck: { rx: 0.22, rz: 0.2 },
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

export interface HeadShape {
  preset: string;
  /** multiplies width (1 = preset) */
  width: number;
  /** multiplies height (1 = preset) */
  height: number;
  /** 0..1, 0.5 = preset; lower = heavier jaw, higher = narrower chin */
  jaw: number;
  /** multiplies the nose size (1 = preset) */
  nose: number;
}

export const NECK_LENGTH = 0.2;
/** Doc-space to world mapping: how many head-widths of the face texture the head's width spans. */
const TEX_SPAN = 1.12;
const FACE_CENTRE_T = 0.52;

export interface HeadBuild {
  geometry: THREE.BufferGeometry;
  centreY: number;
  headTop: number;
  /** the skull rings (chin to crown) in head space, so hair and hats can be fitted to them */
  rings: { t: number; pts: THREE.Vector3[] }[];
  sides: number;
  /** angle of ring vertex 0 from straight ahead; vertices run clockwise seen from above */
  phase: number;
  hairlineT: number;
  yOf: (t: number) => number;
  /** full head width */
  width: number;
}

export function buildHead(shape: HeadShape, texSize: number): HeadBuild {
  const preset = presetById(shape.preset);
  const N = preset.sides;
  const phase = Math.PI / N; // puts a flat facet (not a ridge) at the front and back
  const norm = Math.cos(phase);
  const H = preset.height * shape.height;
  const jawK = (0.5 - shape.jaw) * 0.7; // + = wider jaw, - = narrower
  const yOf = (t: number) => NECK_LENGTH + t * H;

  // ring vertices, chin to crown
  const rings = preset.rings.map((r) => {
    const lower = Math.max(0, 1 - r.t / 0.5); // jaw slider only affects the lower half
    const jaw = 1 + jawK * lower;
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j < N; j++) {
      const a = phase + (2 * Math.PI * j) / N; // 0 = front (+z), clockwise seen from above
      const s = Math.sin(a) / norm, c = Math.cos(a) / norm;
      pts.push(new THREE.Vector3(s * r.hw * shape.width * jaw, yOf(r.t), c * (c >= 0 ? r.zf : r.zb) * jaw));
    }
    return { r, pts };
  });

  const widest = Math.max(...preset.rings.map((r) => r.hw)) * shape.width * 2;
  const k = (TEX_SPAN * HEAD_FRACTION) / widest;
  const yRef = yOf(FACE_CENTRE_T);
  const texel = (px: number) => px / texSize;
  const backUV: [number, number] = [texel(2), 1 - texel(2)];
  const skinUV: [number, number] = [texel(6), 1 - texel(2)];
  const faceUV = (v: THREE.Vector3): [number, number] => [0.5 + v.x * k, 0.48 + (v.y - yRef) * k];

  const pos: number[] = [];
  const uv: number[] = [];
  const centre = new THREE.Vector3(0, yOf(0.5), 0);

  type Kind = 'face' | 'hair' | 'skin';
  /** adds a triangle, flipped if needed so it faces away from `ref`; `kind` decides which texels it samples */
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, kind: Kind, ref: THREE.Vector3, doubleSided = false) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const mid = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    const flip = n.dot(mid.sub(ref)) < 0;
    const emit = (p: THREE.Vector3[]) => {
      for (const v of p) {
        pos.push(v.x, v.y, v.z);
        const t = kind === 'face' ? faceUV(v) : kind === 'hair' ? backUV : skinUV;
        uv.push(t[0], t[1]);
      }
    };
    emit(flip ? [a, c, b] : [a, b, c]);
    if (doubleSided) emit(flip ? [a, b, c] : [a, c, b]);
  };

  // skull: quads between neighbouring rings
  for (let i = 0; i < rings.length - 1; i++) {
    const lo = rings[i], hi = rings[i + 1];
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = lo.pts[j], b = lo.pts[j2], c = hi.pts[j], d = hi.pts[j2];
      const mid = (a.z + b.z + c.z + d.z) / 4;
      const front = mid > 0.02 && hi.r.t <= preset.hairlineT;
      const kind: Kind = front ? 'face' : mid > 0.02 ? 'hair' : hi.r.t > 0.5 ? 'hair' : 'skin';
      tri(a, b, c, kind, centre);
      tri(b, d, c, kind, centre);
    }
  }
  // crown and chin caps
  const top = rings[rings.length - 1], chin = rings[0];
  const topC = new THREE.Vector3(0, top.pts[0].y, 0), chinC = new THREE.Vector3(0, chin.pts[0].y, 0);
  for (let j = 0; j < N; j++) {
    tri(topC, top.pts[j], top.pts[(j + 1) % N], 'hair', centre);
    tri(chinC, chin.pts[j], chin.pts[(j + 1) % N], 'skin', centre);
  }

  // neck: a short 8-sided tube under the chin
  const nr = preset.neck, ny0 = 0, ny1 = yOf(0.02);
  const neckTop: THREE.Vector3[] = [], neckBot: THREE.Vector3[] = [];
  for (let j = 0; j < 8; j++) {
    const a = (2 * Math.PI * j) / 8;
    neckTop.push(new THREE.Vector3(Math.sin(a) * nr.rx, ny1, Math.cos(a) * nr.rz - 0.02));
    neckBot.push(new THREE.Vector3(Math.sin(a) * nr.rx * 1.15, ny0, Math.cos(a) * nr.rz * 1.15 - 0.02));
  }
  const neckAxis = new THREE.Vector3(0, 0, -0.02);
  for (let j = 0; j < 8; j++) {
    const j2 = (j + 1) % 8;
    const ref = new THREE.Vector3(neckAxis.x, (ny0 + ny1) / 2, neckAxis.z);
    tri(neckBot[j], neckBot[j2], neckTop[j], 'skin', ref);
    tri(neckBot[j2], neckTop[j2], neckTop[j], 'skin', ref);
  }

  // nose: a three-sided wedge standing off the front of the face
  const frontRing = (t: number) => {
    // front surface depth at height t, from the preset's rings
    const rs = preset.rings;
    let i = 0;
    while (i < rs.length - 2 && rs[i + 1].t < t) i++;
    const f = (t - rs[i].t) / (rs[i + 1].t - rs[i].t);
    return rs[i].zf + (rs[i + 1].zf - rs[i].zf) * Math.min(1, Math.max(0, f));
  };
  const ns = preset.nose.size * shape.nose;
  if (ns > 0.05) {
    const tTip = preset.nose.y, tBridge = tTip + 0.13, tBase = tTip - 0.02;
    const w = preset.nose.width * shape.width;
    const bridge = new THREE.Vector3(0, yOf(tBridge), frontRing(tBridge) + 0.015);
    const tip = new THREE.Vector3(0, yOf(tTip), frontRing(tTip) + 0.05 + 0.13 * ns);
    const left = new THREE.Vector3(-w, yOf(tBase), frontRing(tBase) + 0.02);
    const right = new THREE.Vector3(w, yOf(tBase), frontRing(tBase) + 0.02);
    const ref = new THREE.Vector3(0, yOf(tTip) - 0.05, frontRing(tTip) - 0.15);
    tri(bridge, left, tip, 'face', ref);
    tri(bridge, tip, right, 'face', ref);
    tri(left, right, tip, 'face', ref);
  }

  // ears: a flat flap on each side, skin coloured
  const earT = preset.ear.t, es = preset.ear.size;
  const earRing = rings.find((r) => r.r.t >= earT) ?? rings[Math.floor(rings.length / 2)];
  const eh = 0.15 * es * (H / 1.25), ey = yOf(earT);
  for (const sgn of [-1, 1]) {
    const xs = earRing.r.hw * shape.width * 0.99 * sgn;
    const zc = -0.03;
    const a = new THREE.Vector3(xs, ey + eh, zc + 0.05);
    const b = new THREE.Vector3(xs + 0.07 * es * sgn, ey + eh * 0.7, zc - 0.03);
    const c = new THREE.Vector3(xs + 0.06 * es * sgn, ey - eh * 0.7, zc - 0.04);
    const d = new THREE.Vector3(xs, ey - eh, zc + 0.05);
    tri(a, b, c, 'skin', centre, true);
    tri(a, c, d, 'skin', centre, true);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals(); // non-indexed, so every triangle gets its own flat normal
  return {
    geometry, centreY: yOf(0.5), headTop: yOf(1),
    rings: rings.map((r) => ({ t: r.r.t, pts: r.pts })), sides: N, phase, hairlineT: preset.hairlineT, yOf, width: widest,
  };
}
