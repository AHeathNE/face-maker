import type { JointName, Joints } from './body.ts';

/**
 * Poses are joint rotations in degrees [x, y, z], written by hand (there is no motion capture behind them).
 * The character faces +z. For a joint that hangs along -y:
 *   x < 0 swings it forward and x > 0 backward (for a knee or elbow, x > 0 / x < 0 bends it the way a real one bends);
 *   z lifts an arm sideways (left arm: negative, right: positive);   y twists it about its own length.
 * "Left" and "right" are the character's sides as seen from the front, so left is the negative-x side.
 */
export type Rot = [number, number, number];
export type JointPose = Partial<Record<JointName, Rot>>;
export type Pose = { id: string; label: string; joints: JointPose };

export const JOINT_NAMES: JointName[] = ['neck', 'spine', 'pelvis', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR'];

export const JOINT_LABELS: Record<JointName, string> = {
  neck: 'Head / neck', spine: 'Upper body', pelvis: 'Hips (whole body twist)',
  shoulderL: 'Left shoulder', elbowL: 'Left elbow', shoulderR: 'Right shoulder', elbowR: 'Right elbow',
  hipL: 'Left hip', kneeL: 'Left knee', hipR: 'Right hip', kneeR: 'Right knee',
};

export const POSES: Pose[] = [
  { id: 'stand', label: 'Standing', joints: { shoulderL: [0, 0, -5], shoulderR: [0, 0, 5], elbowL: [-6, 0, 0], elbowR: [-6, 0, 0] } },
  { id: 'relaxed', label: 'Relaxed', joints: { shoulderL: [-3, 0, -10], shoulderR: [-3, 0, 10], elbowL: [-14, 0, 0], elbowR: [-14, 0, 0], hipL: [0, 0, -2], hipR: [0, 0, 2], kneeL: [2, 0, 0], kneeR: [2, 0, 0], spine: [2, 0, 0] } },
  { id: 'apose', label: 'A-pose', joints: { shoulderL: [0, 0, -38], shoulderR: [0, 0, 38], elbowL: [-8, 0, 0], elbowR: [-8, 0, 0] } },
  { id: 'tpose', label: 'T-pose', joints: { shoulderL: [0, 0, -90], shoulderR: [0, 0, 90] } },
  { id: 'walk', label: 'Walking', joints: {
    shoulderL: [24, 0, -6], shoulderR: [-24, 0, 6], elbowL: [-14, 0, 0], elbowR: [-38, 0, 0],
    hipL: [-26, 0, 0], kneeL: [6, 0, 0], hipR: [20, 0, 0], kneeR: [32, 0, 0], pelvis: [0, 6, 0], spine: [0, -7, 0], neck: [0, 5, 0] } },
  { id: 'run', label: 'Running', joints: {
    spine: [14, 0, 0], neck: [-10, 0, 0], pelvis: [0, 8, 0],
    shoulderL: [48, 0, -8], shoulderR: [-48, 0, 8], elbowL: [-80, 0, 0], elbowR: [-95, 0, 0],
    hipL: [-52, 0, 0], kneeL: [14, 0, 0], hipR: [30, 0, 0], kneeR: [78, 0, 0] } },
  { id: 'wave', label: 'Waving', joints: { neck: [0, 0, 6], shoulderL: [0, 0, -8], shoulderR: [0, 0, 158], elbowR: [-22, 0, 0], elbowL: [-8, 0, 0] } },
  { id: 'cheer', label: 'Cheering', joints: { neck: [-12, 0, 0], spine: [-6, 0, 0], shoulderL: [0, 0, -160], shoulderR: [0, 0, 160], elbowL: [-10, 0, 0], elbowR: [-10, 0, 0], hipL: [0, 0, -6], hipR: [0, 0, 6] } },
  { id: 'lean', label: 'Leaning', joints: { spine: [8, 0, 4], neck: [-7, 0, -3], shoulderL: [0, 0, -14], shoulderR: [-10, 0, 22], elbowR: [-70, 0, 0], hipL: [0, 0, -6], hipR: [0, 0, 6], kneeL: [4, 0, 0] } },
  { id: 'hips', label: 'Hands on hips', joints: { shoulderL: [-6, 0, -44], shoulderR: [-6, 0, 44], elbowL: [-22, 0, 104], elbowR: [-22, 0, -104], hipL: [0, 0, -4], hipR: [0, 0, 4] } },
  { id: 'crossed', label: 'Arms crossed', joints: { neck: [4, 0, 0], shoulderL: [-38, 38, -6], shoulderR: [-38, -38, 6], elbowL: [-118, 0, 0], elbowR: [-118, 0, 0], hipL: [0, 0, -3], hipR: [0, 0, 3] } },
  { id: 'salute', label: 'Salute', joints: { shoulderR: [-8, 0, 96], elbowR: [-28, 0, 118], shoulderL: [0, 0, -6], elbowL: [-6, 0, 0], neck: [0, -4, 0] } },
  { id: 'point', label: 'Pointing', joints: { spine: [0, 12, 0], neck: [0, -10, 0], shoulderR: [-88, 0, 18], elbowR: [-6, 0, 0], shoulderL: [0, 0, -8], elbowL: [-10, 0, 0] } },
  { id: 'think', label: 'Thinking', joints: { neck: [10, 0, 6], spine: [3, 0, 0], shoulderR: [-36, 0, 6], elbowR: [-140, 0, -28], shoulderL: [-14, 0, -12], elbowL: [-92, 0, 40] } },
  { id: 'shrug', label: 'Shrug', joints: { neck: [0, 0, 5], shoulderL: [0, 0, -36], shoulderR: [0, 0, 36], elbowL: [-72, -22, 0], elbowR: [-72, 22, 0] } },
  { id: 'fighter', label: 'Fighting stance', joints: {
    spine: [8, 24, 0], neck: [-4, -20, 0], pelvis: [0, -18, 0],
    shoulderL: [-58, 0, -14], shoulderR: [-72, 0, 24], elbowL: [-102, 0, 0], elbowR: [-112, 0, 0],
    hipL: [-26, 0, -14], kneeL: [28, 0, 0], hipR: [18, 0, 18], kneeR: [34, 0, 0] } },
  { id: 'punch', label: 'Punching', joints: {
    spine: [6, -22, 0], neck: [-4, 22, 0], pelvis: [0, 16, 0],
    shoulderR: [-88, 0, 6], elbowR: [-4, 0, 0], shoulderL: [-50, 0, -10], elbowL: [-118, 0, 0],
    hipL: [-24, 0, -10], kneeL: [26, 0, 0], hipR: [22, 0, 12], kneeR: [30, 0, 0] } },
  { id: 'kick', label: 'High kick', joints: {
    spine: [-14, 0, 0], neck: [6, 0, 0],
    shoulderL: [0, 0, -62], shoulderR: [0, 0, 70], elbowL: [-12, 0, 0], elbowR: [-12, 0, 0],
    hipR: [-92, 0, 8], kneeR: [4, 0, 0], hipL: [6, 0, -4], kneeL: [4, 0, 0] } },
  { id: 'crouch', label: 'Crouching', joints: {
    spine: [26, 0, 0], neck: [-24, 0, 0],
    shoulderL: [-30, 0, -14], shoulderR: [-30, 0, 14], elbowL: [-60, 0, 0], elbowR: [-60, 0, 0],
    hipL: [-82, 0, -10], kneeL: [120, 0, 0], hipR: [-82, 0, 10], kneeR: [120, 0, 0] } },
  { id: 'kneel1', label: 'Kneeling (one knee)', joints: {
    spine: [8, 0, 0], neck: [-6, 0, 0], shoulderL: [-10, 0, -12], shoulderR: [-10, 0, 12], elbowL: [-30, 0, 0], elbowR: [-30, 0, 0],
    hipL: [-88, 0, -4], kneeL: [92, 0, 0], hipR: [4, 0, 4], kneeR: [150, 0, 0] } },
  { id: 'kneel2', label: 'Kneeling (both knees)', joints: {
    spine: [4, 0, 0], neck: [-4, 0, 0], shoulderL: [-14, 0, -10], shoulderR: [-14, 0, 10], elbowL: [-40, 0, 0], elbowR: [-40, 0, 0],
    hipL: [-6, 0, -6], kneeL: [148, 0, 0], hipR: [-6, 0, 6], kneeR: [148, 0, 0] } },
  { id: 'stretch', label: 'Stretching', joints: { neck: [-14, 0, 0], spine: [-10, 0, 0], shoulderL: [-168, 0, -10], shoulderR: [-168, 0, 10], elbowL: [-4, 0, 0], elbowR: [-4, 0, 0] } },
  { id: 'bow', label: 'Bowing', joints: { spine: [62, 0, 0], neck: [10, 0, 0], shoulderL: [0, 0, -5], shoulderR: [0, 0, 5], elbowL: [-10, 0, 0], elbowR: [-10, 0, 0] } },
];

/** the pose as a full set of rotations (missing joints are at rest) */
export function fullPose(p: JointPose): Record<JointName, Rot> {
  const out = {} as Record<JointName, Rot>;
  for (const n of JOINT_NAMES) out[n] = p[n] ? ([...p[n]!] as Rot) : [0, 0, 0];
  return out;
}

/** swap left and right: the sides trade places, and sideways tilt and twist flip sign */
export function mirrorPose(p: Record<JointName, Rot>): Record<JointName, Rot> {
  const swap: Partial<Record<JointName, JointName>> = {
    shoulderL: 'shoulderR', shoulderR: 'shoulderL', elbowL: 'elbowR', elbowR: 'elbowL', hipL: 'hipR', hipR: 'hipL', kneeL: 'kneeR', kneeR: 'kneeL',
  };
  const out = {} as Record<JointName, Rot>;
  for (const n of JOINT_NAMES) { const r = p[swap[n] ?? n]; out[n] = [r[0], -r[1], -r[2]]; }
  return out;
}

const RAD = Math.PI / 180;
export function applyPose(joints: Joints, pose: Record<JointName, Rot> | JointPose) {
  for (const [name, j] of Object.entries(joints)) {
    const r = (pose as JointPose)[name as JointName] ?? [0, 0, 0];
    j.rotation.set(r[0] * RAD, r[1] * RAD, r[2] * RAD);
  }
}
