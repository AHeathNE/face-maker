import * as THREE from 'three';

/** A horizontal slice of a body part: an ellipse of radii (rx, rz) centred on (cx, cz) at height y. */
export interface Section { y: number; rx: number; rz: number; cx?: number; cz?: number }

/** A rectangle of the texture atlas (UV space, v points up), which one body part samples. */
export interface Cell { u0: number; v0: number; u1: number; v1: number }

/**
 * Atlas of 4x4 small cells. Each body part gets one cell; its u runs around the part and its v runs from the bottom
 * of the part (low v) to the top, so clothing is painted once per part and wraps around it.
 */
export const ATLAS_CELLS = 4;
export function cellAt(col: number, row: number): Cell {
  const e = 0.5 / (ATLAS_CELLS * 32); // half a texel in, so neighbouring cells do not bleed
  return {
    u0: col / ATLAS_CELLS + e, u1: (col + 1) / ATLAS_CELLS - e,
    v1: 1 - row / ATLAS_CELLS - e, v0: 1 - (row + 1) / ATLAS_CELLS + e,
  };
}

/** Collects triangles with flat normals. Triangles are flipped to face away from a reference point. */
export class Mesher {
  pos: number[] = [];
  uv: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: number[], ub: number[], uc: number[], ref: THREE.Vector3, doubleSided = false) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const mid = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    const flip = n.dot(mid.sub(ref)) < 0;
    const emit = (v: THREE.Vector3[], u: number[][]) => v.forEach((p, i) => { this.pos.push(p.x, p.y, p.z); this.uv.push(u[i][0], u[i][1]); });
    emit(flip ? [a, c, b] : [a, b, c], flip ? [ua, uc, ub] : [ua, ub, uc]);
    if (doubleSided) emit(flip ? [a, b, c] : [a, c, b], flip ? [ua, ub, uc] : [ua, uc, ub]);
  }
  geometry(offset?: THREE.Vector3) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (offset) g.translate(offset.x, offset.y, offset.z);
    g.computeVertexNormals();
    return g;
  }
}

export interface TubeOptions {
  sides: number;
  cell: Cell;
  /** close the top / bottom with a flat cap (a cap has no sideways detail, it samples the middle of the cell) */
  capTop?: boolean;
  capBottom?: boolean;
  /** show both faces, for open shells such as a skirt */
  doubleSided?: boolean;
  /** use only this slice of the cell's height, as fractions of it (0 = bottom, 1 = top): lets a small joint cap sample just the cloth near the top of a limb's texture */
  vSpan?: [number, number];
}

/**
 * A low-poly tube lofted through sections that run top to bottom or bottom to top. The sides are rotated half a step so the front
 * is a flat facet, and u = 0.5 is the middle of that facet, where the painted front details go.
 */
export function tube(m: Mesher, sections: Section[], o: TubeOptions) {
  const N = o.sides, phase = Math.PI / N, norm = Math.cos(phase);
  const ys = sections.map((s) => s.y);
  const top = Math.max(...ys), bottom = Math.min(...ys);
  const [vA, vB] = o.vSpan ?? [0, 1];
  const vOf = (y: number) => o.cell.v0 + (vA + ((y - bottom) / Math.max(1e-6, top - bottom)) * (vB - vA)) * (o.cell.v1 - o.cell.v0);
  // Vertices sit half a step either side of the front, so the flat front facet spans u = 0.5 -/+ 0.5/N and its middle is exactly
  // u = 0.5 (and the middle of each side is u = 0.25 and 0.75). The wrap-around quad at the back ends at u = 1.
  const uOf = (j: number) => o.cell.u0 + Math.min(1, (j + 0.5) / N) * (o.cell.u1 - o.cell.u0);
  const rings = sections.map((s) => Array.from({ length: N }, (_, j) => {
    const a = Math.PI + phase + (2 * Math.PI * j) / N; // 0 is the back; the front sits at a = 0 (mod 2pi), halfway round
    return new THREE.Vector3((s.cx ?? 0) + (Math.sin(a) * s.rx) / norm, s.y, (s.cz ?? 0) + (Math.cos(a) * s.rz) / norm);
  }));
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = rings[i][j], b = rings[i][j2], c = rings[i + 1][j], d = rings[i + 1][j2];
      const ref = new THREE.Vector3(((sections[i].cx ?? 0) + (sections[i + 1].cx ?? 0)) / 2, (a.y + c.y) / 2, ((sections[i].cz ?? 0) + (sections[i + 1].cz ?? 0)) / 2);
      const ua = [uOf(j), vOf(a.y)], ub = [uOf(j + 1), vOf(b.y)], uc = [uOf(j), vOf(c.y)], ud = [uOf(j + 1), vOf(d.y)];
      m.tri(a, b, c, ua, ub, uc, ref, o.doubleSided);
      m.tri(b, d, c, ub, ud, uc, ref, o.doubleSided);
    }
  }
  const capUV = [(o.cell.u0 + o.cell.u1) / 2, (o.cell.v0 + o.cell.v1) / 2];
  const cap = (ring: THREE.Vector3[], s: Section, up: boolean) => {
    const centre = new THREE.Vector3(s.cx ?? 0, s.y, s.cz ?? 0);
    const ref = centre.clone().add(new THREE.Vector3(0, up ? -1 : 1, 0));
    for (let j = 0; j < N; j++) m.tri(centre, ring[j], ring[(j + 1) % N], capUV, capUV, capUV, ref);
  };
  const last = sections.length - 1;
  if (o.capTop) cap(sections[0].y >= sections[last].y ? rings[0] : rings[last], sections[0].y >= sections[last].y ? sections[0] : sections[last], true);
  if (o.capBottom) cap(sections[0].y >= sections[last].y ? rings[last] : rings[0], sections[0].y >= sections[last].y ? sections[last] : sections[0], false);
}
