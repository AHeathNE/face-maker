export const SLOTS = ['face', 'hair', 'brow', 'eye', 'nose', 'mouth', 'ear'] as const;
export type Slot = (typeof SLOTS)[number];

/** How far the head is turned: front-on, three-quarter, or side profile. */
export const VIEWS = ['front', 'three-quarter', 'profile'] as const;
export type View = (typeof VIEWS)[number];

export const GENDERS = ['masc', 'femme', 'andro'] as const;
export type Gender = (typeof GENDERS)[number];

/** where a part's gender came from: a curated category, a title-based guess, an unlabeled default, or a person */
export type GenderSource = 'category' | 'guess' | 'default' | 'manual';

export interface PartSource {
  provider: string;
  objectId: string;
  url: string;
  title: string;
  artist: string;
  date: string;
  credit: string;
}

export interface Part {
  id: string;
  /** which library pack the part came from; filled in when packs are loaded */
  pack?: string;
  slot: Slot;
  era: string;
  gender: Gender;
  /** head turn measured at cut time: 0 = facing the camera, 1 = full side profile */
  yaw?: number;
  /** face width / face height from the landmarks: smaller when the head is turned */
  faceAspect?: number;
  /** distance between the eyes / face width: smaller when the head is turned */
  eyeSep?: number;
  /** hand-set angle from the review page; wins over `yaw` */
  view?: View;
  /** absent on older parts; anything other than 'category'/'manual' should be treated as unreviewed */
  genderSource?: GenderSource;
  /** path relative to packages/assets/parts */
  file: string;
  width: number;
  height: number;
  /** natural centre of the feature, in part pixels, so slots can be placed on a face */
  anchor: { x: number; y: number };
  /** width of the part as a multiple of the source face's width (lets hair keep its real size) */
  headRatio?: number;
  /** centre of the part relative to the source face centre, in face widths (+x right, +y down) */
  offset?: { x: number; y: number };
  /** the source's licence as stated, e.g. CC0, PD, CC BY 4.0 */
  license: string;
  source: PartSource;
}

export interface Era {
  id: string;
  label: string;
}

export interface Manifest {
  version: 1;
  parts: Part[];
}
