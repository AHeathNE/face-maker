import * as THREE from 'three';
import { CELL } from './outfit.ts';
import { Mesher, tube, type Cell, type Section } from './loft.ts';
import type { Outfit } from './outfit.ts';

/**
 * A PS1-style body built the way the games built theirs: a handful of rigid, low-poly segments (torso, pelvis, upper and
 * lower arms, hands, thighs, shins, feet) hung on joints. Posing is just rotating joints, and the clothes are painted into
 * a tiny atlas (see outfit.ts) instead of being modelled. About 400 triangles for the whole body.
 * Everything is measured in world units where the neck base is the origin (y = 0) and the head is about 1.3 tall.
 */

export interface BodyBuildStyle {
  id: string;
  label: string;
  /** widths relative to the average build */
  shoulders: number;
  chestDepth: number;
  waist: number;
  hips: number;
  limbs: number;
  /** how far the chest pushes forward at bust height (0 = none) */
  bust?: number;
}

export const BUILDS: BodyBuildStyle[] = [
  { id: 'average', label: 'Average', shoulders: 1, chestDepth: 1, waist: 1, hips: 1, limbs: 1 },
  { id: 'broad', label: 'Broad', shoulders: 1.14, chestDepth: 1.08, waist: 1.04, hips: 1, limbs: 1.12 },
  { id: 'slim', label: 'Slim', shoulders: 0.78, chestDepth: 0.86, waist: 0.8, hips: 0.78, limbs: 0.82 },
  { id: 'stocky', label: 'Stocky', shoulders: 1.06, chestDepth: 1.18, waist: 1.3, hips: 1.18, limbs: 1.2 },
  // feminine silhouettes: narrower shoulders, a defined bust, a narrow waist and fuller hips, slimmer limbs
  { id: 'feminine', label: 'Feminine', shoulders: 0.84, chestDepth: 0.96, waist: 0.72, hips: 1.1, limbs: 0.84, bust: 0.9 },
  { id: 'curvy', label: 'Feminine, curvy', shoulders: 0.88, chestDepth: 1, waist: 0.68, hips: 1.24, limbs: 0.92, bust: 1.5 },
];
export const buildById = (id: string) => BUILDS.find((b) => b.id === id) ?? BUILDS[0];

export interface ShoulderStyle { id: string; label: string }
export const SHOULDER_STYLES: ShoulderStyle[] = [
  { id: 'sloped', label: 'Sloped (tapered)' },
  { id: 'square', label: 'Square' },
  { id: 'pads', label: 'Padded' },
];

export interface BodyShape {
  /** total height in head-heights: 5.5 (chunky and cartoonish) to 7.5 (tall) */
  heads: number;
  build: string;
  /** how the neck, shoulders and upper arms join: see SHOULDER_STYLES */
  shoulders?: string;
}

export type JointName = 'pelvis' | 'spine' | 'neck' | 'shoulderL' | 'shoulderR' | 'elbowL' | 'elbowR' | 'hipL' | 'hipR' | 'kneeL' | 'kneeR';
export type Joints = Record<JointName, THREE.Group>;

export interface BodyBuild {
  group: THREE.Group;
  joints: Joints;
  /** y of the sole of the feet, with the body in its rest pose */
  floorY: number;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * A small rounded cap that sits on a joint. The limb segments are open tubes, so when a knee or elbow bends there would be a
 * wedge-shaped hole on the outside of the bend; the cap rotates with one of the two segments and fills it.
 * It samples a thin slice near the top of the limb's own texture, so it carries the same cloth or skin.
 */
function jointCap(m: Mesher, centre: THREE.Vector3, r: number, cell: Cell, vSpan: [number, number]) {
  tube(m, [
    { y: centre.y + r * 0.95, rx: r * 0.5, rz: r * 0.5, cx: centre.x, cz: centre.z },
    { y: centre.y + r * 0.45, rx: r * 1.02, rz: r * 1.02, cx: centre.x, cz: centre.z },
    { y: centre.y - r * 0.45, rx: r * 1.02, rz: r * 1.02, cx: centre.x, cz: centre.z },
    { y: centre.y - r * 0.95, rx: r * 0.5, rz: r * 0.5, cx: centre.x, cz: centre.z },
  ], { sides: 6, cell, capTop: true, capBottom: true, vSpan });
}

export function buildBody(shape: BodyShape, outfit: Outfit, material: THREE.Material): BodyBuild {
  const b = buildById(shape.build);
  // vertical stretch so the total is `heads` head-heights (head and neck are about 1.9 tall, the rest scales with k)
  const k = (shape.heads * 1.3 - 1.9) / 5.95;
  const sh = b.shoulders, hip = b.hips, wst = b.waist, cd = b.chestDepth, lm = b.limbs, bust = b.bust ?? 0;

  // rest-pose pivots in world space
  const waistY = -1.55 * k, hipPivotY = -2.55 * k;
  const shoulderPivot = v(1.22 * sh, -0.5, 0);
  const upperLen = 1.35 * k, foreLen = 1.2 * k;
  const hipX = 0.5 * hip, thighLen = 1.75 * k, shinLen = 1.65 * k;
  const ankleY = hipPivotY - thighLen - shinLen;
  const floorY = ankleY - 0.4;

  const group = new THREE.Group();
  group.name = 'body';
  const make = (name: string, pivot: THREE.Vector3, parent: THREE.Object3D, parentPivot: THREE.Vector3) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.copy(pivot).sub(parentPivot);
    parent.add(g);
    return g;
  };
  const attach = (g: THREE.Group, pivot: THREE.Vector3, build: (m: Mesher) => void) => {
    const m = new Mesher();
    build(m);
    g.add(new THREE.Mesh(m.geometry(pivot.clone().negate()), material));
  };

  // ----- pelvis (root) and torso
  const pelvisPivot = v(0, hipPivotY, 0);
  const pelvis = make('pelvis', pelvisPivot, group, v(0, 0, 0));
  attach(pelvis, pelvisPivot, (m) => {
    tube(m, [
      // the hips reach up past the waist pivot, inside the torso, so bending forward or back never opens a gap between them
      { y: waistY + 0.22, rx: 0.68 * wst, rz: 0.4 * cd },
      { y: -1.9 * k, rx: 0.98 * hip, rz: 0.56 * cd },
      { y: -2.4 * k, rx: 1.1 * hip, rz: 0.62 },
      { y: -2.85 * k, rx: 0.9 * hip, rz: 0.56 },
    ], { sides: 8, cell: CELL.pelvis, capBottom: true });
  });
  const waistPivot = v(0, waistY, 0);
  const spine = make('spine', waistPivot, pelvis, pelvisPivot);
  attach(spine, waistPivot, (m) => {
    // the collar rises around the neck; a sloped style then falls away in two steps to the shoulder, a square one in one
    const top: Section[] = shape.shoulders === 'square'
      ? [{ y: 0.04, rx: 0.4, rz: 0.34 }, { y: -0.1, rx: 0.58, rz: 0.44 }, { y: -0.4, rx: 1.14 * sh, rz: 0.56 }]
      : [{ y: 0.05, rx: 0.34, rz: 0.3 }, { y: -0.08, rx: 0.66, rz: 0.4 }, { y: -0.3, rx: 1.24 * sh, rz: 0.5 }, { y: -0.62, rx: 1.1 * sh, rz: 0.6 }];
    const sections: Section[] = [
      ...top,
      { y: -0.95 * k, rx: 1.02 * sh, rz: 0.66 * cd + 0.1 * bust, cz: 0.1 * bust },
      { y: waistY, rx: 0.84 * wst, rz: 0.52 * cd },
      { y: -1.98 * k, rx: 0.98 * hip, rz: 0.56 * cd },
    ];
    tube(m, sections, { sides: 8, cell: CELL.torso, capTop: true });
  });

  // ----- arms
  const arm = (sign: 1 | -1, tag: 'L' | 'R') => {
    const sPivot = v(shoulderPivot.x * sign, shoulderPivot.y, 0);
    const ePivot = sPivot.clone().add(v(0, -upperLen, 0));
    const wPivot = ePivot.clone().add(v(0, -foreLen, 0));
    attach(spine, waistPivot, (m) => jointCap(m, sPivot, 0.4 * lm, CELL.upperArm, [0.86, 0.97])); // fills the armpit and shoulder when the arm swings
    const shoulder = make(`shoulder${tag}`, sPivot, spine, waistPivot);
    const sloped = shape.shoulders !== 'square';
    attach(shoulder, sPivot, (m) => {
      // sloped: the arm starts narrow and high under the collar line, swells at the shoulder, then tapers to the elbow
      tube(m, sloped ? [
        { y: sPivot.y + 0.16, rx: 0.3 * lm, rz: 0.32 * lm, cx: sPivot.x - 0.16 * sign },
        { y: sPivot.y - 0.12, rx: 0.43 * lm, rz: 0.4 * lm, cx: sPivot.x },
        { y: sPivot.y - 0.55, rx: 0.37 * lm, rz: 0.35 * lm, cx: sPivot.x },
        { y: ePivot.y, rx: 0.3 * lm, rz: 0.28 * lm, cx: sPivot.x },
      ] : [
        { y: sPivot.y + 0.1, rx: 0.4 * lm, rz: 0.38 * lm, cx: sPivot.x },
        { y: sPivot.y - 0.35, rx: 0.38 * lm, rz: 0.36 * lm, cx: sPivot.x },
        { y: ePivot.y, rx: 0.3 * lm, rz: 0.28 * lm, cx: sPivot.x },
      ], { sides: 6, cell: CELL.upperArm, capTop: true });
      if (shape.shoulders === 'pads') {
        // a boxy epaulette sitting over the shoulder, as on the jackets in the reference models
        tube(m, [
          { y: sPivot.y + 0.18, rx: 0.44 * lm, rz: 0.42 * lm, cx: sPivot.x - 0.04 * sign },
          { y: sPivot.y - 0.32, rx: 0.5 * lm, rz: 0.46 * lm, cx: sPivot.x + 0.02 * sign },
        ], { sides: 6, cell: CELL.torso, capTop: true });
      }
    });
    const elbow = make(`elbow${tag}`, ePivot, shoulder, sPivot);
    attach(elbow, ePivot, (m) => {
      tube(m, [
        { y: ePivot.y + 0.1, rx: 0.3 * lm, rz: 0.28 * lm, cx: sPivot.x },
        { y: ePivot.y - foreLen * 0.35, rx: 0.31 * lm, rz: 0.29 * lm, cx: sPivot.x },
        { y: wPivot.y, rx: 0.22 * lm, rz: 0.2 * lm, cx: sPivot.x },
      ], { sides: 6, cell: CELL.foreArm });
      jointCap(m, v(sPivot.x, ePivot.y, 0), 0.31 * lm, CELL.foreArm, [0.85, 0.97]);
      // mitten hand: a block with a slightly wider palm
      tube(m, [
        { y: wPivot.y, rx: 0.23 * lm, rz: 0.17 * lm, cx: sPivot.x },
        { y: wPivot.y - 0.3, rx: 0.27 * lm, rz: 0.15 * lm, cx: sPivot.x, cz: 0.02 },
        { y: wPivot.y - 0.62, rx: 0.2 * lm, rz: 0.11 * lm, cx: sPivot.x, cz: 0.04 },
      ], { sides: 6, cell: CELL.hand, capBottom: true });
    });
    return { shoulder, elbow };
  };
  const armL = arm(-1, 'L'), armR = arm(1, 'R');

  // ----- legs
  const leg = (sign: 1 | -1, tag: 'L' | 'R') => {
    const hPivot = v(hipX * sign, hipPivotY, 0);
    const kPivot = hPivot.clone().add(v(0, -thighLen, 0));
    const aPivot = kPivot.clone().add(v(0, -shinLen, 0));
    attach(pelvis, pelvisPivot, (m) => jointCap(m, hPivot, 0.5 * lm, CELL.thigh, [0.86, 0.97])); // fills the hip when the leg swings
    const hipJ = make(`hip${tag}`, hPivot, pelvis, pelvisPivot);
    attach(hipJ, hPivot, (m) => tube(m, [
      { y: hPivot.y + 0.12, rx: 0.52 * lm, rz: 0.5 * lm, cx: hPivot.x },
      { y: hPivot.y - thighLen * 0.45, rx: 0.46 * lm, rz: 0.45 * lm, cx: hPivot.x },
      { y: kPivot.y, rx: 0.34 * lm, rz: 0.34 * lm, cx: hPivot.x },
    ], { sides: 6, cell: CELL.thigh, capTop: true }));
    const knee = make(`knee${tag}`, kPivot, hipJ, hPivot);
    attach(knee, kPivot, (m) => {
      tube(m, [
        { y: kPivot.y + 0.1, rx: 0.34 * lm, rz: 0.34 * lm, cx: hPivot.x },
        { y: kPivot.y - shinLen * 0.3, rx: 0.36 * lm, rz: 0.36 * lm, cx: hPivot.x, cz: -0.02 },
        { y: aPivot.y, rx: 0.24 * lm, rz: 0.24 * lm, cx: hPivot.x },
      ], { sides: 6, cell: CELL.shin });
      jointCap(m, v(hPivot.x, kPivot.y, 0), 0.37 * lm, CELL.shin, [0.86, 0.97]);
      // shoe: a wedge that reaches forward
      tube(m, [
        { y: aPivot.y + 0.02, rx: 0.26 * lm, rz: 0.26 * lm, cx: hPivot.x },
        { y: aPivot.y - 0.2, rx: 0.3 * lm, rz: 0.42, cx: hPivot.x, cz: 0.16 },
        { y: aPivot.y - 0.4, rx: 0.31 * lm, rz: 0.5, cx: hPivot.x, cz: 0.2 },
      ], { sides: 6, cell: CELL.foot, capBottom: true });
    });
    return { hip: hipJ, knee };
  };
  const legL = leg(-1, 'L'), legR = leg(1, 'R');

  // ----- skirts and coat tails hang from the pelvis
  if (outfit.skirt) {
    const long = outfit.skirt === 'long';
    attach(pelvis, pelvisPivot, (m) => tube(m, [
      { y: -1.95 * k, rx: 1.1 * hip, rz: 0.64 * cd },
      { y: -2.6 * k, rx: 1.36 * hip, rz: 0.86 },
      { y: (long ? -4.7 : -3.5) * k, rx: (long ? 1.55 : 1.75) * hip, rz: long ? 0.95 : 1.2 },
    ], { sides: 8, cell: CELL.skirt, doubleSided: true }));
  }

  // the head, hair and hat hang from this, so they lean and turn with the spine
  const neck = make('neck', v(0, 0, 0), spine, waistPivot);

  const joints: Joints = {
    pelvis, spine, neck,
    shoulderL: armL.shoulder, shoulderR: armR.shoulder, elbowL: armL.elbow, elbowR: armR.elbow,
    hipL: legL.hip, hipR: legR.hip, kneeL: legL.knee, kneeR: legR.knee,
  };
  return { group, joints, floorY };
}
