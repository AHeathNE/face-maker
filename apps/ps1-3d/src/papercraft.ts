/**
 * Paper model maker. It takes the actual meshes shown on screen (skull, neck, nose, ears, hair, hat), unfolds each into flat
 * "islands" of triangles that keep their true edge lengths, adds glue tabs and matching edge labels, lays the islands out on
 * Letter pages, and paints the same textures the 3D view uses onto them. Because it reads the live meshes and textures,
 * changing the face, hair or colours and printing again gives a different model.
 *
 * Coordinates: every length is in millimetres. Unfolding works in y-up "math" coordinates (so a triangle seen from outside the
 * model is counter-clockwise, like its texture); the y flip to the page happens once, at layout time.
 */

export type P2 = [number, number];
export type P3 = [number, number, number];

export interface PieceInput {
  id: string;
  name: string;
  /** letter used in edge labels, e.g. "S" gives S1, S2... */
  prefix: string;
  tris: { p: [P3, P3, P3]; uv: [P2, P2, P2] }[];
  texture: HTMLCanvasElement;
  /** open edges that need a glue tab: none, all of them, or only those in the upper half (the neck's top) */
  attach: 'none' | 'all' | 'top';
  /** the head texture's flat-colour corner gets engraving-style marks when hatching / speckle is on */
  flat?: { hatch: boolean; speckle: boolean; strength: number; maxU: number; minV: number };
}

export interface PaperOptions {
  /** millimetres per model unit */
  scale: number;
  tabDepth: number;
  /** longest allowed side of one flat piece */
  maxDim: number;
  bleed: number;
  pageW: number;
  pageH: number;
  margin: number;
  dpi: number;
  cardstock: boolean;
}

export interface PaperResult {
  pages: HTMLCanvasElement[];
  stats: { pieces: number; islands: number; triangles: number; tabs: number; skippedTabs: number; pages: number; heightMm: number };
  warnings: string[];
}

// ---------------------------------------------------------------- small geometry helpers
const sub3 = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a: P3) => Math.hypot(a[0], a[1], a[2]);
const dist3 = (a: P3, b: P3) => len3(sub3(a, b));
const unit3 = (a: P3): P3 => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const sub2 = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add2 = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const mul2 = (a: P2, k: number): P2 => [a[0] * k, a[1] * k];
const len2 = (a: P2) => Math.hypot(a[0], a[1]);
const unit2 = (a: P2): P2 => { const l = len2(a) || 1; return [a[0] / l, a[1] / l]; };
const cross2 = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];

/** True when two convex polygons overlap by more than eps (touching along an edge or at a corner does not count). */
function convexOverlap(A: P2[], B: P2[], eps: number): boolean {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const nx = q[1] - p[1], ny = p[0] - q[0];
      const l = Math.hypot(nx, ny);
      if (l < 1e-9) continue;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of A) { const d = (v[0] * nx + v[1] * ny) / l; if (d < minA) minA = d; if (d > maxA) maxA = d; }
      for (const v of B) { const d = (v[0] * nx + v[1] * ny) / l; if (d < minB) minB = d; if (d > maxB) maxB = d; }
      if (maxA <= minB + eps || maxB <= minA + eps) return false;
    }
  }
  return true;
}

/** Closest point on triangle abc to p, as barycentric weights (Ericson, Real-Time Collision Detection). */
function closestBary(p: P3, a: P3, b: P3, c: P3): [number, number, number] {
  const ab = sub3(b, a), ac = sub3(c, a), ap = sub3(p, a);
  const d1 = dot3(ab, ap), d2 = dot3(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub3(p, b), d3 = dot3(ab, bp), d4 = dot3(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
  const cp = sub3(p, c), d5 = dot3(ab, cp), d6 = dot3(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [1 - w, 0, w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + d5 - d6); return [0, 1 - w, w]; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return [1 - v - w, v, w];
}

// ---------------------------------------------------------------- pieces and unfolding
interface Tab { poly: P2[]; label: string; p: P2; q: P2; kind: 'seam' | 'attach' }
/** a seam label printed on the blank paper just outside a cut edge, never on the picture; `out` points away from the piece */
interface EdgeLabel { p: P2; q: P2; label: string; out: P2 }
interface Mark { a: P2; b: P2 | null; label: string }

interface Island {
  piece: Piece;
  tris: number[];
  /** 2D corners of each triangle (indexed like piece.tris), only filled for this island's triangles */
  pts: Map<number, [P2, P2, P2]>;
  joined: Set<string>;
  tabs: Tab[];
  edgeLabels: EdgeLabel[];
  marks: Mark[];
  // layout
  rot: number;
  off: P2;
  w: number;
  h: number;
  page: number;
  /** top-left of the island's box on its page, in mm */
  box: P2;
}

interface Piece {
  input: PieceInput;
  verts: P3[];
  ids: [number, number, number][];
  uv: [P2, P2, P2][];
  normals: P3[];
  /** edge key -> triangles using it, with the slot (edge i joins corner i and i+1) */
  edges: Map<string, { tri: number; slot: number }[]>;
  islands: Island[];
}

const ekey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

function weld(input: PieceInput, scale: number): Piece {
  const verts: P3[] = [];
  const index = new Map<string, number>();
  const vid = (p: P3) => {
    const s: P3 = [p[0] * scale, p[1] * scale, p[2] * scale];
    const k = `${Math.round(s[0] * 50)},${Math.round(s[1] * 50)},${Math.round(s[2] * 50)}`; // 0.02 mm grid
    let i = index.get(k);
    if (i === undefined) { i = verts.length; verts.push(s); index.set(k, i); }
    return i;
  };
  const ids: [number, number, number][] = [], uv: [P2, P2, P2][] = [], normals: P3[] = [];
  const seen = new Set<string>();
  for (const t of input.tris) {
    const tri: [number, number, number] = [vid(t.p[0]), vid(t.p[1]), vid(t.p[2])];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    const key = [...tri].sort((a, b) => a - b).join('_');
    if (seen.has(key)) continue; // double-sided shells list every triangle twice; keep the outward-facing one
    seen.add(key);
    const n = cross3(sub3(verts[tri[1]], verts[tri[0]]), sub3(verts[tri[2]], verts[tri[0]]));
    if (len3(n) < 1e-6) continue;
    ids.push(tri); uv.push(t.uv); normals.push(unit3(n));
  }
  const edges = new Map<string, { tri: number; slot: number }[]>();
  ids.forEach((tri, i) => {
    for (let s = 0; s < 3; s++) {
      const k = ekey(tri[s], tri[(s + 1) % 3]);
      const list = edges.get(k) ?? [];
      list.push({ tri: i, slot: s });
      edges.set(k, list);
    }
  });
  return { input, verts, ids, uv, normals, edges, islands: [] };
}

function dihedral(piece: Piece, a: number, b: number): number {
  return Math.acos(Math.max(-1, Math.min(1, dot3(piece.normals[a], piece.normals[b]))));
}

/** Unfold a piece into islands: grow patches triangle by triangle, flattest joins first, and start a new patch whenever the next triangle would overlap or the patch would get too big. */
function unfold(piece: Piece, maxDim: number) {
  const { ids, verts } = piece;
  const n = ids.length;
  const done = new Int8Array(n);
  const area = ids.map((t) => len3(cross3(sub3(verts[t[1]], verts[t[0]]), sub3(verts[t[2]], verts[t[0]]))) / 2);
  // Triangles that carry real picture (the face's features) are grown together first, so an eye or a mouth is not cut by a seam.
  const tex = piece.input.texture;
  const textured = piece.uv.map((uv) => {
    const a = Math.abs((uv[1][0] - uv[0][0]) * (uv[2][1] - uv[0][1]) - (uv[2][0] - uv[0][0]) * (uv[1][1] - uv[0][1])) / 2;
    return a * tex.width * tex.height > 0.4;
  });
  const anyFlat = textured.some((t) => !t) && textured.some((t) => t);

  const corner = (tri: number, id: number) => ids[tri].indexOf(id);

  while (true) {
    // seed: the biggest triangle not placed yet gives sturdier patches than a sliver
    let seed = -1;
    const score = (i: number) => area[i] + (anyFlat && textured[i] ? 1e6 : 0);
    for (let i = 0; i < n; i++) if (!done[i] && (seed < 0 || score(i) > score(seed))) seed = i;
    if (seed < 0) break;

    const t0 = ids[seed];
    const A = verts[t0[0]], B = verts[t0[1]], C = verts[t0[2]];
    const L = dist3(A, B), d = dist3(A, C), e = dist3(B, C);
    const cx = (d * d - e * e + L * L) / (2 * L), cy = Math.sqrt(Math.max(0, d * d - cx * cx));
    const island: Island = {
      piece, tris: [seed], pts: new Map([[seed, [[0, 0], [L, 0], [cx, cy]]]]), joined: new Set(), tabs: [], edgeLabels: [], marks: [],
      rot: 0, off: [0, 0], w: 0, h: 0, page: 0, box: [0, 0],
    };
    done[seed] = 1;
    let minX = Math.min(0, cx), maxX = Math.max(L, cx), minY = 0, maxY = cy;

    type Cand = { tri: number; from: number; slot: number; cost: number };
    const depth = new Map<number, number>([[seed, 0]]); // steps from the seed: the picture area grows outward evenly, like a compact patch
    const frontier: Cand[] = [];
    const pushNeighbours = (tri: number) => {
      for (let s = 0; s < 3; s++) {
        const k = ekey(ids[tri][s], ids[tri][(s + 1) % 3]);
        for (const o of piece.edges.get(k) ?? []) {
          if (o.tri !== tri && !done[o.tri]) frontier.push({ tri: o.tri, from: tri, slot: s, cost: anyFlat && textured[o.tri] && textured[tri] ? ((depth.get(tri) ?? 0) + 1) * 0.001 : dihedral(piece, tri, o.tri) + (anyFlat && !textured[o.tri] ? 3 : 0) });
        }
      }
    };
    pushNeighbours(seed);

    while (frontier.length) {
      let bi = 0;
      for (let i = 1; i < frontier.length; i++) if (frontier[i].cost < frontier[bi].cost) bi = i;
      const c = frontier.splice(bi, 1)[0];
      if (done[c.tri]) continue;

      const parent = island.pts.get(c.from)!;
      const pa = ids[c.from][c.slot], pb = ids[c.from][(c.slot + 1) % 3];
      const p2 = parent[c.slot], q2 = parent[(c.slot + 1) % 3], third2 = parent[(c.slot + 2) % 3];
      const r = ids[c.tri].find((v) => v !== pa && v !== pb)!;
      const dP = dist3(verts[pa], verts[r]), dQ = dist3(verts[pb], verts[r]), Lpq = dist3(verts[pa], verts[pb]);
      const u = unit2(sub2(q2, p2));
      let nrm: P2 = [-u[1], u[0]];
      if (cross2(sub2(q2, p2), sub2(third2, p2)) > 0) nrm = [u[1], -u[0]]; // the new corner goes on the far side of the shared edge
      const x = (dP * dP - dQ * dQ + Lpq * Lpq) / (2 * Lpq), y = Math.sqrt(Math.max(0, dP * dP - x * x));
      const rPos = add2(add2(p2, mul2(u, x)), mul2(nrm, y));
      const pos = (id: number): P2 => (id === pa ? p2 : id === pb ? q2 : rPos);
      const tri2: [P2, P2, P2] = [pos(ids[c.tri][0]), pos(ids[c.tri][1]), pos(ids[c.tri][2])];

      let ok = true;
      for (const [, other] of island.pts) if (convexOverlap(tri2, other, 0.03)) { ok = false; break; }
      if (ok) {
        const nx0 = Math.min(minX, ...tri2.map((p) => p[0])), nx1 = Math.max(maxX, ...tri2.map((p) => p[0]));
        const ny0 = Math.min(minY, ...tri2.map((p) => p[1])), ny1 = Math.max(maxY, ...tri2.map((p) => p[1]));
        if (nx1 - nx0 > maxDim || ny1 - ny0 > maxDim) ok = false;
        else { minX = nx0; maxX = nx1; minY = ny0; maxY = ny1; }
      }
      if (!ok) continue;
      island.pts.set(c.tri, tri2);
      island.tris.push(c.tri);
      island.joined.add(ekey(pa, pb));
      depth.set(c.tri, (depth.get(c.from) ?? 0) + 1);
      done[c.tri] = 1;
      pushNeighbours(c.tri);
    }
    piece.islands.push(island);
  }
  void corner;
}

// ---------------------------------------------------------------- tabs, labels, glue marks
function addTabsAndLabels(pieces: Piece[], opts: PaperOptions, warnings: string[]) {
  let tabs = 0, skipped = 0;
  const islandOf = (piece: Piece) => {
    const m = new Map<number, Island>();
    for (const isl of piece.islands) for (const t of isl.tris) m.set(t, isl);
    return m;
  };

  /** the unit direction perpendicular to edge pq that points away from the triangle's third corner */
  const outward = (p: P2, q: P2, third: P2): P2 => {
    const u = unit2(sub2(q, p));
    return cross2(sub2(q, p), sub2(third, p)) > 0 ? [u[1], -u[0]] : [-u[1], u[0]];
  };
  const trapezoid = (p: P2, q: P2, away: P2, depth: number): P2[] => {
    const u = unit2(sub2(q, p));
    const k = Math.min(depth * 0.7, len2(sub2(q, p)) * 0.3);
    return [p, q, add2(add2(q, mul2(away, depth)), mul2(u, -k)), add2(add2(p, mul2(away, depth)), mul2(u, k))];
  };
  const tryTab = (isl: Island, p: P2, q: P2, thirdPt: P2, depth: number): P2[] | null => {
    const u = unit2(sub2(q, p));
    let away: P2 = [-u[1], u[0]];
    if (cross2(sub2(q, p), sub2(thirdPt, p)) > 0) away = [u[1], -u[0]];
    const mid = mul2(add2(p, q), 0.5);
    const shapes: { poly: P2[]; ignoreTabs: boolean }[] = [];
    for (const d of [depth, depth * 0.7, depth * 0.5]) shapes.push({ poly: trapezoid(p, q, away, d), ignoreTabs: false });
    shapes.push({ poly: [p, q, add2(mid, mul2(away, depth * 0.8))], ignoreTabs: false });                // a pointed tab
    shapes.push({ poly: trapezoid(p, q, away, depth * 0.6), ignoreTabs: true });                          // may overlap another tab: trim it when cutting
    shapes.push({ poly: [p, q, add2(mid, mul2(away, depth * 0.6))], ignoreTabs: true });
    shapes.push({ poly: [p, q, add2(mid, mul2(away, depth * 0.4))], ignoreTabs: true });
    shapes.push({ poly: [add2(p, mul2(u, len2(sub2(q, p)) * 0.2)), add2(q, mul2(u, -len2(sub2(q, p)) * 0.2)), add2(mid, mul2(away, depth * 0.5))], ignoreTabs: true }); // a narrower point, for a thin wedge
    for (const s of shapes) {
      let clash = false;
      for (const [, t] of isl.pts) if (convexOverlap(s.poly, t, 0.05)) { clash = true; break; }
      if (!clash && !s.ignoreTabs) for (const o of isl.tabs) if (convexOverlap(s.poly, o.poly, 0.05)) { clash = true; break; }
      if (!clash) return s.poly;
    }
    return null;
  };

  for (const piece of pieces) {
    const where = islandOf(piece);
    let counter = 0;
    const midY = (() => { const ys = piece.verts.map((v) => v[1]); return (Math.min(...ys) + Math.max(...ys)) / 2; })();
    for (const [key, uses] of piece.edges) {
      if (uses.length === 2) {
        const [a, b] = uses;
        const ia = where.get(a.tri)!, ib = where.get(b.tri)!;
        if (ia === ib && ia.joined.has(key)) continue;       // a fold, not a seam
        if (ia !== ib && false) continue;
        const label = `${piece.input.prefix}${++counter}`;
        const info = (u: { tri: number; slot: number }, isl: Island) => {
          const pts = isl.pts.get(u.tri)!;
          return { isl, p: pts[u.slot], q: pts[(u.slot + 1) % 3], third: pts[(u.slot + 2) % 3] };
        };
        const A = info(a, ia), B = info(b, ib);
        const edgeLen = len2(sub2(A.q, A.p));
        let placed = false;
        if (edgeLen > 2.5) {
          // glue tab on whichever side has room, preferring the side of the smaller piece
          const order = ia.tris.length <= ib.tris.length ? [A, B] : [B, A];
          for (const side of order) {
            const poly = tryTab(side.isl, side.p, side.q, side.third, opts.tabDepth);
            if (poly) {
              side.isl.tabs.push({ poly, label, p: side.p, q: side.q, kind: 'seam' });
              const other = side === A ? B : A;
              other.isl.edgeLabels.push({ p: other.p, q: other.q, label, out: outward(other.p, other.q, other.third) });
              placed = true; tabs++;
              break;
            }
          }
        }
        if (!placed) {
          skipped++;
          A.isl.edgeLabels.push({ p: A.p, q: A.q, label, out: outward(A.p, A.q, A.third) });
          B.isl.edgeLabels.push({ p: B.p, q: B.q, label, out: outward(B.p, B.q, B.third) });
        }
      } else if (uses.length === 1 && piece.input.attach !== 'none') {
        const u = uses[0];
        const isl = where.get(u.tri)!;
        const pts = isl.pts.get(u.tri)!;
        const ids = piece.ids[u.tri];
        if (piece.input.attach === 'top') {
          const my = (piece.verts[ids[u.slot]][1] + piece.verts[ids[(u.slot + 1) % 3]][1]) / 2;
          if (my < midY) continue;
        }
        const p = pts[u.slot], q = pts[(u.slot + 1) % 3];
        const poly = tryTab(isl, p, q, pts[(u.slot + 2) % 3], opts.tabDepth);
        if (poly) { isl.tabs.push({ poly, label: piece.input.name, p, q, kind: 'attach' }); tabs++; } else skipped++;
      }
    }
  }
  if (skipped) warnings.push(`${skipped} seam${skipped > 1 ? 's are' : ' is'} too short or crowded for a tab: glue ${skipped > 1 ? 'those edges' : 'that edge'} edge-to-edge using the matching labels.`);
  return { tabs, skipped };
}

/** Dotted outlines on the skull showing where the nose, ears and neck are glued: each corner of the attached piece's open edge is located on the skull surface. */
function addGlueMarks(pieces: Piece[]) {
  const skull = pieces.find((p) => p.input.id === 'skull');
  if (!skull) return;
  const where = new Map<number, Island>();
  for (const isl of skull.islands) for (const t of isl.tris) where.set(t, isl);
  const locate = (pt: P3): { isl: Island; p: P2 } | null => {
    let best = -1, bestD = Infinity, bary: [number, number, number] = [1, 0, 0];
    skull.ids.forEach((t, i) => {
      const a = skull.verts[t[0]], b = skull.verts[t[1]], c = skull.verts[t[2]];
      const w = closestBary(pt, a, b, c);
      const q: P3 = [a[0] * w[0] + b[0] * w[1] + c[0] * w[2], a[1] * w[0] + b[1] * w[1] + c[1] * w[2], a[2] * w[0] + b[2] * w[1] + c[2] * w[2]];
      const d = dist3(pt, q);
      if (d < bestD) { bestD = d; best = i; bary = w; }
    });
    if (best < 0 || bestD > 12) return null;
    const isl = where.get(best)!, pts = isl.pts.get(best)!;
    return { isl, p: [pts[0][0] * bary[0] + pts[1][0] * bary[1] + pts[2][0] * bary[2], pts[0][1] * bary[0] + pts[1][1] * bary[1] + pts[2][1] * bary[2]] };
  };
  for (const piece of pieces) {
    if (piece === skull || piece.input.attach === 'none') continue;
    for (const [, uses] of piece.edges) {
      if (uses.length !== 1) continue;
      const u = uses[0];
      const ids = piece.ids[u.tri];
      const A = piece.verts[ids[u.slot]], B = piece.verts[ids[(u.slot + 1) % 3]];
      if (piece.input.attach === 'top') {
        const ys = piece.verts.map((v) => v[1]);
        if ((A[1] + B[1]) / 2 < (Math.min(...ys) + Math.max(...ys)) / 2) continue;
      }
      const la = locate(A), lb = locate(B);
      if (la && lb && la.isl === lb.isl) la.isl.marks.push({ a: la.p, b: lb.p, label: piece.input.name });
      else if (la) la.isl.marks.push({ a: la.p, b: null, label: piece.input.name });
    }
  }
}

// ---------------------------------------------------------------- layout
function rotateFlip(p: P2, a: number): P2 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c * p[0] - s * p[1], -(s * p[0] + c * p[1])]; // y is flipped here: math coords (y up) -> page coords (y down)
}

function islandPoints(isl: Island): P2[] {
  const pts: P2[] = [];
  for (const t of isl.pts.values()) pts.push(...t);
  for (const t of isl.tabs) pts.push(...t.poly);
  for (const l of isl.edgeLabels) { const mx = (l.p[0] + l.q[0]) / 2, my = (l.p[1] + l.q[1]) / 2; pts.push([mx + l.out[0] * 6, my + l.out[1] * 6]); }
  return pts;
}

function layout(pieces: Piece[], opts: PaperOptions): number {
  const islands = pieces.flatMap((p) => p.islands);
  const gap = 4, title = 6;
  const usableW = opts.pageW - 2 * opts.margin, usableH = opts.pageH - 2 * opts.margin;

  /** the island's box at a given rotation: width, height (title included) and where its points start */
  const boxAt = (isl: Island, a: number) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of islandPoints(isl)) { const r = rotateFlip(p, a); x0 = Math.min(x0, r[0]); x1 = Math.max(x1, r[0]); y0 = Math.min(y0, r[1]); y1 = Math.max(y1, r[1]); }
    return { a, w: x1 - x0, h: y1 - y0 + title, x0, y0 };
  };
  const options = new Map<Island, ReturnType<typeof boxAt>[]>();
  for (const isl of islands) {
    let best = boxAt(isl, 0);
    for (let deg = 0; deg < 180; deg += 5) { const b = boxAt(isl, (deg * Math.PI) / 180); if (b.w * b.h < best.w * best.h) best = b; }
    const turned = boxAt(isl, best.a + Math.PI / 2);
    options.set(isl, [best, turned]);
  }

  // MaxRects: each page keeps a list of free rectangles; an island goes where it leaves the least slack
  type R = { x: number; y: number; w: number; h: number };
  const free: R[][] = [];
  const newPage = () => free.push([{ x: opts.margin, y: opts.margin, w: usableW, h: usableH - 8 }]); // 8 mm kept for the footer
  newPage();
  const order = [...islands].sort((p, q) => Math.max(...options.get(q)!.map((b) => b.w * b.h)) - Math.max(...options.get(p)!.map((b) => b.w * b.h)));
  for (const isl of order) {
    let pick: { page: number; r: R; o: ReturnType<typeof boxAt>; score: number } | null = null;
    for (let pg = 0; pg < free.length && !pick; pg++) {
      for (const o of options.get(isl)!) {
        const w = o.w + gap, h = o.h + gap;
        for (const r of free[pg]) {
          if (w > r.w || h > r.h) continue;
          const score = Math.min(r.w - w, r.h - h);
          if (!pick || score < pick.score) pick = { page: pg, r, o, score };
        }
      }
    }
    if (!pick) {
      newPage();
      const o = options.get(isl)![0];
      pick = { page: free.length - 1, r: free[free.length - 1][0], o, score: 0 };
    }
    const { page, r, o } = pick;
    const w = o.w + gap, h = o.h + gap;
    isl.rot = o.a; isl.w = o.w; isl.h = o.h; isl.page = page;
    isl.box = [r.x, r.y];
    isl.off = [r.x - o.x0, r.y + title - o.y0];
    const used: R = { x: r.x, y: r.y, w, h };
    const next: R[] = [];
    for (const f of free[page]) {
      if (used.x >= f.x + f.w || used.x + used.w <= f.x || used.y >= f.y + f.h || used.y + used.h <= f.y) { next.push(f); continue; }
      if (used.x > f.x) next.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h });
      if (used.x + used.w < f.x + f.w) next.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - used.x - used.w, h: f.h });
      if (used.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y });
      if (used.y + used.h < f.y + f.h) next.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - used.y - used.h });
    }
    free[page] = next.filter((a, i) => !next.some((b, j) => i !== j && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (i > j || a.w * a.h < b.w * b.h)));
  }
  return free.length;
}

// ---------------------------------------------------------------- rendering
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** the affine map taking three texture points to three page points, as canvas setTransform arguments */
function affine(s: P2[], d: P2[]): [number, number, number, number, number, number] | null {
  const det = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
  if (Math.abs(det) < 1e-9) return null;
  const a = ((d[1][0] - d[0][0]) * (s[2][1] - s[0][1]) - (d[2][0] - d[0][0]) * (s[1][1] - s[0][1])) / det;
  const c = ((d[2][0] - d[0][0]) * (s[1][0] - s[0][0]) - (d[1][0] - d[0][0]) * (s[2][0] - s[0][0])) / det;
  const b = ((d[1][1] - d[0][1]) * (s[2][1] - s[0][1]) - (d[2][1] - d[0][1]) * (s[1][1] - s[0][1])) / det;
  const dd = ((d[2][1] - d[0][1]) * (s[1][0] - s[0][0]) - (d[1][1] - d[0][1]) * (s[2][0] - s[0][0])) / det;
  return [a, b, c, dd, d[0][0] - a * s[0][0] - c * s[0][1], d[0][1] - b * s[0][0] - dd * s[0][1]];
}

export function buildPaperModel(inputs: PieceInput[], opts: PaperOptions): PaperResult {
  const warnings: string[] = [];
  const pieces = inputs.map((i) => weld(i, opts.scale)).filter((p) => p.ids.length > 0);
  for (const p of pieces) unfold(p, opts.maxDim);
  const { tabs, skipped } = addTabsAndLabels(pieces, opts, warnings);
  addGlueMarks(pieces);
  const pageCount = layout(pieces, opts);

  const k = opts.dpi / 25.4; // pixels per millimetre
  const pages: HTMLCanvasElement[] = [];
  for (let i = 0; i < pageCount; i++) {
    const c = document.createElement('canvas');
    c.width = Math.round(opts.pageW * k); c.height = Math.round(opts.pageH * k);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    pages.push(c);
  }

  const sampleCache = new Map<HTMLCanvasElement, ImageData>();
  const sample = (tex: HTMLCanvasElement, u: number, v: number): string => {
    let img = sampleCache.get(tex);
    if (!img) { img = tex.getContext('2d')!.getImageData(0, 0, tex.width, tex.height); sampleCache.set(tex, img); }
    const x = Math.min(tex.width - 1, Math.max(0, Math.floor(u * tex.width))), y = Math.min(tex.height - 1, Math.max(0, Math.floor((1 - v) * tex.height)));
    const o = (y * tex.width + x) * 4;
    return `rgb(${img.data[o]},${img.data[o + 1]},${img.data[o + 2]})`;
  };

  for (const piece of pieces) {
    piece.islands.forEach((isl, idx) => {
      const ctx = pages[isl.page].getContext('2d')!;
      const T = (p: P2): P2 => { const r = rotateFlip(p, isl.rot); return [(r[0] + isl.off[0]) * k, (r[1] + isl.off[1]) * k]; };
      const tex = piece.input.texture;
      const flat = piece.input.flat;
      const rand = rng(1234 + idx);
      ctx.imageSmoothingEnabled = false;

      const fillTri = (t: number, grow: number) => {
        const p2 = isl.pts.get(t)!.map(T) as P2[];
        const cx = (p2[0][0] + p2[1][0] + p2[2][0]) / 3, cy = (p2[0][1] + p2[1][1] + p2[2][1]) / 3;
        const poly = grow ? p2.map((p) => { const d = unit2([p[0] - cx, p[1] - cy]); return [p[0] + d[0] * grow, p[1] + d[1] * grow] as P2; }) : p2;
        const uv = piece.uv[t];
        const src: P2[] = uv.map((q) => [q[0] * tex.width, (1 - q[1]) * tex.height] as P2);
        const m = affine(src, p2);
        const texArea = Math.abs((src[1][0] - src[0][0]) * (src[2][1] - src[0][1]) - (src[2][0] - src[0][0]) * (src[1][1] - src[0][1])) / 2;
        ctx.save();
        ctx.beginPath(); ctx.moveTo(poly[0][0], poly[0][1]); ctx.lineTo(poly[1][0], poly[1][1]); ctx.lineTo(poly[2][0], poly[2][1]); ctx.closePath(); ctx.clip();
        if (m && texArea > 0.4) {
          ctx.setTransform(...m);
          ctx.drawImage(tex, 0, 0);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        } else {
          // all three corners land on one texel: a flat colour (hair at the back, skin at the ears and neck)
          const mu = (uv[0][0] + uv[1][0] + uv[2][0]) / 3, mv = (uv[0][1] + uv[1][1] + uv[2][1]) / 3;
          ctx.fillStyle = sample(tex, mu, mv);
          ctx.fillRect(Math.min(poly[0][0], poly[1][0], poly[2][0]) - 2, Math.min(poly[0][1], poly[1][1], poly[2][1]) - 2, 2 + Math.max(...poly.map((p) => p[0])) - Math.min(...poly.map((p) => p[0])), 2 + Math.max(...poly.map((p) => p[1])) - Math.min(...poly.map((p) => p[1])));
          const inFlat = flat && mu < flat.maxU && mv > flat.minV;
          if (inFlat && flat!.hatch) {
            ctx.strokeStyle = `rgba(0,0,0,${0.24 * flat!.strength})`; ctx.lineWidth = 0.35 * k;
            const step = 1.5 * k, x0 = Math.min(...poly.map((p) => p[0])), x1 = Math.max(...poly.map((p) => p[0])), y0 = Math.min(...poly.map((p) => p[1])), y1 = Math.max(...poly.map((p) => p[1]));
            ctx.beginPath();
            for (let s = x0 - (y1 - y0); s < x1; s += step) { ctx.moveTo(s, y1); ctx.lineTo(s + (y1 - y0), y0); }
            ctx.stroke();
          }
          if (inFlat && flat!.speckle) {
            const x0 = Math.min(...poly.map((p) => p[0])), x1 = Math.max(...poly.map((p) => p[0])), y0 = Math.min(...poly.map((p) => p[1])), y1 = Math.max(...poly.map((p) => p[1]));
            const dots = Math.round(((x1 - x0) * (y1 - y0)) / (k * k) * 0.9);
            for (let i = 0; i < dots; i++) { ctx.fillStyle = `rgba(0,0,0,${0.34 * flat!.strength})`; ctx.fillRect(x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0), 0.5 * k, 0.5 * k); }
          }
        }
        ctx.restore();
      };

      // 1. bleed: every triangle a little larger than itself, so a trimmed edge never shows white paper
      for (const t of isl.tris) fillTri(t, opts.bleed * k);
      // 2. the exact triangles on top
      for (const t of isl.tris) fillTri(t, 0);

      // 3. tabs
      for (const tab of isl.tabs) {
        const poly = tab.poly.map(T);
        ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
        ctx.fillStyle = tab.kind === 'seam' ? '#ece8df' : '#dfe6ef'; ctx.fill();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 0.22 * k; ctx.setLineDash([]); ctx.stroke();
      }

      // 4. fold lines (dashed) and cut lines (solid)
      const lw = 0.2 * k;
      ctx.lineWidth = lw;
      for (const t of isl.tris) {
        const pts = isl.pts.get(t)!.map(T);
        for (let s = 0; s < 3; s++) {
          const key = ekey(piece.ids[t][s], piece.ids[t][(s + 1) % 3]);
          const a = pts[s], b = pts[(s + 1) % 3];
          const joined = isl.joined.has(key);
          const uses = piece.edges.get(key)!;
          if (joined) {
            const other = uses.find((u) => u.tri !== t)!;
            if (t > other.tri) continue; // draw each shared edge once
            if (dihedral(piece, t, other.tri) < (8 * Math.PI) / 180) continue; // practically flat: no fold line
            ctx.setLineDash([1.4 * k, 0.9 * k]); ctx.strokeStyle = '#333';
          } else { ctx.setLineDash([]); ctx.strokeStyle = '#000'; }
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        }
      }
      // tab edges are folds
      for (const tab of isl.tabs) {
        const a = T(tab.p), b = T(tab.q);
        ctx.setLineDash([1.4 * k, 0.9 * k]); ctx.strokeStyle = '#333';
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      ctx.setLineDash([]);

      // 5. labels
      const label = (text: string, p: P2, q: P2, inside: P2, size: number) => {
        const a = T(p), b = T(q), ins = T(inside);
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (Math.cos(ang) < 0) ang += Math.PI;
        const dx = ins[0] - mx, dy = ins[1] - my, dl = Math.hypot(dx, dy) || 1;
        ctx.save();
        ctx.translate(mx + (dx / dl) * 1.6 * k, my + (dy / dl) * 1.6 * k);
        ctx.rotate(ang);
        ctx.font = `bold ${size * k}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 0.7 * k; ctx.strokeStyle = '#fff'; ctx.strokeText(text, 0, 0);
        ctx.fillStyle = '#000'; ctx.fillText(text, 0, 0);
        ctx.restore();
      };
      for (const tab of isl.tabs) {
        const far = tab.poly.slice(2); // the tab's outer corner(s): two for a trapezoid, one for a pointed tab
        const centre: P2 = [far.reduce((s, p) => s + p[0], 0) / far.length, far.reduce((s, p) => s + p[1], 0) / far.length];
        label(tab.label, tab.p, tab.q, centre, tab.kind === 'seam' ? 2.5 : 2.2);
      }
      // seam labels sit on the blank paper just outside each cut edge, so nothing is printed over the picture
      for (const el of isl.edgeLabels) {
        const a = T(el.p), b = T(el.q), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const tipP = T([(el.p[0] + el.q[0]) / 2 + el.out[0], (el.p[1] + el.q[1]) / 2 + el.out[1]]);
        const dx = tipP[0] - mx, dy = tipP[1] - my, dl = Math.hypot(dx, dy) || 1;
        let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (Math.cos(ang) < 0) ang += Math.PI;
        ctx.save();
        ctx.translate(mx + (dx / dl) * (1.5 + opts.bleed) * k, my + (dy / dl) * (1.5 + opts.bleed) * k);
        ctx.rotate(ang);
        ctx.font = `bold ${2.4 * k}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#000'; ctx.fillText(el.label, 0, 0);
        ctx.restore();
      }
      // piece title above the piece
      ctx.fillStyle = '#000'; ctx.font = `bold ${3.2 * k}px sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const count = piece.islands.length;
      ctx.fillText(`${piece.input.name}${count > 1 ? ` (${idx + 1}/${count})` : ''}`, isl.box[0] * k, isl.box[1] * k + 0.4 * k);
    });
  }

  // Assembly guide: the skull pieces again, small and grey, with the red glue outlines for the nose, ears and neck. Not for cutting:
  // these marks would show on the finished head if they were printed over the picture.
  const skullPiece = pieces.find((p) => p.input.id === 'skull');
  const guideIslands = skullPiece?.islands.filter((i) => i.marks.length) ?? [];
  if (skullPiece && guideIslands.length) {
    const sc = 0.62;
    const c = document.createElement('canvas');
    c.width = Math.round(opts.pageW * k); c.height = Math.round(opts.pageH * k);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000'; g.font = `bold ${5 * k}px sans-serif`; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('Assembly guide: do not cut this page', opts.margin * k, opts.margin * k);
    g.font = `${3 * k}px sans-serif`; g.fillStyle = '#444';
    g.fillText('Glue each small piece (nose, ears, neck) inside the red outline that carries its name. The marks are here and not on the', opts.margin * k, (opts.margin + 8) * k);
    g.fillText('printed head so that nothing is drawn over the picture.', opts.margin * k, (opts.margin + 12) * k);
    let gx = opts.margin, gy = opts.margin + 20, rowH = 0;
    for (const isl of guideIslands) {
      const w = isl.w * sc, h = isl.h * sc;
      if (gx + w > opts.pageW - opts.margin) { gx = opts.margin; gy += rowH + 5; rowH = 0; }
      const T = (p: P2): P2 => { const r = rotateFlip(p, isl.rot); return [((r[0] + isl.off[0] - isl.box[0]) * sc + gx) * k, ((r[1] + isl.off[1] - isl.box[1]) * sc + gy) * k]; };
      for (const t of isl.tris) {
        const q = isl.pts.get(t)!.map(T);
        g.beginPath(); g.moveTo(q[0][0], q[0][1]); g.lineTo(q[1][0], q[1][1]); g.lineTo(q[2][0], q[2][1]); g.closePath();
        g.fillStyle = '#ececec'; g.fill();
        // the picture, faint, so the pieces can be matched to the face
        const tex = skullPiece.input.texture, uv = skullPiece.uv[t];
        const src: P2[] = uv.map((u) => [u[0] * tex.width, (1 - u[1]) * tex.height] as P2);
        const m = affine(src, q as P2[]);
        if (m) { g.save(); g.clip(); g.globalAlpha = 0.4; g.imageSmoothingEnabled = false; g.setTransform(...m); g.drawImage(tex, 0, 0); g.restore(); }
        g.strokeStyle = '#999'; g.lineWidth = 0.15 * k; g.beginPath(); g.moveTo(q[0][0], q[0][1]); g.lineTo(q[1][0], q[1][1]); g.lineTo(q[2][0], q[2][1]); g.closePath(); g.stroke();
      }
      for (const mk of isl.marks) {
        const a = T(mk.a);
        g.strokeStyle = '#d00'; g.fillStyle = '#d00'; g.lineWidth = 0.4 * k; g.setLineDash([]);
        if (mk.b) { const b = T(mk.b); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
        g.beginPath(); g.arc(a[0], a[1], 0.7 * k, 0, Math.PI * 2); g.fill();
        g.font = `bold ${2.6 * k}px sans-serif`; g.textBaseline = 'middle';
        g.fillText(mk.label, a[0] + 1.2 * k, a[1] - 1.6 * k);
      }
      g.fillStyle = '#000'; g.font = `bold ${2.8 * k}px sans-serif`; g.textBaseline = 'top';
      g.fillText(`Head part ${guideIslands.indexOf(isl) + 1}`, gx * k, gy * k);
      gx += w + 6; rowH = Math.max(rowH, h);
    }
    pages.push(c);
  }

  // footers
  pages.forEach((c, i) => {
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#444'; ctx.font = `${2.6 * k}px sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`Face Maker paper head · page ${i + 1} of ${pages.length} · cut on solid lines, fold on dashed lines, match the labels`, opts.margin * k, (opts.pageH - 3.5) * k);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 0.3 * k;
    const bx = (opts.pageW - opts.margin - 50) * k, by = (opts.pageH - 6) * k;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + 50 * k, by); ctx.moveTo(bx, by - k); ctx.lineTo(bx, by + k); ctx.moveTo(bx + 50 * k, by - k); ctx.lineTo(bx + 50 * k, by + k); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText('50 mm (check this when printing: no "fit to page")', bx + 50 * k, by - 2 * k);
  });

  const triangles = pieces.reduce((n, p) => n + p.ids.length, 0);
  const islandsN = pieces.reduce((n, p) => n + p.islands.length, 0);
  const ys = pieces.flatMap((p) => p.verts.map((v) => v[1]));
  return { pages, stats: { pieces: pieces.length, islands: islandsN, triangles, tabs, skippedTabs: skipped, pages: pages.length, heightMm: Math.max(...ys) - Math.min(...ys) }, warnings };
}
