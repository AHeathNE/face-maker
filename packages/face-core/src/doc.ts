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
  return { version: 1, size, seed, layers };
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
