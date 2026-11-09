import { makeRng } from './rng.ts';
import type { Gender, Manifest, Part, Slot, View } from './types.ts';

export interface Layer {
  id: string;
  partId: string;
  slot: Slot;
  /** centre of the part, in document pixels */
  x: number;
  y: number;
  /** display width of the part (document pixels); height follows the part's aspect */
  w: number;
  /** degrees, clockwise */
  rotation: number;
  flipX: boolean;
  /** upside-down mirror; absent in older saved faces */
  flipY?: boolean;
  /**
   * When set, this layer is kept with another layer (a face and its own hair): moving, sizing, turning or flipping the leader
   * carries this layer along. `rel` says where it sits relative to the leader.
   */
  followId?: string;
  rel?: Follow;
}

/** Where a follower sits on its leader, in the leader's own terms so it survives any move, resize, turn or flip. */
export interface Follow {
  /** centre offset from the leader's centre, as a fraction of the leader's width, in the leader's own (unrotated, unflipped) frame */
  dx: number;
  dy: number;
  /** follower width as a fraction of the leader's width */
  k: number;
  /** extra rotation in degrees, in the leader's frame */
  rot: number;
  /** follower is mirrored relative to the leader */
  flip: boolean;
}

/** A face is just an ordered list of placed parts. Layers are drawn first to last. */
export interface FaceDoc {
  version: 1;
  size: number;
  seed: number;
  layers: Layer[];
}

export interface Pool {
  genders: Gender[];
  /** head angles to allow; leave out for every angle */
  views?: View[];
  /** empty = every era */
  eras: string[];
}

export interface RandomOptions extends Pool {
  /** 0 = tidy template, 1 = wonky collage */
  jitter: number;
  /** reuse one part (mirrored) for both eyes / brows / ears */
  matchingPairs: boolean;
  /** pick one gender per face instead of mixing per part */
  consistentGender: boolean;
  /** use the hair cut from the same photo as the face, kept with it, instead of picking hair on its own */
  hairWithFace?: boolean;
}

export const DEFAULT_SIZE = 1024;

/** Drawing order, back to front. */
export const SLOT_ORDER: Slot[] = ['hair', 'ear', 'face', 'brow', 'eye', 'nose', 'mouth'];

interface Spot { dx: number; dy: number; w: number }
/** Offsets and widths are in units of the head (face part) width. Pairs go left then right. */
const LAYOUT: Record<Slot, Spot[]> = {
  face: [{ dx: 0, dy: 0, w: 1 }],
  hair: [{ dx: 0, dy: -0.3, w: 1.25 }],
  ear: [{ dx: -0.53, dy: -0.02, w: 0.14 }, { dx: 0.53, dy: -0.02, w: 0.14 }],
  brow: [{ dx: -0.2, dy: -0.27, w: 0.3 }, { dx: 0.2, dy: -0.27, w: 0.3 }],
  eye: [{ dx: -0.2, dy: -0.13, w: 0.27 }, { dx: 0.2, dy: -0.13, w: 0.27 }],
  nose: [{ dx: 0, dy: 0.08, w: 0.27 }],
  mouth: [{ dx: 0, dy: 0.36, w: 0.4 }],
};
const PAIRED = new Set<Slot>(['eye', 'brow', 'ear']);
/** Head (face part) width as a fraction of the document, used by the layout and by the 3D head UV mapping. */
export const HEAD_FRACTION = 0.58;

/** yaw above these values counts as three-quarter / profile */
export const FRONT_MAX_YAW = 0.22; // about 20 degrees
export const THREE_QUARTER_MAX_YAW = 0.35; // about 31 degrees; provisional, see faceAspect/eyeSep for a better cue

export function viewOf(p: Pick<Part, 'yaw' | 'view'>): View {
  if (p.view) return p.view;
  const yaw = p.yaw ?? 0; // parts cut before angles were measured are assumed front-on
  return yaw < FRONT_MAX_YAW ? 'front' : yaw < THREE_QUARTER_MAX_YAW ? 'three-quarter' : 'profile';
}

export function partsInPool(manifest: Manifest, pool: Pool): Part[] {
  return manifest.parts.filter((p) =>
    pool.genders.includes(p.gender) &&
    (!pool.eras.length || pool.eras.includes(p.era)) &&
    (!pool.views || pool.views.includes(viewOf(p))));
}

export function defaultPlacement(slot: Slot, index: number, size = DEFAULT_SIZE) {
  const spots = LAYOUT[slot];
  const s = spots[Math.min(index, spots.length - 1)];
  const head = size * HEAD_FRACTION;
  return { x: size / 2 + s.dx * head, y: size / 2 + size * 0.02 + s.dy * head, w: s.w * head, flipX: spots.length > 1 && index % 2 === 1 };
}

let layerCounter = 0;
export const newLayerId = (slot: Slot) => `${slot}-${Date.now().toString(36)}${(layerCounter++).toString(36)}`;

/** Hair keeps the size and position it had on its source head; other slots snap to the template. */
function hairPlacement(part: Part, size: number) {
  if (part.slot !== 'hair' || !part.headRatio || !part.offset) return null;
  const head = size * HEAD_FRACTION;
  return { x: size / 2 + part.offset.x * head, y: size / 2 + size * 0.02 + part.offset.y * head, w: part.headRatio * head };
}

export function makeLayer(part: Part, index: number, size = DEFAULT_SIZE): Layer {
  const p = { ...defaultPlacement(part.slot, index, size), ...hairPlacement(part, size) };
  return { id: newLayerId(part.slot), partId: part.id, slot: part.slot, x: p.x, y: p.y, w: p.w, rotation: 0, flipX: p.flipX };
}

export function randomFace(manifest: Manifest, opts: RandomOptions, seed: number, size = DEFAULT_SIZE): FaceDoc {
  const rng = makeRng(seed);
  let pool = partsInPool(manifest, opts);
  if (opts.consistentGender) {
    const have = opts.genders.filter((g) => pool.some((p) => p.gender === g && p.slot === 'face'));
    if (have.length) pool = pool.filter((p) => p.gender === rng.pick(have));
  }
  const bySlot = new Map<Slot, Part[]>();
  for (const p of pool) bySlot.set(p.slot, [...(bySlot.get(p.slot) ?? []), p]);

  const j = opts.jitter;
  const head = size * HEAD_FRACTION;
  const layers: Layer[] = [];
  for (const slot of SLOT_ORDER) {
    if (slot === 'hair' && opts.hairWithFace) continue; // the face brings its own hair, added below
    const choices = bySlot.get(slot);
    if (!choices?.length) continue;
    const spots = LAYOUT[slot];
    let shared: Part | null = null;
    spots.forEach((spot, i) => {
      const part = PAIRED.has(slot) && opts.matchingPairs ? (shared ??= rng.pick(choices)) : rng.pick(choices);
      const grow = 1 + rng.range(-0.25, 0.4) * j;
      const wobble = head * 0.04 * j;
      const flipX = spots.length > 1 && i % 2 === 1;
      const hair = hairPlacement(part, size);
      layers.push({
        id: `${slot}-${i}`,
        partId: part.id,
        slot,
        x: (hair?.x ?? size / 2 + spot.dx * head) + rng.range(-wobble, wobble),
        y: (hair?.y ?? size / 2 + size * 0.02 + spot.dy * head) + rng.range(-wobble, wobble),
        w: (hair?.w ?? spot.w * head) * grow,
        rotation: rng.range(-10, 10) * j,
        flipX,
      });
    });
  }
  const doc: FaceDoc = { version: 1, size, seed, layers };
  if (opts.hairWithFace) {
    const face = layers.find((l) => l.slot === 'face');
    if (face) setHairWithFace(doc, manifest, face.id);
  }
  return doc;
}

// ---------- a face and its own hair, kept together ----------

/** the hair cut from the same source photo as this face part, if there is one (the face's gender/angle/era filters do not apply: it is the same photo) */
export function sourceHair(manifest: Manifest, face: Part): Part | null {
  return manifest.parts.find((p) => p.slot === 'hair' && p.era === face.era && p.pack === face.pack && p.source.objectId === face.source.objectId) ?? null;
}

const RAD = Math.PI / 180;
/** the follower's transform from its leader's current transform */
function followTransform(L: Layer, r: Follow) {
  const sx = L.flipX ? -1 : 1, sy = L.flipY ? -1 : 1;
  const lx = r.dx * sx * L.w, ly = r.dy * sy * L.w;
  const c = Math.cos(L.rotation * RAD), s = Math.sin(L.rotation * RAD);
  return { x: L.x + lx * c - ly * s, y: L.y + lx * s + ly * c, w: r.k * L.w, rotation: L.rotation + r.rot * sx, flipX: r.flip !== !!L.flipX };
}

/** Move every layer that follows `leaderId` to where it belongs on the leader. Changes the layers in place. */
export function syncFollowers(doc: FaceDoc, leaderId: string) {
  const L = doc.layers.find((l) => l.id === leaderId);
  if (!L) return;
  for (const f of doc.layers) if (f.followId === leaderId && f.rel) Object.assign(f, followTransform(L, f.rel));
}

/** After a follower was moved or resized on its own, remember where it now sits on its leader. */
export function relinkFollower(doc: FaceDoc, followerId: string) {
  const f = doc.layers.find((l) => l.id === followerId);
  const L = f?.followId ? doc.layers.find((l) => l.id === f.followId) : undefined;
  if (!f || !L) return;
  const sx = L.flipX ? -1 : 1, sy = L.flipY ? -1 : 1;
  const c = Math.cos(-L.rotation * RAD), s = Math.sin(-L.rotation * RAD);
  const vx = f.x - L.x, vy = f.y - L.y;
  const lx = vx * c - vy * s, ly = vx * s + vy * c;
  f.rel = { dx: lx / (L.w * sx), dy: ly / (L.w * sy), k: f.w / L.w, rot: (f.rotation - L.rotation) * sx, flip: !!f.flipX !== !!L.flipX };
}

/** Stop keeping layers together (the layers stay where they are). Pass a leader id to release only its followers. */
export function unlinkLayers(doc: FaceDoc, leaderId?: string) {
  for (const l of doc.layers) if (l.followId && (!leaderId || l.followId === leaderId)) { delete l.followId; delete l.rel; }
}

/**
 * Give a face its own hair: any other hair is removed, and the hair from the same source photo is added behind the face and kept
 * with it. Returns false (and leaves the face bald) when that photo produced no hair part.
 */
export function setHairWithFace(doc: FaceDoc, manifest: Manifest, faceLayerId: string): boolean {
  const face = doc.layers.find((l) => l.id === faceLayerId);
  if (!face) return false;
  doc.layers = doc.layers.filter((l) => l.slot !== 'hair');
  const facePart = manifest.parts.find((p) => p.id === face.partId);
  const hair = facePart && sourceHair(manifest, facePart);
  if (!hair) return false;
  const rel: Follow = { dx: hair.offset?.x ?? 0, dy: hair.offset?.y ?? -0.3, k: hair.headRatio ?? 1.25, rot: 0, flip: false };
  const layer: Layer = { id: newLayerId('hair'), partId: hair.id, slot: 'hair', x: 0, y: 0, w: 0, rotation: 0, flipX: false, followId: face.id, rel };
  Object.assign(layer, followTransform(face, rel));
  doc.layers.unshift(layer); // hair is the back-most layer
  return true;
}

/** Swap in a random different part for one layer, keeping its placement. */
export function rerollLayer(doc: FaceDoc, layerId: string, manifest: Manifest, pool: Pool, seed: number): FaceDoc {
  const rng = makeRng(seed);
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer) return doc;
  const options = partsInPool(manifest, pool).filter((p) => p.slot === layer.slot && p.id !== layer.partId);
  if (!options.length) return doc;
  const part = rng.pick(options);
  return { ...doc, layers: doc.layers.map((l) => (l.id === layerId ? { ...l, partId: part.id } : l)) };
}
